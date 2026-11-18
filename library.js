const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const DEFAULT_DESTINATION = '';
const DEFAULT_SOURCE = '';
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm']);

/**
 * Thu thập tất cả các file video trong thư mục nguồn và toàn bộ các thư mục con đệ quy
 * (Bỏ qua thư mục đích nếu nằm trong thư mục nguồn để tránh quét lại video đã lưu)
 */
function isSameOrSubDirectory(parentDir, childDir) {
  if (!parentDir || !childDir) return false;
  try {
    const parentResolved = path.resolve(parentDir).toLowerCase();
    const childResolved = path.resolve(childDir).toLowerCase();
    const rel = path.relative(parentResolved, childResolved);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function getAllCandidateVideoFiles(dir, maxDepth = 10, currentDepth = 0, visited = new Set(), excludeDir = null) {
  const results = [];
  if (!dir || currentDepth > maxDepth) return results;

  let realDir;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    return results;
  }
  if (visited.has(realDir)) return results;
  visited.add(realDir);

  // Loại trừ toàn bộ thư mục đích nếu có
  if (excludeDir && isSameOrSubDirectory(excludeDir, realDir)) {
    return results;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // Bỏ qua file/thư mục ẩn và file tạm (.temp_)
    if (entry.name === 'node_modules' || entry.name === '$RECYCLE.BIN' || entry.name === 'System Volume Information') continue;

    const fullPath = path.join(dir, entry.name);

    // Kiểm tra loại trừ thư mục đích
    if (excludeDir && isSameOrSubDirectory(excludeDir, fullPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...getAllCandidateVideoFiles(fullPath, maxDepth, currentDepth + 1, visited, excludeDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXT.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function getBangkokDateTime(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date).map(part => [part.type, part.value]));
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const stampStr = `${dateStr}_${parts.hour}-${parts.minute}-${parts.second}`;
  return { dateStr, stampStr, dateObj: date };
}

function bangkokDateStr(date = new Date()) {
  return getBangkokDateTime(date).dateStr;
}

function bangkokStamp(date = new Date()) {
  return getBangkokDateTime(date).stampStr;
}

function textValue(value) { return typeof value === 'string' ? value.trim() : ''; }

function validateDestination(folder) {
  if (!textValue(folder)) throw new Error('Hãy chọn thư mục gốc lưu video.');
  const resolved = path.resolve(folder);
  let stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat) {
    fs.mkdirSync(resolved, { recursive: true });
    stat = fs.statSync(resolved);
  }
  if (!stat.isDirectory()) throw new Error('Thư mục gốc lưu không hợp lệ.');
  const probe = path.join(resolved, `.tobyflow-write-${crypto.randomUUID()}`);
  fs.writeFileSync(probe, 'ok', { flag: 'wx' });
  fs.unlinkSync(probe);
  return resolved;
}

function validateSource(folder) {
  if (!textValue(folder)) throw new Error('Hãy chọn thư mục nguồn tải về.');
  const resolved = path.resolve(folder);
  let stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat) {
    fs.mkdirSync(resolved, { recursive: true });
    stat = fs.statSync(resolved);
  }
  if (!stat.isDirectory()) throw new Error('Thư mục nguồn tải về không hợp lệ.');
  return resolved;
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * Kiểm tra file có đang tải dở hoặc đang thay đổi dung lượng không
 * (Bỏ qua .crdownload, .tmp, .part, .download và file kích thước đang thay đổi)
 */
async function isFileDownloadingOrUnstable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.crdownload', '.tmp', '.part', '.download'].includes(ext)) {
    return true; // File tải dở của trình duyệt
  }

  let s1;
  try { s1 = await fsp.stat(filePath); } catch { return true; }
  if (s1.size < 1024) return true; // File quá nhỏ (< 1KB)

  // Kiểm tra kích thước sau 150ms để phát hiện file đang được Chrome ghi
  await new Promise(r => setTimeout(r, 150));
  let s2;
  try { s2 = await fsp.stat(filePath); } catch { return true; }
  if (s2.size !== s1.size || Math.abs(s2.mtimeMs - s1.mtimeMs) > 1) return true; // Kích thước hoặc thời gian sửa vẫn đang thay đổi

  // Thử mở đọc kiểm tra xem file có bị khóa độc quyền không
  try {
    const handle = await fsp.open(filePath, 'r');
    await handle.close();
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') return true;
  }

  return false;
}

function resolveFfprobePath() {
  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH;
  }
  // Packaged Electron extraResources: <resourcesPath>/bin/ffprobe.exe
  if (process.resourcesPath) {
    const packagedPath = path.join(process.resourcesPath, 'bin', 'ffprobe.exe');
    if (fs.existsSync(packagedPath)) return packagedPath;
  }
  // Local project bin: <projectRoot>/bin/ffprobe.exe
  const localPath = path.join(__dirname, 'bin', 'ffprobe.exe');
  if (fs.existsSync(localPath)) return localPath;

  // Fallback to system PATH
  return 'ffprobe';
}

