const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const { migrateLegacyData, importLegacyDataFrom } = require('./dataMigration');
const { ServerManager } = require('./serverManager');
const { AppUpdater } = require('./updater');

// Đảm bảo chỉ có một instance duy nhất của ứng dụng chạy tại một thời điểm
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('[TobyFlow] Một phiên bản khác của TobyFlow Studio đang chạy. Đang thoát...');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let serverManager = null;
let serverLibrary = null;
let appUpdater = null;
let isQuitting = false;

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

async function createWindow() {
  // 1. Nhập và bảo tồn dữ liệu cũ từ legacy folder sang Windows userData nếu cần
  const userDataDir = app.getPath('userData');
  try {
    const migResult = migrateLegacyData(userDataDir);
    console.log('[TobyFlow] Di chuyển dữ liệu userData:', migResult);
  } catch (err) {
    console.warn('[TobyFlow] Cảnh báo kiểm tra dữ liệu:', err.message);
  }

  // 2. Khởi động server HTTP nhúng trên 127.0.0.1 với cổng an toàn
  serverManager = new ServerManager({
    userDataDir,
    appVersion: app.getVersion()
  });

  const { port, url, library } = await serverManager.start();
  serverLibrary = library;
  console.log(`[TobyFlow] Server nhúng đã sẵn sàng tại ${url}`);

  // 3. Khởi tạo cửa sổ chính với các thiết lập bảo mật nghiêm ngặt
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: `TobyFlow Studio v${app.getVersion()}`,
    backgroundColor: '#0c0e14',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Ẩn menu mặc định của electron để giao diện gọn gàng, hiện đại
  Menu.setApplicationMenu(null);

  // Hiển thị mượt mà khi nội dung sẵn sàng
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 4. Bảo mật điều hướng: Chặn mở tab lạ hoặc điều hướng ra ngoài localhost
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    try {
      const parsed = new URL(targetUrl);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        shell.openExternal(targetUrl);
      }
    } catch {}
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, reqUrl) => {
    if (!reqUrl.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      try {
        const parsed = new URL(reqUrl);
        if (['http:', 'https:'].includes(parsed.protocol)) {
          shell.openExternal(reqUrl);
        }
      } catch {}
    }
  });

  // 5. Khởi tạo dịch vụ kiểm tra & cập nhật GitHub Releases
  appUpdater = new AppUpdater(
    mainWindow,
    () => serverLibrary,
    () => serverManager
  );

  // 6. Tải giao diện ứng dụng từ máy chủ nội bộ
  await mainWindow.loadURL(url);
}

// Đăng ký các IPC Handlers cho preload script
function registerIpcHandlers() {
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('check-for-updates', async () => {
    if (!appUpdater) return { ok: false, error: 'Chưa khởi tạo cập nhật' };
    return await appUpdater.checkForUpdates();
  });

  ipcMain.handle('download-update', async () => {
    if (!appUpdater) return { ok: false, error: 'Chưa khởi tạo cập nhật' };
    return await appUpdater.downloadUpdate();
  });

  ipcMain.handle('quit-and-install', async () => {
    if (!appUpdater) return { ok: false, error: 'Chưa khởi tạo cập nhật' };
    await appUpdater.quitAndInstall();
    return { ok: true };
  });

  ipcMain.handle('open-folder-dialog', async (event, title) => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Chọn thư mục',
      properties: ['openDirectory', 'createDirectory']
    });
    if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('open-path', async (event, folderOrFilePath) => {
    if (folderOrFilePath && typeof folderOrFilePath === 'string') {
      await shell.openPath(folderOrFilePath);
      return true;
    }
    return false;
  });

  ipcMain.handle('open-external', async (event, externalUrl) => {
    if (externalUrl && typeof externalUrl === 'string') {
      try {
        const parsed = new URL(externalUrl);
        if (['http:', 'https:'].includes(parsed.protocol)) {
          await shell.openExternal(externalUrl);
          return true;
        }
      } catch {}
    }
    return false;
  });

  ipcMain.handle('import-legacy-data', async (event, customFolder) => {
    try {
      const userDataDir = app.getPath('userData');
      let targetFolder = customFolder;
      if (!targetFolder && mainWindow) {
        const res = await dialog.showOpenDialog(mainWindow, {
          title: 'Chọn thư mục chứa dữ liệu cũ (thư mục ứng dụng cũ hoặc thư mục data)',
          properties: ['openDirectory']
        });
        if (res.canceled || !res.filePaths || !res.filePaths.length) {
          return { ok: false, canceled: true };
        }
        targetFolder = res.filePaths[0];
      }
      const result = importLegacyDataFrom(targetFolder, userDataDir);
      if (serverLibrary) {
        if (typeof serverLibrary.reloadSettings === 'function') serverLibrary.reloadSettings();
        if (typeof serverLibrary.reloadHistory === 'function') serverLibrary.reloadHistory();
      }
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

// Vòng đời ứng dụng
app.whenReady().then(async () => {
  registerIpcHandlers();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  isQuitting = true;

  try {
    if (serverLibrary) {
      serverLibrary.stopWatcher();
    }
    if (serverManager) {
      await serverManager.stop();
    }
  } catch (err) {
    console.warn('[TobyFlow] Dọn dẹp trước khi thoát:', err.message);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
