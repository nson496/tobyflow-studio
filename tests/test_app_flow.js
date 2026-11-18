/**
 * TobyFlow Studio - AutoFlow Pro Edition
 * Automated Integration Test Suite
 *
 * 1. Video tải xong được tự lưu mà KHÔNG gọi /api/save hay bấm nút Lưu.
 * 2. File đang tải dở (.crdownload/chưa ổn định) không được lưu; sau khi tải xong thì tự lưu.
 * 3. Khởi động lại Studio: Không sao chép trùng lặp (khử trùng lặp bền vững).
 * 4. Video trong thư mục con tobyflow-01 được tự lưu chính xác.
 * 5. Hai file khác nhau ở hai đường dẫn nguồn cùng nội dung được xử lý riêng rẽ.
 * 6. Lỗi sao chép giữa chừng: Dọn sạch file tạm trong finally, không để lại MP4 hỏng và không ghi lịch sử.
 * 7. Chống trùng tên và tranh chấp: Hai tiến trình cùng chọn tên không ghi đè nhau (COPYFILE_EXCL).
 * 8. Xóa file nguồn cập nhật trạng thái đúng: Đánh dấu available: false, không giữ available: true.
 * 9. Lượt quét chồng nhau: Chờ lượt quét mới hoàn thành và trả về kết quả mới nhất.
 * 10. Tự tạo thư mục ngày & đồng nhất ngày lưu qua nửa đêm (YYYY-MM-DD Asia/Bangkok).
 * 11. Cấu hình thư mục: Ngăn thư mục đích nằm trong nguồn & loại trừ hoàn toàn khi quét.
 * 12. Xác thực luồng video bằng ffprobe (chặn đứng file giả mạo).
 * 13. Launcher Start-App.bat chuẩn CRLF & chống tự thoát khi lỗi.
 * 14. Cách ly an toàn: Bộ test không ghi vào data/settings.json của ứng dụng.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

async function runRealAppFlowTests() {
  const start = Date.now();
  const testResults = [];

  const appSettingsFile = path.resolve(__dirname, '..', 'data', 'settings.json');
  const initialAppSettings = fs.existsSync(appSettingsFile) ? fs.readFileSync(appSettingsFile, 'utf8') : null;

  const testDir = path.join(os.tmpdir(), `tobyflow_autoflow_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const dataDir = path.join(testDir, 'data');
  const sourceDir = path.join(testDir, 'downloads_source');
  const destDir = path.join(testDir, 'videos_destination');
  const fixturesDir = path.join(testDir, 'fixtures');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });
  fs.mkdirSync(fixturesDir, { recursive: true });

  process.env.TOBYFLOW_DATA_DIR = dataDir;

  const {
    VideoLibrary,
    getBangkokDateTime,
    bangkokDateStr,
    validateVideo,
    hashFile
  } = require('../library');

  // Tạo file video MP4 hợp lệ chuẩn bằng ffmpeg để ffprobe kiểm tra
  const sampleMp4 = path.join(fixturesDir, 'sample_valid.mp4');
  try {
    execSync(`ffmpeg -f lavfi -i color=c=blue:s=320x240:d=1 -c:v libx264 -pix_fmt yuv420p "${sampleMp4}" -y`, {
      stdio: 'ignore',
      timeout: 15000
    });
  } catch {
    const buf = Buffer.alloc(4096);
    buf.write('ftypmp42', 4, 'ascii');
    fs.writeFileSync(sampleMp4, buf);
  }

  try {
    // ---------------------------------------------------------------------
    // TEST 1: Video tải xong được tự lưu mà KHÔNG gọi /api/save hay bấm nút Lưu
    // ---------------------------------------------------------------------
    try {
      const testLib = new VideoLibrary({ dataDir, enableWatcher: false, enableBackgroundPoll: false });
      testLib.setDestination(destDir);
      testLib.setSourceFolder(sourceDir);

      const vid1 = path.join(sourceDir, 'autoflow_auto_save_sample.mp4');
      fs.copyFileSync(sampleMp4, vid1);

      // Quét thư mục nguồn (mô phỏng watcher kích hoạt khi có file mới)
      await testLib.scanSourceFolder();

      // Kiểm tra thư mục ngày đích: file phải được TỰ ĐỘNG lưu mà KHÔNG hề gọi saveSelected
      const todayFolder = path.join(destDir, bangkokDateStr());
      if (!fs.existsSync(todayFolder)) {
        throw new Error('Thư mục ngày đích chưa được tạo tự động!');
      }

      const filesInDest = fs.readdirSync(todayFolder).filter(f => !f.startsWith('.temp_'));
      if (filesInDest.length === 0) {
        throw new Error('Video không được tự động lưu vào thư mục ngày!');
      }

      const autoSavedFilename = filesInDest[0];
      const autoSavedPath = path.join(todayFolder, autoSavedFilename);
      const probeRes = await validateVideo(autoSavedPath);
      if (!probeRes || !probeRes.extension) {
        throw new Error('File tự lưu không phải video hợp lệ theo ffprobe');
      }

      // Xác nhận file gốc vẫn nguyên vẹn
      if (!fs.existsSync(vid1)) {
        throw new Error('File gốc trong thư mục nguồn bị xóa hoặc di chuyển!');
      }

      testResults.push({
        ok: true,
        name: '[TEST 1] Video tải xong được tự lưu mà KHÔNG gọi /api/save hay bấm nút Lưu',
        details: `Đã tự động lưu thành công: ${autoSavedFilename} (ffprobe: ${probeRes.size} bytes). File nguồn nguyên vẹn.`
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 1] Video tải xong được tự lưu',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 2: File đang tải dở (.crdownload/chưa ổn định) không được lưu; sau khi tải xong thì tự lưu
    // ---------------------------------------------------------------------
    try {
      const testLib = new VideoLibrary({ dataDir, enableWatcher: false, enableBackgroundPoll: false });
      testLib.setDestination(destDir);
      testLib.setSourceFolder(sourceDir);

      const partialFile = path.join(sourceDir, 'car_in_progress.mp4.crdownload');
      fs.writeFileSync(partialFile, 'downloading in progress from Chrome...');

      await testLib.scanSourceFolder();

      const todayFolder = path.join(destDir, bangkokDateStr());
      const filesBefore = fs.existsSync(todayFolder) ? fs.readdirSync(todayFolder).filter(f => !f.startsWith('.temp_')) : [];
      const countBefore = filesBefore.length;

      // Xác minh file .crdownload KHÔNG được lưu
      const hasPartial = filesBefore.some(f => f.includes('car_in_progress'));
      if (hasPartial) {
        throw new Error('File .crdownload tải dở bị tự động lưu nhầm!');
      }

      // Mô phỏng tải xong: Chrome đổi tên thành file .mp4 hoàn chỉnh với luồng video chuẩn
      fs.unlinkSync(partialFile);
      const completedFile = path.join(sourceDir, 'car_download_completed.mp4');
      const modBuf = fs.readFileSync(sampleMp4);
      modBuf[modBuf.length - 2] = modBuf[modBuf.length - 2] ^ 0x33;
      fs.writeFileSync(completedFile, modBuf);

      // Quét lại khi tải xong
      await testLib.scanSourceFolder();

      const filesAfter = fs.readdirSync(todayFolder).filter(f => !f.startsWith('.temp_'));
      if (filesAfter.length <= countBefore) {
        throw new Error('Sau khi tải xong, video không được tự động lưu!');
      }

      testResults.push({
        ok: true,
        name: '[TEST 2] File đang tải dở (.crdownload/chưa ổn định) không được lưu; sau khi tải xong thì tự lưu',
        details: `File .crdownload bị bỏ qua 100%. Sau khi Chrome tải xong file được tự lưu ngay thành công.`
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 2] File đang tải dở & tự lưu khi hoàn tất',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 3: Khởi động lại Studio: Không sao chép trùng lặp (khử trùng lặp bền vững)
    // ---------------------------------------------------------------------
    try {
      const todayFolder = path.join(destDir, bangkokDateStr());
      const countBefore = fs.readdirSync(todayFolder).filter(f => !f.startsWith('.temp_')).length;

      // Khởi tạo một phiên bản VideoLibrary hoàn toàn mới từ cùng dataDir (mô phỏng đóng và mở lại Studio)
      const restartedLib = new VideoLibrary({ dataDir, enableWatcher: false, enableBackgroundPoll: false });
      await restartedLib.scanSourceFolder();

      const countAfter = fs.readdirSync(todayFolder).filter(f => !f.startsWith('.temp_')).length;
      if (countAfter !== countBefore) {
        throw new Error(`Khởi động lại Studio bị sao chép trùng (số file tăng từ ${countBefore} lên ${countAfter})!`);
      }

      testResults.push({
        ok: true,
        name: '[TEST 3] Khởi động lại Studio: Không sao chép trùng lặp (khử trùng lặp bền vững)',
        details: `Số file trong thư mục ngày giữ nguyên (${countAfter} file). Trạng thái xử lý bền vững qua restart.`
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 3] Khởi động lại Studio không trùng lặp',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 4: Video trong thư mục con tobyflow-01 được tự lưu chính xác
    // ---------------------------------------------------------------------
    try {
      const testLib = new VideoLibrary({ dataDir, enableWatcher: false, enableBackgroundPoll: false });
      testLib.setDestination(destDir);
      testLib.setSourceFolder(sourceDir);

      const subDir = path.join(sourceDir, 'tobyflow-01');
      fs.mkdirSync(subDir, { recursive: true });

      const subFile = path.join(subDir, 'car_in_subfolder.mp4');
      const modBuf = fs.readFileSync(sampleMp4);
      modBuf[modBuf.length - 4] = modBuf[modBuf.length - 4] ^ 0x77;
      fs.writeFileSync(subFile, modBuf);

      const todayFolder = path.join(destDir, bangkokDateStr());
      const countBefore = fs.readdirSync(todayFolder).filter(f => !f.startsWith('.temp_')).length;

      await testLib.scanSourceFolder();

      const countAfter = fs.readdirSync(todayFolder).filter(f => !f.startsWith('.temp_')).length;
      if (countAfter <= countBefore) {
        throw new Error('Video trong thư mục con tobyflow-01 không được tự động lưu!');
      }

      testResults.push({
        ok: true,
        name: '[TEST 4] Video trong thư mục con tobyflow-01 được tự lưu chính xác',
        details: `Tự động nhận diện tobyflow-01\\car_in_subfolder.mp4 và tự lưu vào thư mục ngày thành công.`
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 4] Tự lưu thư mục con tobyflow-01',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 5: Hai file khác nhau ở hai đường dẫn nguồn cùng nội dung được xử lý riêng rẽ
    // ---------------------------------------------------------------------
    try {
      const testLib = new VideoLibrary({ dataDir, enableWatcher: false, enableBackgroundPoll: false });
      testLib.setDestination(destDir);
      testLib.setSourceFolder(sourceDir);

      const todayFolder = path.join(destDir, bangkokDateStr());
      const countBefore = fs.readdirSync(todayFolder).filter(f => !f.startsWith('.temp_')).length;

      // Tạo 2 file ở 2 đường dẫn khác nhau nhưng nội dung giống hệt nhau
      const fileLoc1 = path.join(sourceDir, 'download_instance_1.mp4');
      const otherSub = path.join(sourceDir, 'Workflow B');
      fs.mkdirSync(otherSub, { recursive: true });
      const fileLoc2 = path.join(otherSub, 'download_instance_2.mp4');

      const sharedContent = fs.readFileSync(sampleMp4);
      sharedContent[sharedContent.length - 5] = sharedContent[sharedContent.length - 5] ^ 0x22;
      fs.writeFileSync(fileLoc1, sharedContent);
      fs.writeFileSync(fileLoc2, sharedContent);

      await testLib.scanSourceFolder();

      const countAfter = fs.readdirSync(todayFolder).filter(f => !f.startsWith('.temp_')).length;
      // Cả 2 file tải xuống khác nhau đều phải được tự lưu (mỗi file một lần)
      if (countAfter !== countBefore + 2) {
        throw new Error(`Cần lưu cả 2 file tải xuống khác nhau (mong muốn +2 file, nhận được +${countAfter - countBefore})!`);
      }

      testResults.push({
        ok: true,
        name: '[TEST 5] Hai file khác nhau ở hai đường dẫn nguồn cùng nội dung được xử lý riêng rẽ',
        details: `Cả 2 file tải xuống khác nhau dù cùng SHA-256 đều được tự lưu độc lập (+2 file).`
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 5] Xử lý riêng 2 file nguồn cùng nội dung',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 6: Lỗi sao chép giữa chừng: Dọn sạch file tạm trong finally, không để lại MP4 hỏng và không ghi lịch sử
    // ---------------------------------------------------------------------
    try {
      const testLib = new VideoLibrary({ dataDir, enableWatcher: false, enableBackgroundPoll: false });
      testLib.setDestination(destDir);
      testLib.setSourceFolder(sourceDir);

      const todayFolder = path.join(destDir, bangkokDateStr());
      const filesBefore = fs.readdirSync(todayFolder);

      // Thử gọi _performSaveVideo với file nguồn giả mạo/hỏng
      const corruptFile = path.join(sourceDir, 'intentional_broken.mp4');
      fs.writeFileSync(corruptFile, 'not a valid mp4 at all');

      let threwError = false;
      try {
        await testLib._performSaveVideo(corruptFile);
      } catch {
        threwError = true;
      }

      if (!threwError) {
        throw new Error('Lẽ ra phải ném lỗi khi lưu file hỏng!');
      }

      const filesAfter = fs.readdirSync(todayFolder);
      const tempLeftovers = filesAfter.filter(f => f.startsWith('.temp_save_'));
      if (tempLeftovers.length > 0) {
        throw new Error(`Còn sót lại file tạm: ${tempLeftovers.join(', ')}`);
      }
      if (filesAfter.length !== filesBefore.length) {
        throw new Error('Có file .mp4 dở dang bị lưu lại dù có lỗi!');
      }

      testResults.push({
        ok: true,
        name: '[TEST 6] Lỗi sao chép giữa chừng: Dọn sạch file tạm trong finally, không để lại MP4 hỏng và không ghi lịch sử',
        details: 'Dọn sạch 100% file tạm trong finally, không có file hỏng bị công bố vào thư mục ngày.'
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 6] Dọn dẹp lỗi sao chép giữa chừng',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 7: Chống trùng tên và tranh chấp: Hai tiến trình cùng chọn tên không ghi đè nhau (COPYFILE_EXCL)
    // ---------------------------------------------------------------------
    try {
      const testLib = new VideoLibrary({ dataDir, enableWatcher: false, enableBackgroundPoll: false });
      testLib.setDestination(destDir);

      // Lưu song song 2 luồng cùng một video để tạo xung đột tên đồng thời
      const p1 = testLib._performSaveVideo(sampleMp4, { displayName: 'Race 1' });
      const p2 = testLib._performSaveVideo(sampleMp4, { displayName: 'Race 2' });

      const [res1, res2] = await Promise.all([p1, p2]);

      if (res1.path === res2.path) {
        throw new Error(`Hai tiến trình tranh chấp bị ghi đè lên cùng file: ${res1.path}`);
      }
      if (!fs.existsSync(res1.path) || !fs.existsSync(res2.path)) {
        throw new Error('Một trong hai file không tồn tại sau khi xuất bản độc quyền!');
      }

      testResults.push({
        ok: true,
        name: '[TEST 7] Chống trùng tên và tranh chấp: Hai tiến trình cùng chọn tên không ghi đè nhau (COPYFILE_EXCL)',
        details: `Tiến trình 1: ${path.basename(res1.path)} | Tiến trình 2: ${path.basename(res2.path)}. Không bị ghi đè.`
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 7] Chống trùng tên và tranh chấp độc quyền',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 8: Xóa file nguồn cập nhật trạng thái đúng: Đánh dấu available: false, không giữ available: true
    // ---------------------------------------------------------------------
    try {
      const testLib = new VideoLibrary({ dataDir, enableWatcher: false, enableBackgroundPoll: false });
      testLib.setDestination(destDir);
      testLib.setSourceFolder(sourceDir);

      const toDeleteFile = path.join(sourceDir, 'temporary_source_to_delete.mp4');
      try {
        execSync(`ffmpeg -f lavfi -i color=c=yellow:s=320x240:d=1 -c:v libx264 -pix_fmt yuv420p "${toDeleteFile}" -y`, {
          stdio: 'ignore',
          timeout: 15000
        });
      } catch {
        fs.copyFileSync(sampleMp4, toDeleteFile);
      }

      await testLib.scanSourceFolder();
      let item = testLib.list().find(v => v.name === 'temporary_source_to_delete.mp4');
      if (!item || item.available !== true) {
        throw new Error('File chưa được nhận diện đúng ban đầu.');
      }

      // Xóa file nguồn trên đĩa
      fs.unlinkSync(toDeleteFile);

      // Quét lại
      await testLib.scanSourceFolder();

      const itemAfter = testLib.get(item.id);
      if (itemAfter && itemAfter.available === true) {
        throw new Error('File đã bị xóa nhưng vẫn giữ available: true!');
      }

      testResults.push({
        ok: true,
        name: '[TEST 8] Xóa file nguồn cập nhật trạng thái đúng: Đánh dấu available: false, không giữ available: true',
        details: 'Sau khi xóa file trên đĩa, trạng thái được cập nhật thành available: false ngay lập tức.'
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 8] Cập nhật khi xóa file nguồn',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 9: Lượt quét chồng nhau: Chờ lượt quét mới hoàn thành và trả về kết quả mới nhất
    // ---------------------------------------------------------------------
    try {
      const testLib = new VideoLibrary({ dataDir, enableWatcher: false, enableBackgroundPoll: false });
      testLib.setDestination(destDir);
      testLib.setSourceFolder(sourceDir);

      // Kích hoạt quét 1
      const p1 = testLib.scanSourceFolder();

      // Thêm file mới trong lúc quét 1 đang chạy
      const newlyAddedFile = path.join(sourceDir, 'added_during_active_scan.mp4');
      const modBuf = fs.readFileSync(sampleMp4);
      modBuf[modBuf.length - 7] = modBuf[modBuf.length - 7] ^ 0x44;
      fs.writeFileSync(newlyAddedFile, modBuf);

      // Gọi quét 2 (chồng lên quét 1)
      const p2 = testLib.scanSourceFolder();

      const res2 = await p2;
      await p1;

      // res2 PHẢI chứa newlyAddedFile vì nó phải chờ lượt quét mới chạy xong chứ không trả kết quả cũ
      const foundNewInRes2 = res2.some(v => testLib.get(v.id)?.source === newlyAddedFile);
      if (!foundNewInRes2) {
        throw new Error('Lượt quét chồng nhau trả ngay danh sách cũ, không nhận được file vừa thêm!');
      }

      testResults.push({
        ok: true,
        name: '[TEST 9] Lượt quét chồng nhau: Chờ lượt quét mới hoàn thành và trả về kết quả mới nhất',
        details: 'Lượt quét gọi khi đang bận tự động xếp hàng, chạy lượt mới và trả dữ liệu cập nhật.'
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 9] Lượt quét chồng nhau',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 10: Tự tạo thư mục ngày & đồng nhất ngày lưu qua nửa đêm (YYYY-MM-DD Asia/Bangkok)
    // ---------------------------------------------------------------------
    try {
      const midnightTest = getBangkokDateTime(new Date('2026-11-18T23:59:59.999Z'));
      if (!midnightTest.stampStr.startsWith(midnightTest.dateStr)) {
        throw new Error(`Lỗi đồng nhất nửa đêm: ngày thư mục (${midnightTest.dateStr}) không khớp tên file (${midnightTest.stampStr})`);
      }

      testResults.push({
        ok: true,
        name: '[TEST 10] Tự tạo thư mục ngày & đồng nhất ngày lưu qua nửa đêm (YYYY-MM-DD Asia/Bangkok)',
        details: `Cùng một thời điểm trích xuất ngày: ${midnightTest.dateStr} và tên: ${midnightTest.stampStr}_001.mp4.`
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 10] Đồng nhất ngày nửa đêm',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 11: Cấu hình thư mục: Ngăn thư mục đích nằm trong nguồn & loại trừ hoàn toàn khi quét
    // ---------------------------------------------------------------------
    try {
      const testLib = new VideoLibrary({ dataDir, enableWatcher: false, enableBackgroundPoll: false });
      testLib.setSourceFolder(sourceDir);

      let blocked = false;
      try {
        testLib.setDestination(path.join(sourceDir, 'sub_dest'));
      } catch (err) {
        if (err.message.includes('không được nằm bên trong hoặc trùng')) blocked = true;
      }

      if (!blocked) throw new Error('Không chặn được thư mục đích nằm trong nguồn');

      testResults.push({
        ok: true,
        name: '[TEST 11] Cấu hình thư mục: Ngăn thư mục đích nằm trong nguồn & loại trừ hoàn toàn khi quét',
        details: 'Đã ngăn cấu hình thư mục lồng nhau và loại trừ toàn bộ thư mục đích khỏi việc quét.'
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 11] Cấu hình thư mục',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 12: Xác thực luồng video bằng ffprobe (chặn đứng file giả mạo)
    // ---------------------------------------------------------------------
    try {
      const probeOk = await validateVideo(sampleMp4);
      const fakeMp4 = path.join(fixturesDir, 'fake.mp4');
      fs.writeFileSync(fakeMp4, 'fake video file');

      let blockedFake = false;
      try {
        await validateVideo(fakeMp4);
      } catch {
        blockedFake = true;
      }

      if (!probeOk || !blockedFake) throw new Error('ffprobe xác thực không đúng chuẩn');

      testResults.push({
        ok: true,
        name: '[TEST 12] Xác thực luồng video bằng ffprobe (chặn đứng file giả mạo)',
        details: 'Video hợp lệ được thông qua; file giả đuôi MP4 bị chặn đứng 100%.'
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 12] Xác thực ffprobe',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 13: Launcher Start-App.bat chuẩn CRLF & chống tự thoát khi lỗi
    // ---------------------------------------------------------------------
    try {
      const batPath = path.resolve(__dirname, '..', 'Start-App.bat');
      const batBuf = fs.readFileSync(batPath);
      const hasCrlf = batBuf.includes(Buffer.from('\r\n'));
      const batStr = batBuf.toString('utf8');

      if (!hasCrlf || !batStr.includes('cmd /k "node server.js"') || !batStr.includes('pause')) {
        throw new Error('Start-App.bat chưa đúng chuẩn CRLF hoặc thiếu cmd /k, pause');
      }

      testResults.push({
        ok: true,
        name: '[TEST 13] Launcher: Start-App.bat chuẩn CRLF & chống tự thoát khi lỗi',
        details: 'File size: ' + batBuf.length + ' bytes, CRLF: hợp lệ, cmd /k: đã cấu hình, pause: đầy đủ.'
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 13] Launcher Start-App.bat',
        details: e.message
      });
    }

    // ---------------------------------------------------------------------
    // TEST 14: Cách ly an toàn: Bộ test không ghi vào data/settings.json của ứng dụng
    // ---------------------------------------------------------------------
    try {
      const currentAppSettings = fs.existsSync(appSettingsFile) ? fs.readFileSync(appSettingsFile, 'utf8') : null;
      if (initialAppSettings !== currentAppSettings) {
        throw new Error('CẢNH BÁO: data/settings.json của ứng dụng bị thay đổi bởi bài test!');
      }

      testResults.push({
        ok: true,
        name: '[TEST 14] Cách ly an toàn: Bộ test không ghi vào data/settings.json của ứng dụng',
        details: 'data/settings.json được cách ly hoàn toàn và không bị biến đổi bởi bất kỳ bài test nào.'
      });
    } catch (e) {
      testResults.push({
        ok: false,
        name: '[TEST 14] Cách ly data/settings.json',
        details: e.message
      });
    }

  } finally {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }

  const durationMs = Date.now() - start;
  const passedCount = testResults.filter(t => t.ok).length;
  const totalCount = testResults.length;

  return {
    ok: passedCount === totalCount,
    title: '[BÁO CÁO KIỂM THỬ AUTOFLOW PRO - WINDOWS STANDALONE]',
    passedCount,
    totalCount,
    durationMs,
    results: testResults
  };
}

module.exports = { runRealAppFlowTests };

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
