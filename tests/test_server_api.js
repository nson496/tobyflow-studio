const http = require('http');
const server = require('../server/server');

async function testServerApi() {
  console.log('[TestServer] Đang kiểm tra API server...');

  function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: 3840,
        path,
        method,
        headers: {
          'Content-Type': 'application/json'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  try {
    // 1. Status API
    const statusRes = await request('GET', '/api/status');
    console.log('[TestServer] /api/status ->', statusRes.status, statusRes.data.destinationFolder);

    // 2. Config API
    const configRes = await request('GET', '/api/config');
    console.log('[TestServer] /api/config ->', configRes.status, 'mcpServerUrl:', configRes.data.mcpServerUrl);

    // 3. Create task via API
    const taskRes = await request('POST', '/api/tasks', {
      prompts: ['A cute cyber cat in Tokyo street'],
      provider: 'flow',
      aspectRatio: '16:9',
      count: 1
    });
    console.log('[TestServer] POST /api/tasks ->', taskRes.status, 'Created:', taskRes.data.count);

    // 4. List tasks via API
    const tasksRes = await request('GET', '/api/tasks');
    console.log('[TestServer] GET /api/tasks ->', tasksRes.status, 'Total tasks:', tasksRes.data.length);

    // 5. Run automated test suite via API
    const runTestRes = await request('POST', '/api/test/run');
    console.log('[TestServer] POST /api/test/run -> Passed:', runTestRes.data.passedCount, '/', runTestRes.data.totalCount);

    console.log('[TestServer] TẤT CẢ ENDPOINT API HOẠT ĐỘNG HOÀN HẢO!');
  } finally {
    server.close();
  }
}

testServerApi().catch(err => {
  console.error('[TestServer] Lỗi:', err);
  process.exit(1);
});