/**
 * Kiểm tra tính toàn vẹn và luồng video bằng ffprobe
 * Hỗ trợ MP4, WebM và QuickTime MOV/M4V
 */
async function validateVideo(file) {
  const stat = await fsp.stat(file);
  if (stat.size < 1024) throw new Error('File quá nhỏ để là video hợp lệ (< 1KB).');

  const handle = await fsp.open(file, 'r');
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }

  const typeTag = header.toString('ascii', 4, 8);
  const isMp4OrMov = typeTag === 'ftyp' || typeTag === 'moov' || typeTag === 'wide' || typeTag === 'mdat';
  const isWebm = header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!isMp4OrMov && !isWebm) throw new Error('Dữ liệu không có định dạng video hợp lệ (MP4/WebM/MOV).');

  const ffprobeBin = resolveFfprobePath();
  try {
    const { stdout } = await execFileAsync(ffprobeBin, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type',
      '-of', 'json', file
    ], { timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true });
    const parsed = JSON.parse(stdout);
    if (!parsed.streams?.some(stream => stream.codec_type === 'video')) {
      throw new Error('ffprobe không tìm thấy luồng hình video hợp lệ.');
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Máy tính chưa có ffprobe để xác nhận video phát được. Vui lòng cài FFmpeg.');
    }
    throw new Error(`Video không đọc/phát được (ffprobe): ${error.message}`);
  }

  return { size: stat.size, extension: isWebm ? '.webm' : (path.extname(file).toLowerCase() || '.mp4') };
}

class VideoLibrary {
  constructor(options = {}) {
    this.options = options;
    this.dataDir = options.dataDir || process.env.TOBYFLOW_DATA_DIR || path.join(__dirname, 'data');
    this.settingsFile = options.settingsFile || path.join(this.dataDir, 'settings.json');
    this.historyFile = options.historyFile || path.join(this.dataDir, 'history.json');
    this.autoSavedFile = options.autoSavedFile || path.join(this.dataDir, 'auto_saved.json');

    this.settings = readJson(this.settingsFile, {
      destination: '',
      sourceFolder: '',
      autoDownloadFolder: '',
      autoSave: true
    });

    if (this.settings.autoSave === undefined) {
      this.settings.autoSave = true;
    }

    // Đồng bộ sourceFolder và autoDownloadFolder
    if (!this.settings.sourceFolder && this.settings.autoDownloadFolder) {
      this.settings.sourceFolder = this.settings.autoDownloadFolder;
    }
    if (!this.settings.autoDownloadFolder && this.settings.sourceFolder) {
      this.settings.autoDownloadFolder = this.settings.sourceFolder;
    }

    this.history = this._loadHistoryNormalized(this.historyFile);
    this.processedSources = readJson(this.autoSavedFile, {});

    this.results = new Map();
    this.fileCache = new Map();
    this.cacheStats = { hits: 0, misses: 0 };

    this.isScanning = false;
    this.currentScanPromise = null;
    this.queuedScanPromise = null;
    this.saving = false;
    this.watcher = null;
    this.pollInterval = null;

    // Hàng đợi tự động lưu video
    this.autoSaveQueue = [];
    this.isProcessingQueue = false;
    this.autoSaveStats = {
      pending: 0,
      processing: 0,
      saved: Object.values(this.processedSources).filter(p => p && p.status === 'saved').length,
      failed: 0,
      lastSavedPath: ''
    };

    if (this.settings.destination) {
      try { validateDestination(this.settings.destination); } catch { }
    }
  }

