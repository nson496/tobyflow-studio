const { testNamingAndCollision } = require('./test_naming');
const { testSelectiveSaveAndSecurity } = require('./test_selective_save');
const { testQueueResilience } = require('./test_queue_resilience');

async function runAllTests() {
  const suiteResults = [];
  const start = Date.now();

  console.log('=======================================================');
  console.log(' BẮT ĐẦU KIỂM THỬ HỆ THỐNG TOBYFLOW VIDEO MANAGER');
  console.log('=======================================================');

  try {
    const res1 = await testNamingAndCollision();
    suiteResults.push(res1);
    console.log(`[PASS] ${res1.name}`);
  } catch (e) {
    suiteResults.push({ ok: false, name: 'Kiểm thử đặt tên Asia/Bangkok & Chống trùng tên', error: e.message });
    console.error(`[FAIL] Kiểm thử đặt tên:`, e.message);
  }

  try {
    const res2 = await testSelectiveSaveAndSecurity();
    suiteResults.push(res2);
    console.log(`[PASS] ${res2.name}`);
  } catch (e) {
    suiteResults.push({ ok: false, name: 'Kiểm thử Lưu chọn lọc & An toàn thư mục đích', error: e.message });
    console.error(`[FAIL] Kiểm thử lưu chọn lọc:`, e.message);
  }

  try {
    const res3 = await testQueueResilience();
    suiteResults.push(res3);
    console.log(`[PASS] ${res3.name}`);
  } catch (e) {
    suiteResults.push({ ok: false, name: 'Kiểm thử Hàng đợi & Phục hồi lỗi', error: e.message });
    console.error(`[FAIL] Kiểm thử hàng đợi:`, e.message);
  }

  const durationMs = Date.now() - start;
  const passedCount = suiteResults.filter(s => s.ok).length;
  const totalCount = suiteResults.length;

  console.log('=======================================================');
  console.log(` KẾT QUẢ: ${passedCount}/${totalCount} BỘ KIỂM THỬ ĐẠT (${durationMs}ms)`);
  console.log('=======================================================');

  return {
    ok: passedCount === totalCount,
    passedCount,
    totalCount,
    durationMs,
    suites: suiteResults
  };
}

module.exports = { runAllTests };

if (require.main === module) {
  runAllTests().then(res => {
    if (!res.ok) process.exit(1);
  });
}

