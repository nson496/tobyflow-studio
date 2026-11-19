const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const logFile = path.join(os.tmpdir(), 'tobyflow_runtime.log');
function runtimeLog(msg) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

runtimeLog('=== TobyFlow Studio Process Starting ===');
runtimeLog(`Node version: ${process.version}`);
runtimeLog(`Electron version: ${process.versions ? process.versions.electron : 'undefined'}`);
runtimeLog(`ELECTRON_RUN_AS_NODE: ${process.env.ELECTRON_RUN_AS_NODE || 'unset'}`);

let electron = require('electron');
if (typeof electron === 'string' && process.versions && process.versions.electron) {
  // Nếu bị npm package ghi đè trong môi trường Electron, lấy trực tiếp từ internal binding
  try {
    electron = require('electron/main');
  } catch {}
}

function showFatalError(title, err) {
  const msg = err && err.stack ? err.stack : String(err);
  runtimeLog(`FATAL ERROR [${title}]: ${msg}`);
  try {
    if (electron && electron.dialog) {
      electron.dialog.showErrorBox(title, `TobyFlow Studio gặp sự cố và không thể tiếp tục:\n\n${msg}`);
    }
  } catch {}
}

if (!electron || typeof electron !== 'object' || !electron.app) {
  showFatalError('Lỗi khởi động Electron', new Error(`Môi trường Electron không hợp lệ (typeof electron = ${typeof electron}).`));
  process.exit(1);
}

const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = electron;
const { migrateLegacyData, importLegacyDataFrom } = require('./dataMigration');
const { ServerManager } = require('./serverManager');
const { AppUpdater } = require('./updater');

process.on('uncaughtException', (err) => {
  showFatalError('Lỗi hệ thống (Uncaught Exception)', err);
});

process.on('unhandledRejection', (reason) => {
  showFatalError('Lỗi bất đồng bộ (Unhandled Rejection)', reason);
});

runtimeLog('TobyFlow Studio main process loaded.');

// Đảm bảo chỉ có một instance duy nhất của ứng dụng chạy tại một thời điểm
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  runtimeLog('Single instance lock not acquired. Exiting.');
  app.quit();
  process.exit(0);
}
runtimeLog('Single instance lock acquired.');

let mainWindow = null;
let serverManager = null;
let serverLibrary = null;
let appUpdater = null;
let isQuitting = false;
let serverPort = null;
let serverUrl = null;

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

async function createWindow() {
  runtimeLog('createWindow called.');
  try {
    // 1. Nhập và bảo tồn dữ liệu cũ từ legacy folder sang Windows userData nếu cần
    const userDataDir = app.getPath('userData');
    runtimeLog(`userDataDir: ${userDataDir}`);
    try {
      const migResult = migrateLegacyData(userDataDir);
      runtimeLog(`migrateLegacyData result: ${JSON.stringify(migResult)}`);
    } catch (err) {
      runtimeLog(`migrateLegacyData error: ${err.message}`);
    }

    // 2. Khởi động server HTTP nhúng trên 127.0.0.1 với cổng an toàn
    serverManager = new ServerManager({
      userDataDir,
      appVersion: app.getVersion()
    });

    const startResult = await serverManager.start();
    serverPort = startResult.port;
    serverUrl = startResult.url;
    serverLibrary = startResult.library;
    runtimeLog(`Server started successfully at ${serverUrl} (port: ${serverPort})`);

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

    // Bắt lỗi nạp trang để hiển thị thông báo nhìn thấy được
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      runtimeLog(`did-fail-load: code=${errorCode}, desc=${errorDescription}, url=${validatedURL}`);
      dialog.showErrorBox(
        'Lỗi nạp giao diện TobyFlow Studio',
        `Không thể nạp giao diện từ: ${validatedURL}\nMã lỗi: ${errorCode} (${errorDescription})\n\nVui lòng kiểm tra lại kết nối mạng nội bộ 127.0.0.1.`
      );
    });

    // Dự phòng hiển thị cửa sổ nếu ready-to-show bị chậm
    const forceShowTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        runtimeLog('Force showing mainWindow after 3s timeout.');
        mainWindow.show();
      }
    }, 3000);

    mainWindow.once('ready-to-show', () => {
      clearTimeout(forceShowTimer);
      runtimeLog('mainWindow ready-to-show fired.');
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
      const allowedPrefix = serverPort ? `http://127.0.0.1:${serverPort}` : 'http://127.0.0.1:';
      if (!reqUrl.startsWith(allowedPrefix)) {
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
    runtimeLog(`Loading URL: ${serverUrl}`);
    await mainWindow.loadURL(serverUrl);
    runtimeLog('loadURL resolved successfully.');
  } catch (err) {
    showFatalError('Lỗi khởi động TobyFlow Studio', err);
    app.quit();
  }
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
  try {
    registerIpcHandlers();
    await createWindow();
  } catch (err) {
    showFatalError('Lỗi khởi động ứng dụng', err);
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
}).catch((err) => {
  showFatalError('Lỗi khởi tạo Electron', err);
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
    runtimeLog(`Dọn dẹp trước khi thoát lỗi: ${err.message}`);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
