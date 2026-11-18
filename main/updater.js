const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

/**
 * Quản lý cập nhật ứng dụng an toàn từ GitHub Releases qua electron-updater
 * - Chỉ kiểm tra bản phát hành ổn định (không prerelease)
 * - Không tự động tải xuống nếu người dùng chưa bấm
 * - Trước khi cài đặt: đảm bảo mọi tiến trình sao chép video hoàn tất, dừng watcher và đóng server gọn gàng
 */
class AppUpdater {
  constructor(mainWindow, libraryGetter, serverManagerGetter) {
    this.mainWindow = mainWindow;
    this.libraryGetter = libraryGetter;
    this.serverManagerGetter = serverManagerGetter;
    this.status = 'idle';
    this.updateInfo = null;

    this._configureAutoUpdater();
  }

  _configureAutoUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('checking-for-update', () => {
      this.status = 'checking';
      this._broadcast({
        status: 'checking',
        message: 'Đang kiểm tra phiên bản mới từ GitHub Releases...'
      });
    });

    autoUpdater.on('update-available', (info) => {
      this.status = 'available';
      this.updateInfo = info;
      this._broadcast({
        status: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes || '',
        releaseDate: info.releaseDate || ''
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      this.status = 'not-available';
      this._broadcast({
        status: 'not-available',
        version: info?.version || app.getVersion(),
        currentVersion: app.getVersion()
      });
    });

    autoUpdater.on('download-progress', (progressObj) => {
      this.status = 'downloading';
      this._broadcast({
        status: 'downloading',
        percent: Math.floor(progressObj.percent || 0),
        transferred: progressObj.transferred || 0,
        total: progressObj.total || 0,
        bytesPerSecond: progressObj.bytesPerSecond || 0
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.status = 'downloaded';
      this._broadcast({
        status: 'downloaded',
        version: info.version
      });
    });

    autoUpdater.on('error', (err) => {
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
      if (!app.isPackaged) {
        setTimeout(() => {
          this._broadcast({
            status: 'not-available',
            message: 'Đang chạy ở chế độ phát triển (Development mode). Tính năng cập nhật hoạt động khi cài đặt từ bản Setup.exe.',
            version: app.getVersion(),
            currentVersion: app.getVersion()
          });
        }, 800);
        return { ok: true, dev: true };
      }

      const checkResult = await autoUpdater.checkForUpdates();
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
      await autoUpdater.downloadUpdate();
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

    // 1. Chờ các tác vụ tự lưu video đang sao chép dở hoàn tất an toàn
    if (library) {
      this._broadcast({ status: 'installing', message: 'Đang hoàn tất các tác vụ lưu video trước khi khởi động lại...' });
      const maxWaitMs = 15000;
      const startWait = Date.now();
      while ((library.isProcessingQueue || library.saving) && Date.now() - startWait < maxWaitMs) {
        await new Promise(r => setTimeout(r, 200));
      }
      try { library.stopWatcher(); } catch {}
    }

    // 2. Dừng server HTTP an toàn
    if (serverManager) {
      try { await serverManager.stop(); } catch {}
    }

    // 3. Tiến hành thoát và cài đặt bản cập nhật
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
  }
}

module.exports = { AppUpdater };
