function getDefaultAutoUpdater() {
  const { autoUpdater } = require('electron-updater');
  return autoUpdater;
}

let appInstance = null;
try {
  if (process.versions && process.versions.electron) {
    appInstance = require('electron').app;
  }
} catch {}

if (!appInstance) {
  appInstance = {
    getVersion: () => '2.0.0',
    isPackaged: false
  };
}

/**
 * Quản lý cập nhật ứng dụng an toàn từ GitHub Releases qua electron-updater
 * - Chỉ kiểm tra bản phát hành ổn định (không prerelease)
 * - Không tự động tải xuống nếu người dùng chưa bấm
 * - Trước khi cài đặt: đảm bảo mọi tiến trình sao chép video hoàn tất, dừng watcher và đóng server gọn gàng
 */
class AppUpdater {
  constructor(mainWindow, libraryGetter, serverManagerGetter, options = {}) {
    this.mainWindow = mainWindow;
    this.libraryGetter = libraryGetter;
    this.serverManagerGetter = serverManagerGetter;
    this.autoUpdater = options.autoUpdater || getDefaultAutoUpdater();
    this.app = options.app || appInstance;
    this.status = 'idle';
    this.updateInfo = null;

    this._configureAutoUpdater();
  }

  _configureAutoUpdater() {
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;
    this.autoUpdater.allowPrerelease = false;
    this.autoUpdater.allowDowngrade = false;

    this.autoUpdater.on('checking-for-update', () => {
      this.status = 'checking';
      this._broadcast({
        status: 'checking',
        message: 'Đang kiểm tra phiên bản mới từ GitHub Releases...'
      });
    });

    this.autoUpdater.on('update-available', (info) => {
      this.status = 'available';
      this.updateInfo = info;
      this._broadcast({
        status: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes || '',
        releaseDate: info.releaseDate || ''
      });
    });

    this.autoUpdater.on('update-not-available', (info) => {
      this.status = 'not-available';
      this._broadcast({
        status: 'not-available',
        version: info?.version || this.app.getVersion(),
        currentVersion: this.app.getVersion()
      });
    });

    this.autoUpdater.on('download-progress', (progressObj) => {
      this.status = 'downloading';
      this._broadcast({
        status: 'downloading',
        percent: Math.floor(progressObj.percent || 0),
        transferred: progressObj.transferred || 0,
        total: progressObj.total || 0,
        bytesPerSecond: progressObj.bytesPerSecond || 0
      });
    });

    this.autoUpdater.on('update-downloaded', (info) => {
      this.status = 'downloaded';
      this._broadcast({
        status: 'downloaded',
        version: info.version
      });
    });

    this.autoUpdater.on('error', (err) => {
      this.status = 'error';
      this._broadcast({
        status: 'error',
        message: err.message || 'Lỗi kiểm tra cập nhật'
      });
    });
  }

  _broadcast(data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', data);
    }
  }

  async checkForUpdates() {
    try {
      this.status = 'checking';
      this._broadcast({ status: 'checking', message: 'Đang kết nối tới GitHub Releases...' });

      // Trong môi trường development (chưa đóng gói), thông báo cho người dùng
      if (!this.app.isPackaged) {
        setTimeout(() => {
          this._broadcast({
            status: 'not-available',
            message: 'Đang chạy ở chế độ phát triển (Development mode). Tính năng cập nhật hoạt động khi cài đặt từ bản Setup.exe.',
            version: this.app.getVersion(),
            currentVersion: this.app.getVersion()
          });
        }, 800);
        return { ok: true, dev: true };
      }

      const checkResult = await this.autoUpdater.checkForUpdates();
      return { ok: true, checkResult };
    } catch (err) {
      this.status = 'error';
      this._broadcast({
        status: 'error',
        message: `Không thể kiểm tra cập nhật: ${err.message}`
      });
      return { ok: false, error: err.message };
    }
  }

  async downloadUpdate() {
    try {
      this.status = 'downloading';
      this._broadcast({ status: 'downloading', percent: 0 });
      await this.autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      this.status = 'error';
      this._broadcast({
        status: 'error',
        message: `Lỗi tải bản cập nhật: ${err.message}`
      });
      return { ok: false, error: err.message };
    }
  }

  async quitAndInstall() {
    const library = this.libraryGetter ? this.libraryGetter() : null;
    const serverManager = this.serverManagerGetter ? this.serverManagerGetter() : null;

    const isSavingActive = () => {
      if (!library) return false;
      const isBusy = !!(library.isProcessingQueue || library.saving);
      const isQueueActive = Array.isArray(library.autoSaveQueue) && library.autoSaveQueue.some(q => q.status === 'processing');
      return isBusy || isQueueActive;
    };

    // 1. Chờ các tác vụ tự lưu video đang sao chép dở hoàn tất an toàn
    // Nếu còn video đang lưu sau 15 giây thì tiếp tục chờ và báo người dùng; tuyệt đối không đóng app giữa chừng
    if (library) {
      if (isSavingActive()) {
        const startWait = Date.now();
        let lastReportSec = -1;

        while (isSavingActive()) {
          const elapsedSec = Math.floor((Date.now() - startWait) / 1000);

          if (elapsedSec !== lastReportSec) {
            lastReportSec = elapsedSec;
            if (elapsedSec < 15) {
              this._broadcast({
                status: 'installing',
                message: `Đang hoàn tất lưu video đang sao chép dở... Vui lòng chờ (${elapsedSec}s)`
              });
            } else {
              this._broadcast({
                status: 'installing',
                message: `Vẫn còn video đang lưu (dung lượng lớn hoặc nhiều file). TobyFlow Studio đang tiếp tục chờ hoàn tất an toàn để không đóng ứng dụng giữa lượt sao chép... (${elapsedSec}s)`
              });
            }
          }

          await new Promise(r => setTimeout(r, 400));
        }
      }

      this._broadcast({
        status: 'installing',
        message: 'Đã hoàn tất 100% các tác vụ lưu video. Đang lưu trữ dữ liệu an toàn...'
      });

      try { library.stopWatcher(); } catch {}
    }

    // 2. Dừng server HTTP an toàn
    if (serverManager) {
      try { await serverManager.stop(); } catch {}
    }

    // 3. Tiến hành thoát và cài đặt bản cập nhật
    setImmediate(() => {
      this.autoUpdater.quitAndInstall(false, true);
    });
  }
}

module.exports = { AppUpdater };
