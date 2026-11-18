const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const { VideoLibrary, validateVideo, hashFile } = require('../library');

async function testRealCarVideo() {
  console.log('===================================================================');
  console.log(' [KIỂM THỬ THỰC TẾ VỚI VIDEO Ô TÔ TOBYFLOW THẬT]');
  console.log('===================================================================');

  const realSourceRoot = 'C:\\Users\\X1 Gen 10\\Downloads\\tobyflow_output';
  const expectedCarSubfolder = path.join(realSourceRoot, 'tobyflow-01');
  const expectedCarFile = path.join(expectedCarSubfolder, '001_A_red_car_driving_slowly_through_a_city_2026-11-18.mp4');

  if (!fs.existsSync(expectedCarFile)) {
    throw new Error(`Không tìm thấy file video ô tô thật tại: ${expectedCarFile}`);
  }

  const initialStat = fs.statSync(expectedCarFile);
  const initialHash = await hashFile(expectedCarFile);
  console.log('1. Đã tìm thấy video ô tô TobyFlow thật:');
  console.log('   -> Đường dẫn gốc:', expectedCarFile);
  console.log('   -> Dung lượng gốc:', initialStat.size, 'bytes');
  console.log('   -> SHA-256 gốc:', initialHash);

  // Tạo thư mục đích TEST và dataDir TEST tách biệt hoàn toàn
  const testDir = path.join(os.tmpdir(), `tobyflow_real_test_${Date.now()}`);
  const testDataDir = path.join(testDir, 'data');
  const testDestDir = path.join(testDir, 'videos_destination');

  fs.mkdirSync(testDataDir, { recursive: true });
  fs.mkdirSync(testDestDir, { recursive: true });

  const testLib = new VideoLibrary({
    dataDir: testDataDir,
    enableWatcher: false,
    enableBackgroundPoll: false
  });

  // Cấu hình nguồn là thư mục tobyflow_output thật, đích là thư mục test tách biệt
  testLib.setDestination(testDestDir);
  testLib.setSourceFolder(realSourceRoot);

  console.log('\n2. Kích hoạt quét và tự động lưu video từ thư mục tobyflow_output...');
  await testLib.scanSourceFolder();

  // Kiểm tra danh sách video đã nhận diện
  const items = testLib.list();
  console.log(`   -> Tổng số video nhận diện: ${items.length}`);
  const carItem = items.find(v => v.name.includes('A_red_car_driving_slowly'));
  if (!carItem) {
    throw new Error('Video ô tô không xuất hiện trong danh sách nhận diện!');
  }
  console.log(`   -> Nhận diện video: ${carItem.displayName} (Subfolder: ${carItem.subfolder})`);

  // Kiểm tra thư mục đích xem video ô tô đã được tự động lưu chưa
  const historyList = testLib.getHistoryList();
  if (historyList.length === 0) {
    throw new Error('Chưa có bản ghi lịch sử nào được tạo cho video ô tô!');
  }

  const savedRecord = historyList.find(h => h.name.includes('A_red_car_driving_slowly') || h.path.endsWith('.mp4'));
  if (!savedRecord) {
    throw new Error('Không tìm thấy bản ghi lưu video ô tô trong lịch sử!');
  }

  console.log('\n3. Kết quả tự động lưu video ô tô thật:');
  console.log('   -> Thư mục ngày:', savedRecord.dateFolder);
  console.log('   -> Đường dẫn file đã lưu:', savedRecord.path);
  console.log('   -> Tên file:', savedRecord.filename);
  console.log('   -> Dung lượng file đã lưu:', savedRecord.size, 'bytes');
  console.log('   -> Thời điểm lưu:', savedRecord.savedAt);

  // 4. Xác nhận ffprobe đọc được luồng video
  console.log('\n4. Xác thực luồng video đã lưu bằng ffprobe:');
  const probeSaved = await validateVideo(savedRecord.path);
  console.log('   -> ffprobe kết luận: Luồng video hợp lệ');
  console.log('   -> Định dạng / Extension:', probeSaved.extension);
  console.log('   -> Dung lượng ffprobe đo được:', probeSaved.size, 'bytes');

  // 5. Đối chiếu mã băm SHA-256 giữa file đã lưu và file gốc
  const savedHash = await hashFile(savedRecord.path);
  console.log('\n5. So sánh mã băm SHA-256:');
  console.log('   -> SHA-256 file gốc : ', initialHash);
  console.log('   -> SHA-256 file đã lưu:', savedHash);
  if (savedHash !== initialHash) {
    throw new Error('Mã băm SHA-256 của file đã lưu KHÔNG KHỚP với file gốc!');
  }
  console.log('   -> Trùng khớp 100%! Dữ liệu video nguyên vẹn tuyệt đối.');

  // 6. Kiểm tra bảo toàn file gốc
  if (!fs.existsSync(expectedCarFile)) {
    throw new Error('CẢNH BÁO: File gốc bị mất hoặc bị xóa!');
  }
  const currentStat = fs.statSync(expectedCarFile);
  if (currentStat.size !== initialStat.size) {
    throw new Error('CẢNH BÁO: Dung lượng file gốc bị thay đổi!');
  }
  console.log('\n6. Bảo tồn file gốc: File gốc tại C:\\Users\\X1 Gen 10\\Downloads\\tobyflow_output\\tobyflow-01 hoàn toàn nguyên vẹn.');

  console.log('===================================================================');
  console.log(' [KẾT QUẢ KIỂM THỬ VIDEO Ô TÔ TOBYFLOW THẬT: THÀNH CÔNG RỰC RỠ 100%]');
  console.log('===================================================================');

  // Dọn dẹp thư mục tạm test
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
}

testRealCarVideo().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('[TestRealCarVideo] Lỗi:', err);
  process.exit(1);
});
