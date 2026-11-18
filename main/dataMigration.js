const fs = require('node:fs');
const path = require('node:path');

/**
 * Di chuyển và nhập dữ liệu từ bản chạy Start-App.bat cũ vào thư mục userData của Windows
 * - Không xóa, di chuyển hay sửa dữ liệu cũ
 * - Giữ nguyên cấu hình, lịch sử và trạng thái chống lưu trùng
 */
function migrateLegacyData(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });

  const targetSettings = path.join(userDataDir, 'settings.json');
  const targetHistory = path.join(userDataDir, 'history.json');
  const targetAutoSaved = path.join(userDataDir, 'auto_saved.json');

  // Nếu trong userData đã có settings.json -> giữ nguyên dữ liệu hiện tại
  if (fs.existsSync(targetSettings)) {
    return { migrated: false, reason: 'UserData đã có cấu hình' };
  }

  // Các vị trí thư mục data legacy có thể có từ các phiên bản trước
  const legacyCandidates = [
    path.resolve(__dirname, '..', 'data'),
    path.join(process.cwd(), 'data'),
    'E:\\Projects\\Tool Tobyflow\\data'
  ];

  let foundSource = null;
  for (const cand of legacyCandidates) {
    if (cand && fs.existsSync(path.join(cand, 'settings.json'))) {
      foundSource = cand;
      break;
    }
  }

  if (!foundSource) {
    // Khởi tạo file cấu hình mặc định sạch sẽ
    const defaultSettings = {
      destination: '',
      sourceFolder: '',
      autoDownloadFolder: '',
      autoSave: true
    };
    fs.writeFileSync(targetSettings, JSON.stringify(defaultSettings, null, 2), 'utf8');
    return { migrated: false, initialized: true };
  }

  // Sao chép an toàn dữ liệu, tuyệt đối không chỉnh sửa hoặc xóa dữ liệu cũ
  const filesToCopy = ['settings.json', 'history.json', 'auto_saved.json', 'jobs.json'];
  const copied = [];

  for (const f of filesToCopy) {
    const srcFile = path.join(foundSource, f);
    const dstFile = path.join(userDataDir, f);
    if (fs.existsSync(srcFile) && !fs.existsSync(dstFile)) {
      try {
        fs.copyFileSync(srcFile, dstFile);
        copied.push(f);
      } catch (err) {
        console.warn(`[DataMigration] Không thể sao chép ${f}:`, err.message);
      }
    }
  }

  return { migrated: true, from: foundSource, copied };
}

module.exports = { migrateLegacyData };
