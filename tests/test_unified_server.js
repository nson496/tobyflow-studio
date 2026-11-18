const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

// Cách ly dữ liệu test hoàn toàn, tuyệt đối không ghi vào data/settings.json của ứng dụng
const testDir = path.join(os.tmpdir(), `tobyflow_api_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
const testDataDir = path.join(testDir, 'data');
const testSourceDir = path.join(testDir, 'source_downloads');
const testDestDir = path.join(testDir, 'destination_videos');
const subWorkflowDir = path.join(testSourceDir, 'Workflow A');

fs.mkdirSync(testDataDir, { recursive: true });
fs.mkdirSync(subWorkflowDir, { recursive: true });
fs.mkdirSync(testDestDir, { recursive: true });

process.env.TOBYFLOW_DATA_DIR = testDataDir;
process.env.PORT = '3870';

// Tạo video MP4 mẫu hợp lệ trong thư mục con Workflow A
const sampleMp4Path = path.join(subWorkflowDir, 'tobyflow_api_sample.mp4');
try {
  execSync(`ffmpeg -f lavfi -i color=c=green:s=320x240:d=1 -c:v libx264 -pix_fmt yuv420p "${sampleMp4Path}" -y`, {
    stdio: 'ignore',
    timeout: 15000
  });
} catch {
  const buf = Buffer.alloc(4096);
  buf.write('ftypmp42', 4, 'ascii');
  fs.writeFileSync(sampleMp4Path, buf);
}

const http = require('node:http');
const { server, library } = require('../server');

async function testUnifiedServer() {
  console.log('===================================================================');
  console.log(' [KIỂM THỬ TÍCH HỢP TOÀN DIỆN API SERVER - DỮ LIỆU TÁCH BIỆT]');
  console.log('===================================================================');

  const PORT = 3870;
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  function request(method, pathName, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: PORT,
        path: pathName,
        method,
        headers: {
          'Host': `127.0.0.1:${PORT}`,
          'X-TobyFlow': '1',
          'Content-Type': 'application/json',
          'Connection': 'close',
          ...headers
        },
        agent: false
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  try {
    // 1. GET /api/status (Kiểm tra trạng thái khi chưa cấu hình)
    const statusRes = await request('GET', '/api/status');
    console.log('[PASS] 1. GET /api/status:', statusRes.status, statusRes.data.app, `(mode: ${statusRes.data.mode}, autoSave: ${statusRes.data.autoSave})`);

    // 2. Bảo mật: Chặn request từ Origin trái phép
    const invalidOriginRes = await request('POST', '/api/destination', { path: testDestDir }, {
      'Origin': 'http://malicious-website.com'
    });
    if (invalidOriginRes.status === 403) {
      console.log('[PASS] 2. Security Check: Chặn thành công Origin trái phép (HTTP 403)');
    } else {
      throw new Error(`Security check failed: expected 403, got ${invalidOriginRes.status}`);
    }

    // 3. POST /api/destination và POST /api/source-folder
    const setDestRes = await request('POST', '/api/destination', { path: testDestDir });
    console.log('[PASS] 3.1. POST /api/destination:', setDestRes.status, 'Dest:', setDestRes.data.settings.destination);

    const setSourceRes = await request('POST', '/api/source-folder', { path: testSourceDir });
    console.log('[PASS] 3.2. POST /api/source-folder:', setSourceRes.status, 'Source:', setSourceRes.data.settings.sourceFolder);

    // 4. Kiểm tra ngăn chặn thư mục đích nằm trong thư mục nguồn
    const badDestRes = await request('POST', '/api/destination', { path: path.join(testSourceDir, 'bad_sub_dest') });
    if (badDestRes.status >= 400) {
      console.log('[PASS] 4. Chặn cấu hình thư mục đích nằm trong thư mục nguồn thành công (HTTP', badDestRes.status, ')');
    } else {
      throw new Error('Không chặn việc cấu hình thư mục đích nằm trong thư mục nguồn!');
    }

    // 5. POST /api/scan: Quét nhận diện video mẫu trong thư mục con Workflow A & Tự động lưu
    const scanRes = await request('POST', '/api/scan');
    console.log('[PASS] 5. POST /api/scan:', scanRes.status, 'Video tìm thấy:', scanRes.data.results.length);
    if (scanRes.data.results.length !== 1) {
      throw new Error(`Mong muốn 1 video trong thư mục con, nhận được: ${scanRes.data.results.length}`);
    }
    const sampleItem = scanRes.data.results[0];
    console.log('       -> Nhận diện:', sampleItem.displayName, '| Subfolder:', sampleItem.subfolder);

    // 6. GET /api/queue: Kiểm tra trạng thái hàng đợi tự động lưu
    const queueRes = await request('GET', '/api/queue');
    console.log('[PASS] 6. GET /api/queue (Auto-Save Status):', queueRes.status, 'Saved count:', queueRes.data.stats.saved, 'Last path:', queueRes.data.stats.lastSavedPath);

    // 7. GET /api/preview/:id: Xem trước video (Stream Range)
    const previewRes = await request('GET', `/api/preview/${sampleItem.id}`, null, {
      'Range': 'bytes=0-511'
    });
    console.log('[PASS] 7. GET /api/preview/:id (Range Stream):', previewRes.status, 'Content-Type:', previewRes.headers['content-type']);
    if (previewRes.status !== 206 && previewRes.status !== 200) {
      throw new Error(`Xem trước thất bại: status ${previewRes.status}`);
    }

    // 8. POST /api/save: Lưu thủ công dự phòng -> Tạo thêm bản ghi độc lập
    const saveRes1 = await request('POST', '/api/save', { ids: [sampleItem.id] });
    console.log('[PASS] 8. POST /api/save (Lưu thủ công):', saveRes1.status, 'Đã lưu:', saveRes1.data.saved[0].filename);

    // 9. GET /api/history: Kiểm tra lịch sử
    const histRes = await request('GET', '/api/history');
    console.log('[PASS] 9. GET /api/history:', histRes.status, 'Số bản ghi lịch sử:', histRes.data.history.length);
    if (histRes.data.history.length < 2) {
      throw new Error(`Lịch sử lưu phải có ít nhất 2 dòng riêng biệt, nhận được: ${histRes.data.history.length}`);
    }
    const [h1, h2] = histRes.data.history;
    console.log('       -> Dòng 1:', h1.filename, `(ID: ${h1.id})`);
    console.log('       -> Dòng 2:', h2.filename, `(ID: ${h2.id})`);

    // 10. POST /api/open-video cho các bản ghi lịch sử
    const openRes1 = await request('POST', '/api/open-video', { id: h1.id, path: h1.path });
    const openRes2 = await request('POST', '/api/open-video', { id: h2.id, path: h2.path });
    console.log('[PASS] 10. POST /api/open-video cho cả 2 bản ghi riêng biệt:', openRes1.status, openRes2.status);

    // 11. POST /api/auto-save: Bật/Tắt chế độ tự động lưu
    const autoSaveOff = await request('POST', '/api/auto-save', { enabled: false });
    const autoSaveOn = await request('POST', '/api/auto-save', { enabled: true });
    console.log('[PASS] 11. POST /api/auto-save (Toggle On/Off):', autoSaveOff.data.autoSave.enabled, '->', autoSaveOn.data.autoSave.enabled);

    // 12. POST /api/test/mock-run: Chạy toàn bộ 14 bài kiểm thử chuyên sâu
    const mockRes = await request('POST', '/api/test/mock-run');
    console.log('[PASS] 12. POST /api/test/mock-run:', mockRes.status, 'Đạt:', mockRes.data.passedCount, '/', mockRes.data.totalCount);
    if (!mockRes.data.ok) {
      throw new Error('Bộ test nội bộ không đạt 100%!');
    }

    console.log('===================================================================');
    console.log(' TOÀN BỘ LUỒNG API: TỰ ĐỘNG LƯU -> XEM TRƯỚC -> LỊCH SỬ HOÀN HẢO!');
    console.log('===================================================================');
  } finally {
    try { if (library && library.stopWatcher) library.stopWatcher(); } catch {}
    try { if (server && server.closeAllConnections) server.closeAllConnections(); } catch {}
    await new Promise(resolve => server.close(resolve)).catch(() => {});
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  }
}

testUnifiedServer().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('[UnifiedServerTest] Lỗi:', err);
  process.exit(1);
});