  /**
   * Tải và chuẩn hóa lịch sử (tương thích ngược hoàn toàn với dữ liệu cũ)
   */
  _loadHistoryNormalized(file) {
    const raw = readJson(file, {});
    const normalized = {};

    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== 'object' || !item.path) continue;
        const saveId = item.saveId || item.id || `save_${crypto.randomUUID()}`;
        normalized[saveId] = {
          ...item,
          saveId,
          id: saveId,
          videoId: item.videoId || item.id || ''
        };
      }
    } else if (raw && typeof raw === 'object') {
      for (const [key, item] of Object.entries(raw)) {
        if (!item || typeof item !== 'object' || !item.path) continue;
        const saveId = item.saveId || (key.startsWith('save_') ? key : `save_${key}_${item.savedAt ? new Date(item.savedAt).getTime() : Date.now()}`);
        normalized[saveId] = {
          ...item,
          saveId,
          id: saveId,
          videoId: item.videoId || item.id || key
        };
      }
    }

    return normalized;
  }

  publicSettings() {
    const destRoot = this.settings.destination || '';
    const srcFolder = this.settings.sourceFolder || this.settings.autoDownloadFolder || '';
    const today = bangkokDateStr();
    const todaySubfolder = destRoot ? path.join(destRoot, today) : '';
    const sampleExpectedPath = todaySubfolder ? path.join(todaySubfolder, `${today}_15-32-08_001.mp4`) : '';

    return {
      destination: destRoot,
      sourceFolder: srcFolder,
      autoDownloadFolder: srcFolder,
      autoSave: Boolean(this.settings.autoSave !== false),
      todayDate: today,
      todaySubfolder,
      sampleExpectedPath
    };
  }

  setAutoSave(enabled) {
    this.settings.autoSave = Boolean(enabled);
    writeJson(this.settingsFile, this.settings);
    if (this.settings.autoSave) {
      this.scanSourceFolder().catch(() => { });
    }
    return this.publicSettings();
  }

  setDestination(folder) {
    const resolved = validateDestination(folder);
    if (this.settings.sourceFolder && isSameOrSubDirectory(this.settings.sourceFolder, resolved)) {
      throw new Error('Thư mục gốc lưu trữ không được nằm bên trong hoặc trùng với thư mục nguồn tải về để tránh quét lại video đã lưu.');
    }
    this.settings.destination = resolved;
    writeJson(this.settingsFile, this.settings);
    if (this.settings.autoSave && this.settings.sourceFolder) {
      this.scanSourceFolder().catch(() => { });
    }
    return this.publicSettings();
  }

  setSourceFolder(folder) {
    const resolved = validateSource(folder);
    if (this.settings.destination && isSameOrSubDirectory(resolved, this.settings.destination)) {
      throw new Error('Thư mục nguồn tải về không được chứa thư mục lưu trữ để tránh quét lại video đã lưu.');
    }
    this.settings.sourceFolder = resolved;
    this.settings.autoDownloadFolder = this.settings.sourceFolder;
    writeJson(this.settingsFile, this.settings);
    if (this.options?.enableWatcher !== false) {
      this.startWatcher();
    }
    if (this.settings.autoSave) {
      this.scanSourceFolder().catch(() => { });
    }
    return this.publicSettings();
  }

  setAutoDownloadFolder(folder) {
    return this.setSourceFolder(folder);
  }

  /**
   * Quét thư mục nguồn tải về của Chrome / TobyFlow (bao gồm mọi thư mục con)
   * - Cache kết quả theo đường dẫn, kích thước và mtime
   * - Xếp hàng Promise: Khi người dùng bấm Quét trong lúc đang quét, kết quả trả về phải chờ lượt quét mới hoàn thành, không trả danh sách cũ
   * - Loại trừ thư mục đích nếu có
   * - Cập nhật available = false khi file nguồn bị xóa
   * - Nếu bật Tự động lưu: tự động đưa video hợp lệ chưa lưu vào hàng đợi tự lưu
   */
  scanSourceFolder(customFolder = null) {
    if (this.isScanning) {
      if (!this.queuedScanPromise) {
        this.queuedScanPromise = (async () => {
          try {
            await this.currentScanPromise;
          } catch { }
          return await this._executeScan(customFolder);
        })().finally(() => {
          this.queuedScanPromise = null;
        });
      }
      return this.queuedScanPromise;
    }

    return this._executeScan(customFolder);
  }

  async _executeScan(customFolder) {
    this.isScanning = true;
    this.currentScanPromise = this._doScan(customFolder);
    try {
      return await this.currentScanPromise;
    } finally {
      this.isScanning = false;
      this.currentScanPromise = null;
    }
  }

  async _doScan(customFolder = null) {
    const folder = customFolder || this.settings.sourceFolder || this.settings.autoDownloadFolder;
    if (!folder || !fs.existsSync(folder)) return this.list();

    const excludeDir = this.settings.destination || null;
    const candidateFiles = getAllCandidateVideoFiles(folder, 10, 0, new Set(), excludeDir);
    const currentCanonicalPaths = new Set();

    for (const fullPath of candidateFiles) {
      const filename = path.basename(fullPath);
      const ext = path.extname(filename).toLowerCase();
      if (!VIDEO_EXT.has(ext)) continue;
      if (filename.startsWith('.')) continue;

      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      if (stat.size < 1024) continue;

      const canonicalPath = path.resolve(fullPath);
      currentCanonicalPaths.add(canonicalPath);

      let cached = this.fileCache.get(canonicalPath);
      let id, media, fileHash;

      if (cached && cached.valid && cached.size === stat.size && Math.abs(cached.mtimeMs - stat.mtimeMs) < 1) {
        this.cacheStats.hits++;
        id = cached.id;
        media = cached.media;
        fileHash = cached.fileHash;
      } else {
        this.cacheStats.misses++;
        const downloading = await isFileDownloadingOrUnstable(fullPath);
        if (downloading) continue;

        try {
          media = await validateVideo(fullPath);
        } catch {
          continue; // File hỏng hoặc chưa ghi xong -> Bỏ qua
        }

        try {
          fileHash = await hashFile(fullPath);
        } catch {
          continue;
        }

        id = fileHash.slice(0, 20);
        this.fileCache.set(canonicalPath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          id,
          media,
          fileHash,
          valid: true
        });
      }

      const relPath = path.relative(folder, fullPath);
      const rawSub = path.dirname(relPath);
      const subfolder = (rawSub === '.' || rawSub === '') ? '' : rawSub;
      const displayName = subfolder ? `${subfolder}\\${filename}` : filename;
      const promptName = subfolder
        ? `[${subfolder}] ${filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ')}`
        : filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');

      const lastSaved = this.getLastSavedForVideo(id);

      if (!this.results.has(id)) {
        this.results.set(id, {
          id,
          source: fullPath,
          name: filename,
          displayName,
          relativePath: relPath,
          subfolder,
          prompt: promptName,
          provider: 'AutoFlow Pro (TobyFlow)',
          jobId: '',
          createdAt: stat.mtime.toISOString(),
          size: stat.size,
          available: true,
          saved: lastSaved
        });
      } else {
        const existing = this.results.get(id);
        existing.source = fullPath;
        existing.name = filename;
        existing.displayName = displayName;
        existing.relativePath = relPath;
        existing.subfolder = subfolder;
        existing.available = true;
        existing.saved = lastSaved;
      }

      // Nếu chế độ Tự động lưu đang bật và đã cấu hình thư mục đích:
      // Tự động xếp hàng để lưu video chưa lưu
      if (this.settings.autoSave && this.settings.destination) {
        this._enqueueAutoSave({
          id,
          source: fullPath,
          canonicalPath,
          name: filename,
          displayName,
          subfolder,
          prompt: promptName,
          size: stat.size,
          fileHash,
          media
        });
      }
    }

    // Khi file nguồn bị xóa: cập nhật available = false trong library (không giữ available: true)
    for (const [id, item] of this.results.entries()) {
      if (item.source && (!currentCanonicalPaths.has(path.resolve(item.source)) || !fs.existsSync(item.source))) {
        item.available = false;
      }
    }

    // Dọn dẹp cache cho các file không còn tồn tại trên đĩa
    for (const cachedPath of this.fileCache.keys()) {
      if (!currentCanonicalPaths.has(cachedPath) && !fs.existsSync(cachedPath)) {
        this.fileCache.delete(cachedPath);
      }
    }

    // Nếu chế độ Tự động lưu đang bật và đã cấu hình thư mục đích:
    // Chờ xử lý hàng đợi tự lưu hoàn tất để đảm bảo tính đồng bộ
    if (this.settings.autoSave && this.settings.destination) {
      await this.processAutoSaveQueue();
    }

    return this.list();
  }

  /**
   * Đưa video vào hàng đợi tự động lưu:
   * - Khử trùng lặp bền vững theo đường dẫn nguồn và hash nội dung
   * - Hai file tải xuống khác nhau (đường dẫn khác nhau) được xử lý riêng dù nội dung giống nhau
   */
  _enqueueAutoSave(item) {
    const canonical = item.canonicalPath || path.resolve(item.source);

    // 1. Kiểm tra xem file nguồn này đã được tự lưu thành công trước đó chưa
    const processed = this.processedSources[canonical];
    if (processed && processed.status === 'saved' && processed.fileHash === item.fileHash) {
      return; // File nguồn này đã được tự lưu, không lưu trùng
    }

    // 2. Kiểm tra hàng đợi hiện tại trong bộ nhớ
    const existingQueueItem = this.autoSaveQueue.find(q => q.canonicalPath === canonical);
    if (existingQueueItem) {
      if (existingQueueItem.status === 'pending' || existingQueueItem.status === 'processing') {
        return; // Đang trong hàng đợi
      }
      if (existingQueueItem.status === 'saved' && existingQueueItem.fileHash === item.fileHash) {
        return; // Đã lưu xong
      }
      if (existingQueueItem.status === 'error') {
        // Nếu trước đó lỗi nhưng file nguồn thay đổi hash, cho phép tự lưu lại
        if (existingQueueItem.fileHash !== item.fileHash) {
          existingQueueItem.fileHash = item.fileHash;
          existingQueueItem.status = 'pending';
          existingQueueItem.error = null;
        } else {
          return; // Vẫn đang lỗi, chờ bấm 'Thử lại'
        }
      }
    } else {
      this.autoSaveQueue.push({
        id: item.id,
        source: item.source,
        canonicalPath: canonical,
        name: item.name,
        displayName: item.displayName,
        subfolder: item.subfolder,
        prompt: item.prompt,
        size: item.size,
        fileHash: item.fileHash,
        media: item.media,
        status: 'pending',
        error: null,
        enqueuedAt: Date.now()
      });
    }

    this._updateQueueStats();
    if (!this.isScanning) {
      this.processAutoSaveQueue().catch(() => { });
    }
  }

  _updateQueueStats() {
    const pending = this.autoSaveQueue.filter(q => q.status === 'pending').length;
    const processing = this.autoSaveQueue.filter(q => q.status === 'processing').length;
    const saved = Object.values(this.processedSources).filter(p => p && p.status === 'saved').length;
    const failed = this.autoSaveQueue.filter(q => q.status === 'error').length;

    this.autoSaveStats.pending = pending;
    this.autoSaveStats.processing = processing;
    this.autoSaveStats.saved = saved;
    this.autoSaveStats.failed = failed;
  }

  /**
   * Xử lý tuần tự hàng đợi tự động lưu:
   * - Xử lý lần lượt từng video
   * - Nếu một video lỗi, ghi nhận lỗi đúng video đó và tiếp tục xử lý các video khác
   */
  async processAutoSaveQueue() {
    if (this.isProcessingQueue) return;
    if (!this.settings.autoSave || !this.settings.destination) return;

    this.isProcessingQueue = true;
    try {
      while (true) {
        const item = this.autoSaveQueue.find(q => q.status === 'pending');
        if (!item) break;

        item.status = 'processing';
        this._updateQueueStats();

        try {
          // Bỏ qua file tải dở hoặc dung lượng chưa ổn định
          const downloading = await isFileDownloadingOrUnstable(item.source);
          if (downloading) {
            item.status = 'pending';
            break; // Chờ ở chu kỳ kiểm tra tiếp theo khi tải xong
          }

          const saveRes = await this._performSaveVideo(item.source, {
            videoId: item.id,
            displayName: item.displayName,
            name: item.name,
            prompt: item.prompt,
            sourceHash: item.fileHash
          });

          item.status = 'saved';
          item.saveId = saveRes.saveId;
          item.finalPath = saveRes.path;
          item.error = null;
          this.autoSaveStats.lastSavedPath = saveRes.path;

          const videoInResults = this.results.get(item.id);
          if (videoInResults) {
            videoInResults.saved = saveRes.record;
          }
        } catch (err) {
          item.status = 'error';
          item.error = err.message;
          this.processedSources[item.canonicalPath] = {
            fileHash: item.fileHash,
            status: 'error',
            error: err.message,
            failedAt: new Date().toISOString()
          };
          writeJson(this.autoSavedFile, this.processedSources);
          // Tiếp tục vòng lặp để xử lý các video khác trong hàng đợi!
        }

        this._updateQueueStats();
      }
    } finally {
      this.isProcessingQueue = false;
      this._updateQueueStats();
    }
  }

  /**
   * Thử lại cho một video bị lỗi
   */
  retryAutoSave(idOrPath) {
    const canonical = path.resolve(idOrPath);
    const item = this.autoSaveQueue.find(q => q.id === idOrPath || q.canonicalPath === canonical || q.source === idOrPath);
    if (!item) {
      if (this.processedSources[canonical]) {
        delete this.processedSources[canonical];
        writeJson(this.autoSavedFile, this.processedSources);
        this.scanSourceFolder().catch(() => { });
        return { ok: true, message: 'Đã đặt lại trạng thái xử lý để tự động lưu lại.' };
      }
      throw new Error('Không tìm thấy video trong hàng đợi hoặc danh sách lỗi.');
    }

    item.status = 'pending';
    item.error = null;
    if (this.processedSources[item.canonicalPath]) {
      delete this.processedSources[item.canonicalPath];
      writeJson(this.autoSavedFile, this.processedSources);
    }
    this._updateQueueStats();
    this.processAutoSaveQueue().catch(() => { });
    return { ok: true, item };
  }

  retryAllFailed() {
    let count = 0;
    for (const item of this.autoSaveQueue) {
      if (item.status === 'error') {
        item.status = 'pending';
        item.error = null;
        if (this.processedSources[item.canonicalPath]) {
          delete this.processedSources[item.canonicalPath];
        }
        count++;
      }
    }
    writeJson(this.autoSavedFile, this.processedSources);
    this._updateQueueStats();
    if (count > 0) {
      this.processAutoSaveQueue().catch(() => { });
    }
    return { ok: true, retriedCount: count };
  }

  getAutoSaveStatus() {
    this._updateQueueStats();
    return {
      enabled: Boolean(this.settings.autoSave !== false),
      stats: { ...this.autoSaveStats },
      queue: this.autoSaveQueue.map(q => ({
        id: q.id,
        name: q.displayName || q.name,
        source: q.source,
        size: q.size,
        status: q.status,
        error: q.error,
        finalPath: q.finalPath,
        saveId: q.saveId
      }))
    };
  }

  /**
   * Thực hiện lưu video nguyên tử:
   * - Tạo thư mục theo ngày (YYYY-MM-DD theo giờ Asia/Bangkok)
   * - Sao chép vào file tạm .temp_save_<uuid><ext>
   * - Xác thực bằng ffprobe và SHA-256
   * - Xuất bản độc quyền với COPYFILE_EXCL: Nếu hai tiến trình cùng chọn một tên, kernel từ chối với EEXIST, chuyển sang _002, tuyệt đối không ghi đè
   * - Dọn dẹp file tạm trong finally nếu có lỗi (không để lại MP4 hỏng)
   * - Giữ nguyên 100% file gốc
   * - Tạo bản ghi lịch sử với saveId riêng biệt
   * - Cập nhật processedSources bền vững
   */
  async _performSaveVideo(sourcePath, options = {}) {
    if (!this.settings.destination) {
      throw new Error('Chưa cấu hình thư mục gốc lưu trữ.');
    }
    const destRoot = validateDestination(this.settings.destination);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`File nguồn không tồn tại trên đĩa: ${sourcePath}`);
    }

    const { dateStr, stampStr } = getBangkokDateTime(new Date());
    const dateSubfolder = path.join(destRoot, dateStr);
    fs.mkdirSync(dateSubfolder, { recursive: true });

    // Dọn các file tạm cũ nếu có
    try {
      const existingTempFiles = fs.readdirSync(dateSubfolder).filter(f => f.startsWith('.temp_save_'));
      for (const oldTemp of existingTempFiles) {
        fs.unlinkSync(path.join(dateSubfolder, oldTemp));
      }
    } catch { }

    const ext = path.extname(sourcePath).toLowerCase() || '.mp4';
    const tempFilename = `.temp_save_${crypto.randomUUID()}${ext}`;
    const tempPath = path.join(dateSubfolder, tempFilename);
    let publishedSuccessfully = false;
    let finalPath = null;
    let saveId = null;

    try {
      const sourceHash = options.sourceHash || await hashFile(sourcePath);

      // 1. Sao chép an toàn vào file tạm trong thư mục ngày
      await fsp.copyFile(sourcePath, tempPath, fs.constants.COPYFILE_EXCL);

      // 2. Xác thực tính toàn vẹn và luồng video trên file tạm
      const media = await validateVideo(tempPath);

      // 3. Đối chiếu mã băm SHA-256 trên file tạm
      const tempHash = await hashFile(tempPath);
      if (tempHash !== sourceHash) {
        throw new Error('Mã băm SHA-256 của file đã sao chép không khớp với file gốc.');
      }

      // 4. Xuất bản file bằng cơ chế chống ghi đè khi hai tiến trình tranh cùng tên
      // Dùng COPYFILE_EXCL: Nếu file đã tồn tại, kernel trả về EEXIST, không bao giờ ghi đè
      for (let index = 1; index < 10000; index++) {
        const candidateName = `${stampStr}_${String(index).padStart(3, '0')}${ext}`;
        const candidatePath = path.join(dateSubfolder, candidateName);

        try {
          await fsp.copyFile(tempPath, candidatePath, fs.constants.COPYFILE_EXCL);
          finalPath = candidatePath;
          publishedSuccessfully = true;
          await fsp.unlink(tempPath).catch(() => { });
          break;
        } catch (copyErr) {
          if (copyErr.code === 'EEXIST') {
            continue; // Tên đã bị tiến trình khác chiếm -> tiếp tục số tiếp theo
          }
          throw copyErr;
        }
      }

      if (!finalPath) {
        throw new Error('Không tìm được tên file trống trong thư mục ngày.');
      }

      // 5. Cập nhật lịch sử với saveId riêng biệt
      saveId = `save_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const savedRecord = {
        saveId,
        id: saveId,
        videoId: options.videoId || sourceHash.slice(0, 20),
        path: finalPath,
        filename: path.basename(finalPath),
        dateFolder: dateSubfolder,
        date: dateStr,
        size: media.size,
        savedAt: new Date().toISOString(),
        savedAtBangkok: stampStr,
        name: options.displayName || options.name || path.basename(finalPath),
        prompt: options.prompt || '',
        source: sourcePath,
        fileHash: sourceHash
      };

      this.history[saveId] = savedRecord;
      writeJson(this.historyFile, this.history);

      // 6. Ghi nhận trạng thái xử lý bền vững theo đường dẫn nguồn và hash nội dung
      const canonicalSource = path.resolve(sourcePath);
      this.processedSources[canonicalSource] = {
        fileHash: sourceHash,
        saveId,
        finalPath,
        savedAt: savedRecord.savedAt,
        status: 'saved'
      };
      writeJson(this.autoSavedFile, this.processedSources);

      return {
        saveId,
        id: saveId,
        videoId: savedRecord.videoId,
        path: finalPath,
        filename: path.basename(finalPath),
        dateFolder: dateSubfolder,
        record: savedRecord
      };
    } finally {
      // Dọn dẹp file tạm trong finally: nếu có lỗi hoặc ném exception giữa chừng, xóa sạch
      if (!publishedSuccessfully && tempPath) {
        try {
          if (fs.existsSync(tempPath)) {
            await fsp.unlink(tempPath);
          }
        } catch { }
      }
    }
  }

  /**
   * Theo dõi tự động thư mục tải về khi có file mới (bao gồm mọi thư mục con)
   * và kích hoạt kiểm tra nền định kỳ mỗi 4 giây
   */
  startWatcher() {
    this.stopWatcher();
    if (this.options?.enableWatcher === false) return;
    const folder = this.settings.sourceFolder || this.settings.autoDownloadFolder;
    if (!folder || !fs.existsSync(folder)) return;

    try {
      const canonicalFolder = fs.realpathSync?.native ? fs.realpathSync.native(folder) : fs.realpathSync(folder);
      let debounce = null;
      this.watcher = fs.watch(canonicalFolder, { recursive: true, persistent: false }, (eventType, filename) => {
        if (filename) {
          const ext = path.extname(filename).toLowerCase();
          if (['.crdownload', '.tmp', '.part', '.download'].includes(ext)) return;
        }

        clearTimeout(debounce);
        debounce = setTimeout(() => {
          this.scanSourceFolder().catch(() => { });
        }, 1000);
      });
    } catch (err) {
      console.warn('[Library] Không thể khởi động watcher thư mục:', err.message);
    }

    // Quét nền định kỳ mỗi 4s: đảm bảo Studio tự lưu khi cửa sổ trình duyệt thu nhỏ hoặc đóng
    if (this.options?.enableBackgroundPoll !== false && !this.pollInterval) {
      this.pollInterval = setInterval(() => {
        this.scanSourceFolder().catch(() => { });
      }, 4000);
    }
  }

  stopWatcher() {
    if (this.watcher) {
      try { this.watcher.close(); } catch { }
      this.watcher = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  list() {
    return [...this.results.values()].map((rawItem) => {
      const isAvail = Boolean(rawItem.available && rawItem.source && fs.existsSync(rawItem.source));
      const { source, ...item } = rawItem;
      return {
        ...item,
        available: isAvail,
        saved: this.getLastSavedForVideo(item.id),
        sourceType: 'local'
      };
    });
  }

  get(id) {
    const item = this.results.get(id);
    if (!item) return null;
    item.available = Boolean(item.available && item.source && fs.existsSync(item.source));
    return item;
  }

  getResultsByJobId(jobId) {
    if (!jobId) return [];
    return [...this.results.values()].filter(item => item.jobId === String(jobId));
  }

  getHistoryList() {
    const list = [];
    for (const record of Object.values(this.history)) {
      list.push({
        ...record,
        id: record.saveId || record.id,
        saveId: record.saveId || record.id,
        videoId: record.videoId || '',
        exists: fs.existsSync(record.path)
      });
    }
    return list.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  }

  getLastSavedForVideo(videoId) {
    if (!videoId) return null;
    const matches = Object.values(this.history)
      .filter(h => h.videoId === videoId || h.id === videoId)
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    return matches[0] || null;
  }

  getHistoryItem(idOrPath) {
    if (!idOrPath) return null;
    if (this.history[idOrPath]) return this.history[idOrPath];
    for (const record of Object.values(this.history)) {
      if (record.saveId === idOrPath || record.id === idOrPath || record.path === idOrPath) {
        return record;
      }
    }
    for (const record of Object.values(this.history)) {
      if (record.videoId === idOrPath) {
        return record;
      }
    }
    return null;
  }

  addResults(items, context = {}) {
    const list = Array.isArray(items) ? items : [items];
    for (const it of list) {
      const src = typeof it === 'string' ? it : (it.url || it.source || it.path || '');
      if (!src) continue;
      const id = crypto.createHash('sha256').update(src).digest('hex').slice(0, 20);
      if (!this.results.has(id)) {
        this.results.set(id, {
          id,
          source: src,
          name: it.title || it.name || path.basename(src),
          prompt: context.prompt || it.prompt || '',
          provider: context.provider || it.provider || 'AutoFlow Pro',
          jobId: context.jobId || it.jobId || '',
          createdAt: new Date().toISOString(),
          available: fs.existsSync(src) || /^https?:\/\//.test(src),
          saved: this.getLastSavedForVideo(id)
        });
      }
    }
    return this.list();
  }

  setResults(items) {
    return this.addResults(items);
  }

  /**
   * Lưu thủ công các video đã chọn (Phương án dự phòng):
   * Sử dụng chung cơ chế lưu nguyên tử _performSaveVideo
   */
  async saveSelected(ids) {
    if (this.saving) throw new Error('Hệ thống đang lưu một nhóm video khác. Vui lòng chờ.');
    if (!this.settings.destination) {
      throw new Error('Chưa cấu hình thư mục gốc lưu trữ. Vui lòng vào Cài đặt để chọn thư mục.');
    }
    this.saving = true;
    const saved = [], errors = [];

    try {
      const destRoot = validateDestination(this.settings.destination);
      const uniqueIds = [...new Set(ids)];

      for (const id of uniqueIds) {
        const item = this.results.get(id);
        if (!item) {
          errors.push({ id, error: 'Video không còn trong danh sách.' });
          continue;
        }

        if (!item.source || !fs.existsSync(item.source)) {
          errors.push({ id, error: `File nguồn không tồn tại trên đĩa: ${item.source}` });
          continue;
        }

        try {
          const res = await this._performSaveVideo(item.source, {
            videoId: id,
            displayName: item.displayName,
            name: item.name,
            prompt: item.prompt
          });
          item.saved = res.record;
          saved.push({
            saveId: res.saveId,
            id: res.saveId,
            videoId: id,
            path: res.path,
            filename: res.filename,
            dateFolder: res.dateFolder
          });
        } catch (error) {
          errors.push({ id, error: error.message });
        }
      }

      return { saved, errors, dateFolder: path.join(destRoot, bangkokDateStr()) };
    } finally {
      this.saving = false;
    }
  }
}

module.exports = {
  VideoLibrary,
  getBangkokDateTime,
  bangkokDateStr,
  bangkokStamp,
  validateVideo,
  validateDestination,
  validateSource,
  hashFile,
  isFileDownloadingOrUnstable,
  isSameOrSubDirectory,
  getAllCandidateVideoFiles,
  resolveFfprobePath,
  DEFAULT_DESTINATION,
  DEFAULT_SOURCE
};
