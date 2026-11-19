const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, exec } = require('node:child_process');
const { Readable } = require('node:stream');
const { VideoLibrary } = require('./library');

const DEFAULT_PORT = Number(process.env.PORT || 3862);
const PUBLIC = path.join(__dirname, 'public');
const APP_VERSION = require('./package.json').version || '2.0.0';

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(value));
}

async function body(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 5 * 1024 * 1024) {
      throw Object.assign(new Error('Dữ liệu gửi quá lớn (> 5MB).'), { status: 413 });
    }
  }
  try { return value ? JSON.parse(value) : {}; }
  catch { throw Object.assign(new Error('JSON không hợp lệ.'), { status: 400 }); }
}

function folderPicker() {
  return new Promise((resolve, reject) => {
    const script = "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Chon thu muc TobyFlow Studio'; $d.ShowNewFolderButton=$true; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}";
    const child = spawn('powershell.exe', ['-NoProfile', '-Sta', '-Command', script], { windowsHide: false });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { error += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(error || 'Không mở được hộp chọn thư mục.')));
  });
}

async function preview(req, res, library, id) {
  const item = library.get(id);
  if (!item || !item.available || !item.source) {
    return json(res, 404, { error: 'Không tìm thấy video hoặc video không có file cục bộ.' });
  }

  const file = item.source;
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return json(res, 404, { error: 'File video cục bộ không tồn tại.' });
  }

  if (!stat.isFile()) return json(res, 404, { error: 'Đường dẫn không phải là file.' });

  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;

  if (start >= stat.size || end < start) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    return res.end();
  }

  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.webm' ? 'video/webm' : (ext === '.mov' ? 'video/quicktime' : 'video/mp4');

  res.writeHead(match ? 206 : 200, {
    'Content-Type': mime,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    ...(match ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {})
  });
  fs.createReadStream(file, { start, end }).pipe(res);
}

async function staticFile(res, pathname) {
  const route = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, route);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    return json(res, 403, { error: 'Forbidden' });
  }

  let stat;
  try { stat = await fsp.stat(file); } catch { return json(res, 404, { error: 'Not found' }); }
  if (!stat.isFile()) return json(res, 404, { error: 'Not found' });

  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
  }[path.extname(file).toLowerCase()] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'"
  });
  fs.createReadStream(file).pipe(res);
}

/**
 * Factory function tạo instance máy chủ HTTP độc lập
 * Cho phép Electron hoặc launcher chạy trên cổng động và thư mục dữ liệu tùy biến
 */
