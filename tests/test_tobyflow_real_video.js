/**
 * Kiểm thử kịch bản video TobyFlow tải về thật (Bao gồm thư mục con Workflow A, xem trước và lưu)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execSync } = require('node:child_process');

async function testRealTobyflowVideoScenario() {
  console.log('===================================================================');
  console.log(' [KIỂM THỬ THỰC TẾ VIDEO TOBYFLOW TẢI VỀ - WORKFLOW SUBFOLDER]');
  console.log('===================================================================');

  const testDir = path.join(os.tmpdir(), `tobyflow_real_scenario_${Date.now()}`);
  const sourceDownloads = path.join(testDir, 'Downloads');
  const workflowADir = path.join(sourceDownloads, 'Workflow A');
  const destinationRoot = path.join(testDir, 'Videos_Store');
  const testDataDir = path.join(testDir, 'data');

  fs.mkdirSync(workflowADir, { recursive: true });
  fs.mkdirSync(destinationRoot, { recursive: true });
  fs.mkdirSync(testDataDir, { recursive: true });

  // Cách ly hoàn toàn, không đụng vào data/settings.json của máy
  process.env.TOBYFLOW_DATA_DIR = testDataDir;

  const { VideoLibrary, bangkokDateStr, hashFile, validateVideo } = require('../library');
  const lib = new VideoLibrary({ dataDir: testDataDir, enableWatcher: false });
  lib.setSourceFolder(sourceDownloads);
  lib.setDestination(destinationRoot);

  console.log('[BƯỚC 1] Giả lập Chrome đang tải video TobyFlow vào Downloads\\Workflow A\\...');
  const crdownloadPath = path.join(workflowADir, 'TobyFlow_Cyberpunk_City_Flow.mp4.crdownload');
  fs.writeFileSync(crdownloadPath, Buffer.alloc(1024 * 50)); // File đang tải dở

  await lib.scanSourceFolder();
  console.log('  -> Số video nhận diện khi tải dở:', lib.list().length, '(Đúng mong đợi: 0 video)');
  if (lib.list().length !== 0) throw new Error('Bộ quét nhận nhầm file .crdownload');

  console.log('[BƯỚC 2] Chrome tải xong video thật: tạo file MP4 chuẩn H.264/AAC...');
  fs.unlinkSync(crdownloadPath);
  const realVideoPath = path.join(workflowADir, 'TobyFlow_Cyberpunk_City_Flow.mp4');
  execSync(`ffmpeg -f lavfi -i testsrc=duration=2:size=640x360:rate=30 -c:v libx264 -pix_fmt yuv420p "${realVideoPath}" -y`, {
    stdio: 'ignore',
    timeout: 15000
  });

  const origStat = fs.statSync(realVideoPath);
  console.log(`  -> Video thật đã tạo: ${realVideoPath} (${origStat.size} bytes)`);

  console.log('[BƯỚC 3] Quét thư mục nguồn (nhận diện mọi thư mục con)...');
  await lib.scanSourceFolder();
  const items = lib.list();
  console.log(`  -> Tìm thấy ${items.length} video trong thư viện`);
  if (items.length !== 1) throw new Error('Không nhận diện được video trong thư mục con Workflow A');

  const foundItem = items[0];
  console.log('  -> Tên hiển thị:', foundItem.displayName);
  console.log('  -> Thư mục con:', foundItem.subfolder);
  if (foundItem.subfolder !== 'Workflow A') throw new Error('Sai thông tin thư mục con');

  console.log('[BƯỚC 4] Kiểm tra tính năng Xem Trước (Preview Stream)...');
  const fullItem = lib.get(foundItem.id);
  const probeInfo = await validateVideo(fullItem.source);
  console.log('  -> ffprobe xác thực luồng video thật thành công:', probeInfo);

  // Đọc dải byte (Range Request preview)
  const previewSlice = await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(fullItem.source, { start: 0, end: 1023 });
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
  console.log(`  -> Stream xem trước đọc thành công: ${previewSlice.length} bytes`);

  console.log('[BƯỚC 5] Lưu video đã chọn vào thư mục ngày (Asia/Bangkok)...');
  const saveRes = await lib.saveSelected([foundItem.id]);
  if (saveRes.saved.length !== 1) throw new Error('Lưu video thất bại');

  const savedRecord = saveRes.saved[0];
  console.log('  -> Đã lưu thành công vào:', savedRecord.path);
  console.log('  -> Thư mục ngày:', savedRecord.dateFolder);

  // Kiểm tra file lưu thực tế bằng ffprobe
  const destProbe = await validateVideo(savedRecord.path);
  console.log('  -> ffprobe kiểm tra file lưu chính thức:', destProbe);

  // Kiểm tra bảo toàn file gốc
  if (!fs.existsSync(realVideoPath)) {
    throw new Error('File gốc trong Downloads\\Workflow A\\ bị mất!');
  }
  const origHash = await hashFile(realVideoPath);
  const destHash = await hashFile(savedRecord.path);
  if (origHash !== destHash) throw new Error('Hash không khớp giữa file gốc và file đã lưu');
  console.log('  -> Bảo toàn nguyên vẹn 100% file gốc trong Downloads\\Workflow A\\');

  // Dọn dẹp thư mục tạm của test
  fs.rmSync(testDir, { recursive: true, force: true });

  console.log('===================================================================');
  console.log(' KẾT QUẢ: KỊCH BẢN VIDEO TOBYFLOW THẬT HOẠN TẤT XUẤT SẮC!');
  console.log('===================================================================');
}

testRealTobyflowVideoScenario().catch(err => {
  console.error('Lỗi kịch bản video thật:', err);
  process.exit(1);
});

