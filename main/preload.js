const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script an toàn với contextIsolation = true, sandbox = true
 * Chỉ mở các API cần thiết để giao diện tương tác với Auto-Updater và hệ thống
 */
contextBridge.exposeInMainWorld('tobyflowElectron', {
  isElectron: true,

  // Lấy phiên bản app hiện tại
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Kiểm tra cập nhật từ GitHub Releases
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Bắt đầu tải bản cập nhật
  downloadUpdate: () => ipcRenderer.invoke('download-update'),

  // Khởi động lại và cài đặt bản cập nhật
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

  // Đăng ký nhận sự kiện tiến trình cập nhật từ main process
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('update-status', subscription);
    return () => ipcRenderer.removeListener('update-status', subscription);
  },

  // Hộp chọn thư mục native của Windows
  openFolderPicker: (title) => ipcRenderer.invoke('open-folder-dialog', title),

  // Mở thư mục hoặc file trong Windows Explorer
  openPath: (folderOrFilePath) => ipcRenderer.invoke('open-path', folderOrFilePath),

  // Mở liên kết ngoài an toàn
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Nhập dữ liệu cũ từ thư mục người dùng chỉ định
  importLegacyData: (folderPath) => ipcRenderer.invoke('import-legacy-data', folderPath)
});
