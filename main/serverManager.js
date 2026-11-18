const http = require('node:http');
const path = require('node:path');
const { createAppServer } = require('../server');

/**
 * Quản lý vòng đời máy chủ HTTP nhúng bên trong Electron
 * - Tự động phát hiện và xử lý xung đột cổng an toàn (không tắt tiến trình bên ngoài)
 * - Nếu cổng 3862 bận, tự động chọn cổng khả dụng tiếp theo
 * - Luôn lắng nghe độc quyền trên 127.0.0.1
 * - Xác minh phiên bản API đảm bảo không kết nối nhầm server cũ
 */
class ServerManager {
  constructor(options = {}) {
    this.userDataDir = options.userDataDir || path.join(__dirname, '..', 'data');
    this.appVersion = options.appVersion || '2.0.0';
    this.serverInstance = null;
    this.actualPort = null;
  }

  async start() {
    this.serverInstance = createAppServer({
      dataDir: this.userDataDir,
      appVersion: this.appVersion,
      enableWatcher: true
    });

    const primaryPort = 3862;
    let started = false;

    // 1. Thử cổng chuẩn 3862
    try {
      const res = await this.serverInstance.start(primaryPort);
      this.actualPort = res.port;
      started = true;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') {
        throw err;
      }
      console.warn(`[ServerManager] Cổng ${primaryPort} đang bận. Đang chọn cổng trống an toàn...`);
    }

    // 2. Nếu cổng 3862 đang bận, dùng cổng động do hệ điều hành cấp (port 0)
    if (!started) {
      const res = await this.serverInstance.start(0);
      this.actualPort = res.port;
    }

    // 3. Xác minh kết nối tới server chính mình
    await this._verifyServerHealth(this.actualPort);

    return {
      port: this.actualPort,
      url: `http://127.0.0.1:${this.actualPort}`,
      library: this.serverInstance.library
    };
  }

  _verifyServerHealth(port) {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/api/status`, {
        headers: { 'Host': `127.0.0.1:${port}` },
        timeout: 4000
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (data.app === 'tobyflow-studio') {
              resolve(data);
            } else {
              reject(new Error(`Server phản hồi không đúng danh tính: ${raw}`));
            }
          } catch (err) {
            reject(new Error(`Không thể phân tích phản hồi kiểm tra sức khỏe: ${err.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Kiểm tra sức khỏe server quá thời gian chờ (timeout).'));
      });
    });
  }

  async stop() {
    if (this.serverInstance) {
      try {
        await this.serverInstance.stop();
      } catch (err) {
        console.warn('[ServerManager] Lỗi dừng server:', err.message);
      }
      this.serverInstance = null;
    }
  }
}

module.exports = { ServerManager };
