const fs = require('node:fs');
const path = require('node:path');

/**
 * Tự động di chuyển dữ liệu từ bản chạy cục bộ trước đó sang userData của Windows
 * - Tuyệt đối không dùng đường dẫn máy phát triển cá nhân
 * - Chỉ kiểm tra vị trí tương đối của thư mục đang chạy
 */
function migrateLegacyData(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });

  const targetSettings = path.join(userDataDir, 'settings.json');

  // Nếu trong userData đã có settings.json -> giữ nguyên dữ liệu hiện tại
  if (fs.existsSync(targetSettings)) {
    return { migrated: false, reason: 'UserData đã có cấu hình' };
  }

  // Các vị trí dữ liệu tương đối có thể có nếu người dùng mở từ thư mục giải nén cũ
  const legacyCandidates = [
    path.resolve(__dirname, '..', 'data'),
    path.join(process.cwd(), 'data')
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

  return importLegacyDataFrom(foundSource, userDataDir);
}

/**
 * Cho phép người dùng chủ động chọn thư mục chứa dữ liệu cũ để nhập vào TobyFlow Studio
 * - Hỗ trợ cả thư mục chứa trực tiếp (data/) hoặc thư mục cha của nó
 * - Gộp thông minh: không làm mất lịch sử hay video đã lưu trước đó
 * - Tuyệt đối không xóa hay sửa đổi thư mục nguồn
 */