function createAppServer(options = {}) {
  const dataDir = options.dataDir || process.env.TOBYFLOW_DATA_DIR || path.join(__dirname, 'data');
  const appVersion = options.appVersion || APP_VERSION;
  const library = options.library || new VideoLibrary({ dataDir, enableWatcher: options.enableWatcher !== false });

  let actualPort = Number(options.port || process.env.PORT || DEFAULT_PORT);

  function checkLocal(req) {
    const port = actualPort || (server.address() ? server.address().port : DEFAULT_PORT);
    const host = req.headers.host || '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      throw Object.assign(new Error(`Host không hợp lệ: ${host}`), { status: 403 });
    }
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      throw Object.assign(new Error(`Origin không hợp lệ: ${origin}`), { status: 403 });
    }
    if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') {
      if (req.headers['x-tobyflow'] !== '1' && req.headers['x-tobyflow-save'] !== '1') {
        throw Object.assign(new Error('Yêu cầu thiếu header xác thực cục bộ (X-TobyFlow).'), { status: 403 });
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      checkLocal(req);
      const parsedUrl = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      const pathname = parsedUrl.pathname;

      // 1. Trạng thái hệ thống (Chế độ AutoFlow Pro: Tự động lưu video theo ngày)
      if (req.method === 'GET' && pathname === '/api/status') {
        const allVideos = library.list();
        const savedCount = allVideos.filter(v => v.saved).length;
        const autoSaveStatus = library.getAutoSaveStatus();
        return json(res, 200, {
          app: 'tobyflow-studio',
          version: appVersion,
          port: actualPort,
          mode: 'autoflow-pro',
          connected: false,
          serverInfo: { name: 'AutoFlow Pro Auto-Saver' },
          tools: [],
          toolCount: 0,
          settings: library.publicSettings(),
          autoSave: autoSaveStatus.enabled,
          autoSaveStats: autoSaveStatus.stats,
          queueCount: autoSaveStatus.queue.length,
          libraryCount: allVideos.length,
          unsavedCount: allVideos.length - savedCount,
          savedCount
        });
      }

      // 2. Quét thư mục nguồn tải về của Chrome / TobyFlow
      if (req.method === 'POST' && pathname === '/api/scan') {
        const results = await library.scanSourceFolder();
        return json(res, 200, {
          results,
          settings: library.publicSettings(),
          autoSave: library.getAutoSaveStatus()
        });
      }

      // 3. Bật/Tắt chế độ Tự động lưu
      if (req.method === 'POST' && pathname === '/api/auto-save') {
        const input = await body(req);
        const enabled = input.enabled !== undefined ? Boolean(input.enabled) : true;
        const updatedSettings = library.setAutoSave(enabled);
        return json(res, 200, {
          settings: updatedSettings,
          autoSave: library.getAutoSaveStatus()
        });
      }

      // 4. Trạng thái hàng đợi tự động lưu
      if (req.method === 'GET' && (pathname === '/api/auto-save/status' || pathname === '/api/queue')) {
        return json(res, 200, library.getAutoSaveStatus());
      }

      // 5. Thử lại video bị lỗi
      if (req.method === 'POST' && pathname === '/api/retry') {
        const input = await body(req);
        if (input.all) {
          const retryRes = library.retryAllFailed();
          return json(res, 200, retryRes);
        }
        const retryRes = library.retryAutoSave(input.id || input.sourcePath);
        return json(res, 200, retryRes);
      }

      // 6. Lấy danh sách video thư viện
      if (req.method === 'GET' && (pathname === '/api/library' || pathname === '/api/results')) {
        return json(res, 200, { results: library.list() });
      }

      // 7. Lấy lịch sử video đã lưu trên đĩa
      if (req.method === 'GET' && pathname === '/api/history') {
        return json(res, 200, { history: library.getHistoryList() });
      }

      // 8. Lưu thủ công video đã chọn (Phương án dự phòng)
      if (req.method === 'POST' && pathname === '/api/save') {
        const input = await body(req);
        if (!Array.isArray(input.ids) || input.ids.length === 0) {
          throw Object.assign(new Error('Chưa chọn video nào để lưu.'), { status: 400 });
        }
        const saveRes = await library.saveSelected(input.ids);
        return json(res, 200, saveRes);
      }

      // 9. Cấu hình Thư mục gốc lưu trữ (Destination)
      if (req.method === 'POST' && pathname === '/api/destination') {
        const input = await body(req);
        const updated = library.setDestination(input.path);
        return json(res, 200, { settings: updated });
      }

      // 10. Cấu hình Thư mục nguồn tải về (Source folder)
      if (req.method === 'POST' && (pathname === '/api/source-folder' || pathname === '/api/autodownload-folder')) {
        const input = await body(req);
        const updated = library.setSourceFolder(input.path);
        await library.scanSourceFolder();
        return json(res, 200, { settings: updated, results: library.list() });
      }

      // 11. Hộp thoại chọn thư mục Windows
      if (req.method === 'POST' && pathname === '/api/folder-picker') {
        const selected = await folderPicker();
        return json(res, 200, { path: selected });
      }

      // 12. Mở Explorer và chọn file video đã lưu
      if (req.method === 'POST' && pathname === '/api/reveal') {
        const input = await body(req);
        const targetId = String(input.id || '');
        const savedInfo = library.getHistoryItem(targetId) || library.history[targetId];
        const targetPath = savedInfo?.path || input.path;

        if (!targetPath || !fs.existsSync(targetPath)) {
          throw Object.assign(new Error('File không tồn tại trên đĩa.'), { status: 404 });
        }
        spawn('explorer.exe', [`/select,${targetPath}`], { windowsHide: false, detached: true, stdio: 'ignore' }).unref();
        return json(res, 200, { ok: true });
      }

      // 13. Mở video bằng trình phát mặc định của Windows
      if (req.method === 'POST' && pathname === '/api/open-video') {
        const input = await body(req);
        const targetId = String(input.id || '');
        const savedInfo = library.getHistoryItem(targetId) || library.history[targetId];
        const targetPath = savedInfo?.path || input.path;

        if (!targetPath || !fs.existsSync(targetPath)) {
          throw Object.assign(new Error('File không tồn tại trên đĩa.'), { status: 404 });
        }
        exec(`cmd.exe /c start "" "${targetPath}"`, () => { });
        return json(res, 200, { ok: true });
      }

      // 14. Mở thư mục nguồn hoặc thư mục đích trên Windows
      if (req.method === 'POST' && pathname === '/api/open-folder') {
        const input = await body(req);
        const targetDir = input.path || (input.type === 'source' ? library.settings.sourceFolder : library.settings.destination);
        if (!targetDir || !fs.existsSync(targetDir)) {
          throw Object.assign(new Error('Thư mục không tồn tại trên đĩa.'), { status: 404 });
        }
        spawn('explorer.exe', [targetDir], { windowsHide: false, detached: true, stdio: 'ignore' }).unref();
        return json(res, 200, { ok: true });
      }

      // 14b. Nhập dữ liệu từ thư mục phiên bản cũ do người dùng chọn
      if (req.method === 'POST' && pathname === '/api/import-legacy-data') {
        const input = await body(req);
        const folder = input.folderPath || input.path;
        if (!folder) {
          throw Object.assign(new Error('Vui lòng cung cấp đường dẫn thư mục cần nhập.'), { status: 400 });
        }
        const { importLegacyDataFrom } = require('./main/dataMigration');
        const result = importLegacyDataFrom(folder, dataDir);
        library.reloadSettings();
        library.reloadHistory();
        return json(res, 200, { ok: true, result });
      }

      // 15. Phát video xem trước (Preview streaming range-based)
      if (req.method === 'GET' && pathname.startsWith('/api/preview/')) {
        const id = pathname.slice('/api/preview/'.length);
        return await preview(req, res, library, id);
      }

      // 16. Chạy bài kiểm thử tự động nội bộ
      if (req.method === 'POST' && pathname === '/api/test/mock-run') {
        const testRunner = require('./tests/test_app_flow');
        const report = await testRunner.runRealAppFlowTests();
        return json(res, 200, report);
      }

      // 17. Các endpoint MCP cũ (vô hiệu hóa rõ ràng)
      if (pathname === '/api/connect' || pathname === '/api/disconnect' || pathname === '/api/tools') {
        return json(res, 200, {
          ok: true,
          connected: false,
          message: 'Ứng dụng đang chạy ở chế độ AutoFlow Pro. Bạn không cần token hay kết nối MCP.'
        });
      }

      // 18. Tệp tĩnh (Frontend)
      if (req.method === 'GET') {
        return await staticFile(res, pathname);
      }

      return json(res, 404, { error: 'Không tìm thấy đường dẫn.' });
    } catch (error) {
      return json(res, error.status || 500, { error: error.message || 'Lỗi hệ thống.' });
    }
  });

  function start(portToUse = actualPort) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(portToUse, '127.0.0.1', () => {
        server.removeListener('error', reject);
        actualPort = server.address().port;
        library.scanSourceFolder().catch(() => { });
        library.startWatcher();
        resolve({ port: actualPort, url: `http://127.0.0.1:${actualPort}` });
      });
    });
  }

  async function stop() {
    try { if (library.stopWatcher) library.stopWatcher(); } catch { }
    if (server.closeAllConnections) {
      try { server.closeAllConnections(); } catch { }
    }
    return new Promise(resolve => server.close(resolve)).catch(() => { });
  }

  return {
    server,
    library,
    getPort: () => actualPort,
    setPort: (p) => { actualPort = p; },
    start,
    stop
  };
}

// Default instance for backward compatibility with Start-App.bat, tests, and CLI
const defaultInstance = createAppServer({
  port: DEFAULT_PORT,
  dataDir: process.env.TOBYFLOW_DATA_DIR || path.join(__dirname, 'data')
});
const server = defaultInstance.server;
const library = defaultInstance.library;

if (require.main === module) {
  defaultInstance.start(DEFAULT_PORT).then(({ port }) => {
    console.log(`===================================================================`);
    console.log(`     TOBYFLOW STUDIO - AUTOFLOW PRO (WINDOWS) PORT ${port}       `);
    console.log(`     Tự động lưu video: ĐANG BẬT                                `);
    console.log(`     Giao diện: http://127.0.0.1:${port}                       `);
    console.log(`===================================================================`);
  }).catch(err => {
    console.error('Không thể khởi động server:', err.message);
    process.exit(1);
  });
}

module.exports = {
  server,
  library,
  createAppServer
};
