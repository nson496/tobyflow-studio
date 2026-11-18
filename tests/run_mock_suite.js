const { runRealAppFlowTests } = require('./test_app_flow');

module.exports = {
  runMockTestSuite: runRealAppFlowTests
};

if (require.main === module) {
  runRealAppFlowTests().then(report => {
    console.log('===================================================================');
    console.log(` ${report.title}`);
    console.log(` Kết quả: ${report.passedCount}/${report.totalCount} ĐẠT (${report.durationMs}ms)`);
    console.log('===================================================================');
    for (const r of report.results) {
      console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}`);
      if (r.details) console.log(`       ${r.details}`);
    }
    if (!report.ok) process.exit(1);
  }).catch(err => {
    console.error('Lỗi thực thi test runner:', err);
    process.exit(1);
  });
}