function importLegacyDataFrom(customFolder, userDataDir) {
  if (!customFolder || typeof customFolder !== 'string') {
    throw new Error('Đường dẫn thư mục nguồn không hợp lệ.');
  }

  const resolved = path.resolve(customFolder);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Thư mục '${customFolder}' không tồn tại.`);
  }

  // Xác định thư mục data thực tế
  let dataDir = resolved;
  if (!fs.existsSync(path.join(dataDir, 'settings.json')) && fs.existsSync(path.join(dataDir, 'data', 'settings.json'))) {
    dataDir = path.join(dataDir, 'data');
  }

  if (!fs.existsSync(path.join(dataDir, 'settings.json')) && !fs.existsSync(path.join(dataDir, 'history.json')) && !fs.existsSync(path.join(dataDir, 'auto_saved.json'))) {
    throw new Error(`Không tìm thấy file dữ liệu (settings.json, history.json hoặc auto_saved.json) trong '${customFolder}'.`);
  }

  fs.mkdirSync(userDataDir, { recursive: true });

  const copiedFiles = [];
  let historyMergedCount = 0;
  let autoSavedMergedCount = 0;

  // 1. Gộp settings.json
  const srcSettingsFile = path.join(dataDir, 'settings.json');
  const dstSettingsFile = path.join(userDataDir, 'settings.json');
  if (fs.existsSync(srcSettingsFile)) {
    try {
      const srcSettings = JSON.parse(fs.readFileSync(srcSettingsFile, 'utf8'));
      let mergedSettings = { ...srcSettings };
      if (fs.existsSync(dstSettingsFile)) {
        try {
          const currentSettings = JSON.parse(fs.readFileSync(dstSettingsFile, 'utf8'));
          mergedSettings = {
            ...srcSettings,
            ...currentSettings,
            // Ưu tiên đường dẫn cũ nếu cấu hình hiện tại đang trống
            destination: currentSettings.destination || srcSettings.destination || '',
            sourceFolder: currentSettings.sourceFolder || srcSettings.sourceFolder || '',
            autoDownloadFolder: currentSettings.autoDownloadFolder || srcSettings.autoDownloadFolder || '',
            autoSave: currentSettings.autoSave !== undefined ? currentSettings.autoSave : (srcSettings.autoSave !== undefined ? srcSettings.autoSave : true)
          };
        } catch {}
      }
      fs.writeFileSync(dstSettingsFile, JSON.stringify(mergedSettings, null, 2), 'utf8');
      copiedFiles.push('settings.json');
    } catch (err) {
      console.warn('[DataMigration] Lỗi gộp settings.json:', err.message);
    }
  }

  // 2. Gộp history.json (khử trùng lặp theo saveId và targetPath)
  const srcHistoryFile = path.join(dataDir, 'history.json');
  const dstHistoryFile = path.join(userDataDir, 'history.json');
  if (fs.existsSync(srcHistoryFile)) {
    try {
      let srcList = JSON.parse(fs.readFileSync(srcHistoryFile, 'utf8'));
      if (!Array.isArray(srcList)) srcList = [];

      let currentList = [];
      if (fs.existsSync(dstHistoryFile)) {
        try {
          currentList = JSON.parse(fs.readFileSync(dstHistoryFile, 'utf8'));
          if (!Array.isArray(currentList)) currentList = [];
        } catch {}
      }

      const existingKeys = new Set(currentList.map(item => item.saveId || item.targetPath || item.path));
      for (const item of srcList) {
        const key = item.saveId || item.targetPath || item.path;
        if (key && !existingKeys.has(key)) {
          currentList.push(item);
          existingKeys.add(key);
          historyMergedCount++;
        }
      }

      fs.writeFileSync(dstHistoryFile, JSON.stringify(currentList, null, 2), 'utf8');
      copiedFiles.push('history.json');
    } catch (err) {
      console.warn('[DataMigration] Lỗi gộp history.json:', err.message);
    }
  }

  // 3. Gộp auto_saved.json (khử trùng lặp theo fileHash hoặc canonicalPath)
  const srcAutoSavedFile = path.join(dataDir, 'auto_saved.json');
  const dstAutoSavedFile = path.join(userDataDir, 'auto_saved.json');
  if (fs.existsSync(srcAutoSavedFile)) {
    try {
      let srcAuto = JSON.parse(fs.readFileSync(srcAutoSavedFile, 'utf8'));
      let currentAuto = {};

      if (fs.existsSync(dstAutoSavedFile)) {
        try {
          currentAuto = JSON.parse(fs.readFileSync(dstAutoSavedFile, 'utf8'));
        } catch {}
      }

      // Xử lý cả dạng mảng lẫn dạng object map
      if (Array.isArray(srcAuto)) {
        if (!Array.isArray(currentAuto)) currentAuto = [];
        const existingHashes = new Set(currentAuto.map(x => (typeof x === 'string' ? x : x.hash || x.canonicalPath)));
        for (const entry of srcAuto) {
          const h = typeof entry === 'string' ? entry : entry.hash || entry.canonicalPath;
          if (h && !existingHashes.has(h)) {
            currentAuto.push(entry);
            existingHashes.add(h);
            autoSavedMergedCount++;
          }
        }
      } else if (typeof srcAuto === 'object' && srcAuto !== null) {
        if (typeof currentAuto !== 'object' || Array.isArray(currentAuto) || currentAuto === null) currentAuto = {};
        for (const [k, v] of Object.entries(srcAuto)) {
          if (!currentAuto[k]) {
            currentAuto[k] = v;
            autoSavedMergedCount++;
          }
        }
      }

      fs.writeFileSync(dstAutoSavedFile, JSON.stringify(currentAuto, null, 2), 'utf8');
      copiedFiles.push('auto_saved.json');
    } catch (err) {
      console.warn('[DataMigration] Lỗi gộp auto_saved.json:', err.message);
    }
  }

  // 4. Sao chép jobs.json nếu có
  const srcJobsFile = path.join(dataDir, 'jobs.json');
  const dstJobsFile = path.join(userDataDir, 'jobs.json');
  if (fs.existsSync(srcJobsFile) && !fs.existsSync(dstJobsFile)) {
    try {
      fs.copyFileSync(srcJobsFile, dstJobsFile);
      copiedFiles.push('jobs.json');
    } catch {}
  }

  return {
    migrated: true,
    from: dataDir,
    copied: copiedFiles,
    historyMergedCount,
    autoSavedMergedCount
  };
}

module.exports = {
  migrateLegacyData,
  importLegacyDataFrom
};
