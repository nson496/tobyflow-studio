// TobyFlow Studio - AutoFlow Pro Client
const state = {
  view: 'library',
  results: [],
  history: [],
  queue: [],
  selected: new Set(),
  libFilter: 'all',
  settings: {},
  autoSave: true,
  autoSaveStats: { pending: 0, processing: 0, saved: 0, failed: 0, lastSavedPath: '' },
  previewId: null,
  loading: false,
  scanning: false
};

const $ = id => document.getElementById(id);

async function api(route, options = {}) {
  const headers = {
    'X-TobyFlow': '1',
    'X-TobyFlow-Save': '1',
    ...(options.headers || {})
  };
  if (options.method && options.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(route, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function post(route, body = {}) {
  return api(route, { method: 'POST', body: JSON.stringify(body) });
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 5500);
}

function escapeJsArg(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function dateLabel(val) {
  if (!val) return 'Chưa rõ';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).format(d);
  } catch {
    return val;
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// --- Navigation ---
function switchView(viewName) {
  state.view = viewName;
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  const panel = $(`view-${viewName}`);
  if (panel) panel.classList.add('active');

  const btn = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  if (btn) btn.classList.add('active');

  const titles = {
    library: 'Thư viện video (AutoFlow Pro)',
    history: 'Video đã lưu & Lịch sử',
    settings: 'Cài đặt Thư mục & Tự Động Lưu'
  };
  $('topbar-current-view').textContent = titles[viewName] || viewName;

  if (viewName === 'library') renderLibrary();
  if (viewName === 'history') loadHistory();
}

// --- Live Bangkok Clock ---
function startClock() {
  function tick() {
    const clockEl = $('clock');
    if (!clockEl) return;
    try {
      clockEl.textContent = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      }).format(new Date()) + ' (Bangkok)';
    } catch {}
  }
  tick();
  setInterval(tick, 1000);
}

// --- Status & Settings Loading ---
async function loadStatus() {
  try {
    const data = await api('/api/status');
    state.settings = data.settings || {};
    state.autoSave = Boolean(data.autoSave);
    state.autoSaveStats = data.autoSaveStats || { pending: 0, processing: 0, saved: 0, failed: 0, lastSavedPath: '' };

    // Update Overview & Destination labels
    const destRoot = state.settings.destination || '';
    const srcFolder = state.settings.sourceFolder || '';
    const todayFolder = state.settings.todaySubfolder || '';

    $('destination-label').textContent = destRoot || 'Chưa chọn (Bấm để chọn ↗)';
    $('destination-label').title = destRoot || 'Chưa chọn';
    $('quick-source-label').textContent = srcFolder || 'Chưa chọn (Bấm để chọn ↗)';
    $('quick-source-label').title = srcFolder || 'Chưa chọn';

    $('today-subfolder-path').textContent = todayFolder || 'Chưa chọn thư mục gốc';
    $('preview-filename-sample').textContent = state.settings.sampleExpectedPath || 'Chưa cấu hình thư mục lưu';

    // Populate Settings inputs if on settings view
    if ($('settings-source-folder')) $('settings-source-folder').value = srcFolder;
    if ($('settings-destination')) $('settings-destination').value = destRoot;
    if ($('settings-autosave-toggle')) $('settings-autosave-toggle').checked = state.autoSave;

    // Guidance Banner when unconfigured
    const banner = $('unconfigured-banner');
    const bannerText = $('unconfigured-text');
    if (banner) {
      if (!srcFolder && !destRoot) {
        banner.hidden = false;
        if (bannerText) bannerText.textContent = 'Bạn chưa chọn Thư mục nguồn (Downloads của Chrome) và Thư mục gốc lưu trữ. Hãy cấu hình để bắt đầu sử dụng.';
      } else if (!srcFolder) {
        banner.hidden = false;
        if (bannerText) bannerText.textContent = 'Chưa chọn Thư mục nguồn (Downloads của Chrome). Studio cần biết thư mục tải về để tự động phát hiện video.';
      } else if (!destRoot) {
        banner.hidden = false;
        if (bannerText) bannerText.textContent = 'Chưa chọn Thư mục gốc lưu trữ. Hãy chọn thư mục để Studio tạo thư mục con và lưu video theo ngày.';
      } else {
        banner.hidden = true;
      }
    }

    // Auto-Save Control & Status Panel
    const badge = $('autosave-badge');
    const btnIcon = $('btn-toggle-autosave-icon');
    const btnText = $('btn-toggle-autosave-text');

    if (badge) {
      badge.className = `video-badge ${state.autoSave ? 'badge-saved' : 'badge-unsaved'}`;
      badge.textContent = state.autoSave ? 'ĐANG BẬT' : 'ĐÃ TẮT';
    }
    if (btnIcon && btnText) {
      btnIcon.textContent = state.autoSave ? '⏸' : '▶';
      btnText.textContent = state.autoSave ? 'Tạm dừng Tự Động Lưu' : 'Bật Tự Động Lưu';
    }

    // Auto-Save Counters
    if ($('stat-queue-pending')) $('stat-queue-pending').textContent = state.autoSaveStats.pending || 0;
    if ($('stat-queue-processing')) $('stat-queue-processing').textContent = state.autoSaveStats.processing || 0;
    if ($('stat-queue-saved')) $('stat-queue-saved').textContent = state.autoSaveStats.saved || 0;
    if ($('stat-queue-failed')) $('stat-queue-failed').textContent = state.autoSaveStats.failed || 0;

    const lastPathEl = $('last-saved-path');
    if (lastPathEl) {
      lastPathEl.textContent = state.autoSaveStats.lastSavedPath || 'Chưa có video mới được lưu';
      lastPathEl.title = state.autoSaveStats.lastSavedPath || '';
    }

    const failedBox = $('failed-retry-container');
    if (failedBox) {
      failedBox.hidden = !(state.autoSaveStats.failed > 0);
    }

    // Sidebar status
    $('connection-title').textContent = state.autoSave ? 'Tự Động Lưu: BẬT' : 'Tự Động Lưu: TẮT';
    $('connection-subtitle').textContent = srcFolder ? `Nguồn: ${srcFolder.split(/[\\/]/).pop() || srcFolder}` : 'Chưa chọn thư mục nguồn';

    // Update Stat Badges
    $('stat-saved').textContent = data.savedCount || 0;
    $('nav-saved-count').textContent = data.savedCount || 0;
  } catch (err) {
    console.warn('[Status] Không tải được trạng thái:', err.message);
  }
}

// --- Toggle Auto-Save ---
async function toggleAutoSave() {
  try {
    const nextState = !state.autoSave;
    const res = await post('/api/auto-save', { enabled: nextState });
    state.autoSave = res.autoSave.enabled;
    toast(state.autoSave ? '⚡ Đã BẬT chế độ Tự Động Lưu Video!' : '⏸ Đã TẮT chế độ Tự Động Lưu.');
    await loadStatus();
    await scanSourceFolder();
  } catch (err) {
    toast(`Lỗi thay đổi trạng thái tự động lưu: ${err.message}`, true);
  }
}

// --- Library Scanning & Ingestion ---
async function scanSourceFolder(notify = false) {
  if (state.scanning) return;
  state.scanning = true;
  try {
    if (notify) toast('Đang quét thư mục Chrome / TobyFlow tải về...');
    const data = await post('/api/scan');
    state.results = data.results || [];
    state.settings = data.settings || state.settings;
    if (data.autoSave) {
      state.autoSave = data.autoSave.enabled;
      state.autoSaveStats = data.autoSave.stats || state.autoSaveStats;
      state.queue = data.autoSave.queue || [];
    }

    renderLibrary();
    if (notify) {
      toast(`Đã quét xong: tìm thấy ${state.results.length} video trong thư mục nguồn!`);
    }
  } catch (err) {
    if (notify) toast(`Lỗi khi quét: ${err.message}`, true);
  } finally {
    state.scanning = false;
  }
}

async function loadLibrary() {
  try {
    const data = await api('/api/library');
    state.results = data.results || [];
    renderLibrary();
  } catch (err) {
    console.error('Lỗi nạp thư viện:', err);
  }
}

function filteredLibrary() {
  const term = ($('search')?.value || '').trim().toLowerCase();
  return state.results.filter(item => {
    if (state.libFilter === 'saved' && !item.saved) return false;
    if (state.libFilter === 'unsaved' && item.saved) return false;
    if (!term) return true;
    return [item.name, item.displayName, item.subfolder, item.prompt, item.provider, item.id].some(v => (v || '').toLowerCase().includes(term));
  });
}

function updateSelectionBar() {
  const n = state.selected.size;
  $('selection-bar').hidden = n === 0;
  $('selection-count').textContent = n;
  document.querySelectorAll('.video-card').forEach(card => {
    card.classList.toggle('selected', state.selected.has(card.dataset.id));
    const chk = card.querySelector('.video-checkbox');
    if (chk) chk.checked = state.selected.has(card.dataset.id);
  });
}

function renderLibrary() {
  const items = filteredLibrary();
  const total = state.results.length;
  const savedCount = state.results.filter(v => v.saved).length;
  const unsavedCount = total - savedCount;

  $('stat-total').textContent = total;
  $('stat-unsaved').textContent = unsavedCount;
  $('stat-saved').textContent = savedCount;
  $('nav-count').textContent = total;
  $('nav-saved-count').textContent = savedCount;

  $('cnt-all').textContent = total;
  $('cnt-unsaved').textContent = unsavedCount;
  $('cnt-saved').textContent = savedCount;

  $('heading-count').textContent = `${items.length} VIDEO`;

  const grid = $('video-grid');
  const emptyState = $('empty-state');

  if (items.length === 0) {
    grid.innerHTML = '';
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  grid.innerHTML = items.map(item => {
    const isSaved = Boolean(item.saved);
    const isAvailable = Boolean(item.available);
    const isSelected = state.selected.has(item.id);

    // Tìm thông tin trong hàng đợi nếu có
    const qItem = (state.queue || []).find(q => q.id === item.id || q.source === item.source);

    let badgeHtml = '';
    if (!isAvailable) {
      badgeHtml = `<span class="video-badge" style="background:#ef4444; color:#fff;">✕ File nguồn đã bị xóa</span>`;
    } else if (qItem && qItem.status === 'error') {
      badgeHtml = `<span class="video-badge" style="background:#f87171; color:#18181b;" title="${escapeHtml(qItem.error)}">⚠ Lỗi tự lưu</span>`;
    } else if (qItem && qItem.status === 'processing') {
      badgeHtml = `<span class="video-badge" style="background:#60a5fa; color:#18181b;">⚙ Đang sao chép...</span>`;
    } else if (qItem && qItem.status === 'pending') {
      badgeHtml = `<span class="video-badge" style="background:#fde047; color:#18181b;">⏳ Chờ tự lưu</span>`;
    } else if (isSaved) {
      badgeHtml = `<span class="video-badge badge-saved">✓ Đã lưu theo ngày</span>`;
    } else {
      badgeHtml = `<span class="video-badge badge-unsaved">Mới phát hiện</span>`;
    }

    return `
      <div class="video-card ${isSelected ? 'selected' : ''} ${!isAvailable ? 'card-unavailable' : ''}" data-id="${item.id}" style="${!isAvailable ? 'opacity:0.6;' : ''}">
        <div class="video-preview-wrap">
          ${isAvailable ? `
            <video class="card-video" src="/api/preview/${item.id}" preload="metadata" muted playsinline loop></video>
            <div class="preview-overlay">
              <span class="preview-play-icon">▶</span>
            </div>
          ` : `
            <div style="height:140px; display:flex; align-items:center; justify-content:center; background:#1c1917; color:#a8a29e; font-size:13px;">
              ✕ File không còn trên đĩa
            </div>
          `}

          ${isAvailable ? `
            <label class="card-checkbox-label" onclick="event.stopPropagation()">
              <input type="checkbox" class="video-checkbox" data-id="${item.id}" ${isSelected ? 'checked' : ''}>
              <span class="custom-chk"></span>
            </label>
          ` : ''}

          ${badgeHtml}
        </div>

        <div class="video-info">
          <div class="video-title" title="${escapeHtml(item.displayName || item.name)}">${escapeHtml(item.displayName || item.name)}</div>
          <div class="video-meta">
            <span>📦 ${formatBytes(item.size)}</span>
            ${item.subfolder ? `<span style="background:rgba(214,243,106,0.12); color:var(--accent); padding:2px 6px; border-radius:4px; font-weight:600;" title="Thư mục con: ${escapeHtml(item.subfolder)}">📁 ${escapeHtml(item.subfolder)}</span>` : ''}
            <span>🕒 ${dateLabel(item.createdAt)}</span>
          </div>
          ${item.saved ? `
            <div style="font-size:11px; color:var(--accent); margin-top:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(item.saved.path)}">
              📁 Đã lưu: ${escapeHtml(item.saved.filename || item.name)}
            </div>
          ` : (qItem && qItem.status === 'error') ? `
            <div style="font-size:11px; color:#f87171; margin-top:6px; display:flex; justify-content:space-between; align-items:center;">
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(qItem.error)}">Lỗi: ${escapeHtml(qItem.error)}</span>
              <button class="small-link" style="color:#fde047; font-weight:bold;" onclick="event.stopPropagation(); retryVideo('${escapeJsArg(item.id)}')">Thử lại ↻</button>
            </div>
          ` : `
            <div style="font-size:11px; color:var(--muted); margin-top:6px;">
              ${state.autoSave ? 'Hệ thống sẽ tự động sao chép...' : 'Chưa lưu vào thư mục ngày'}
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');

  // Attach card events
  document.querySelectorAll('.video-card').forEach(card => {
    const id = card.dataset.id;
    const vid = card.querySelector('video');

    card.addEventListener('mouseenter', () => {
      if (vid && vid.paused) {
        vid.currentTime = 0;
        vid.play().catch(() => {});
      }
    });
    card.addEventListener('mouseleave', () => {
      if (vid && !vid.paused) vid.pause();
    });

    const chk = card.querySelector('.video-checkbox');
    if (chk) {
      chk.addEventListener('change', (e) => {
        e.stopPropagation();
        if (chk.checked) state.selected.add(id);
        else state.selected.delete(id);
        updateSelectionBar();
      });
    }

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-checkbox-label') || e.target.closest('button')) return;
      openPreviewModal(id);
    });
  });

  updateSelectionBar();
}

// --- Preview Modal Dialog ---
function openPreviewModal(id) {
  const item = state.results.find(v => v.id === id);
  if (!item || !item.available) return;

  state.previewId = id;
  $('modal-title').textContent = item.displayName || item.name;
  $('modal-subtitle').textContent = `${item.subfolder ? `Thư mục con: ${item.subfolder} · ` : ''}Dung lượng: ${formatBytes(item.size)} · Phát hiện: ${dateLabel(item.createdAt)}`;
  $('modal-prompt').textContent = item.source || item.name;

  const player = $('modal-video-player');
  player.src = `/api/preview/${id}`;
  player.play().catch(() => {});

  const badge = $('modal-badge-status');
  badge.className = `video-badge ${item.saved ? 'badge-saved' : 'badge-unsaved'}`;
  badge.textContent = item.saved ? `✓ Đã lưu: ${item.saved.filename || ''}` : 'Chưa lưu vào thư mục ngày';

  $('modal-save-btn').textContent = item.saved ? '✓ Lưu lại video này' : '↓ Lưu video này vào thư mục ngày';

  $('preview-modal').hidden = false;
}

function closePreviewModal() {
  const player = $('modal-video-player');
  if (player) {
    player.pause();
    player.removeAttribute('src');
    player.load();
  }
  $('preview-modal').hidden = true;
  state.previewId = null;
}

// --- Save Selected Videos (Manual Fallback) ---
async function handleSaveSelected(ids = null) {
  const targetIds = ids || Array.from(state.selected);
  if (targetIds.length === 0) {
    toast('Chưa chọn video nào để lưu.', true);
    return;
  }

  const saveBtn = $('save-selected');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = `Đang sao chép & xác minh ${targetIds.length} video...`;
  }

  try {
    const res = await post('/api/save', { ids: targetIds });
    if (res.errors && res.errors.length > 0) {
      toast(`Đã lưu ${res.saved.length} video. Có ${res.errors.length} lỗi: ${res.errors[0].error}`, true);
    } else {
      toast(`✓ Đã lưu thành công ${res.saved.length} video vào thư mục ${res.dateFolder}!`);
    }

    state.selected.clear();
    updateSelectionBar();
    await scanSourceFolder();
    await loadStatus();
  } catch (err) {
    toast(`Lỗi khi lưu video: ${err.message}`, true);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '↓ Lưu video đã chọn vào thư mục ngày';
    }
  }
}

// --- Retry Actions ---
async function retryVideo(id) {
  try {
    toast('Đang đưa video vào hàng đợi để thử lại...');
    await post('/api/retry', { id });
    toast('✓ Đã kích hoạt thử lại cho video!');
    await scanSourceFolder();
    await loadStatus();
  } catch (err) {
    toast(`Không thể thử lại: ${err.message}`, true);
  }
}

async function retryAllFailedVideos() {
  try {
    toast('Đang thử lại tất cả video bị lỗi...');
    const res = await post('/api/retry', { all: true });
    toast(`✓ Đã kích hoạt thử lại cho ${res.retriedCount || 0} video!`);
    await scanSourceFolder();
    await loadStatus();
  } catch (err) {
    toast(`Lỗi khi thử lại: ${err.message}`, true);
  }
}

// --- History Table ---
async function loadHistory() {
  try {
    const data = await api('/api/history');
    state.history = data.history || [];
    renderHistoryTable();
  } catch (err) {
    console.error('Lỗi tải lịch sử:', err);
  }
}

function renderHistoryTable() {
  const tbody = $('history-tbody');
  if (!tbody) return;

  if (state.history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:32px 0;">Chưa có video nào được lưu vào thư mục ngày.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.history.map(row => {
    const safeId = escapeJsArg(row.id || row.saveId || '');
    const safePath = escapeJsArg(row.path || '');
    return `
      <tr>
        <td>
          <strong style="color:var(--text); word-break:break-all;">${escapeHtml(row.name)}</strong>
          <small style="color:var(--muted); display:block; word-break:break-all;">${escapeHtml(row.path)}</small>
        </td>
        <td>
          <span style="background:rgba(214,243,106,0.1); color:var(--accent); padding:2px 8px; border-radius:4px; font-size:12px; font-weight:600;">
            ${escapeHtml(row.dateFolder ? row.dateFolder.split(/[\\/]/).pop() : (row.date || 'Hôm nay'))}
          </span>
        </td>
        <td>${formatBytes(row.size)}</td>
        <td>${dateLabel(row.savedAt)}</td>
        <td>
          <span style="color: ${row.exists ? 'var(--green)' : 'var(--red)'}; font-size:12px; font-weight:600;">
            ${row.exists ? '● Có sẵn trên đĩa' : '✕ Đã xóa/di chuyển'}
          </span>
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="button secondary" style="padding:4px 8px; font-size:11px;" onclick="openVideo('${safeId}', '${safePath}')" title="Phát video bằng trình phát Windows">
              ▶ Mở video
            </button>
            <button class="icon-button" style="height:28px; width:28px;" onclick="revealVideo('${safeId}', '${safePath}')" title="Mở thư mục trong Explorer">
              📁
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function openVideo(id, filePath = '') {
  try {
    await post('/api/open-video', { id, path: filePath });
  } catch (err) {
    toast(`Không mở được video: ${err.message}`, true);
  }
}

async function revealVideo(id, filePath = '') {
  try {
    await post('/api/reveal', { id, path: filePath });
  } catch (err) {
    toast(`Không mở được thư mục: ${err.message}`, true);
  }
}

// --- Folder Pickers & Save Settings ---
async function pickFolder(targetInputId) {
  try {
    if (window.tobyflowElectron?.openFolderPicker) {
      const selected = await window.tobyflowElectron.openFolderPicker('Chọn thư mục cho TobyFlow Studio');
      if (selected) {
        $(targetInputId).value = selected;
      }
      return;
    }
    const res = await post('/api/folder-picker');
    if (res.path) {
      $(targetInputId).value = res.path;
    }
  } catch (err) {
    toast(`Lỗi mở hộp chọn thư mục: ${err.message}`, true);
  }
}

async function saveFoldersSettings() {
  const src = $('settings-source-folder').value.trim();
  const dest = $('settings-destination').value.trim();
  const autoSaveChecked = $('settings-autosave-toggle') ? $('settings-autosave-toggle').checked : true;

  if (!src) {
    toast('Vui lòng chọn Thư mục nguồn tải về.', true);
    return;
  }
  if (!dest) {
    toast('Vui lòng chọn Thư mục gốc lưu trữ.', true);
    return;
  }

  try {
    await post('/api/source-folder', { path: src });
    await post('/api/destination', { path: dest });
    await post('/api/auto-save', { enabled: autoSaveChecked });
    toast('✓ Đã lưu thành công cấu hình thư mục và tự động lưu!');
    await loadStatus();
    await scanSourceFolder(true);
  } catch (err) {
    toast(`Lỗi lưu thư mục: ${err.message}`, true);
  }
}

// --- Legacy Data Import ---
async function handleImportLegacyData() {
  const inputEl = $('settings-legacy-folder');
  const statusEl = $('legacy-import-status');
  const pathVal = inputEl ? inputEl.value.trim() : '';

  if (statusEl) {
    statusEl.hidden = false;
    statusEl.style.color = '#eab308';
    statusEl.textContent = 'Đang đọc và nhập dữ liệu từ bản cũ...';
  }

  try {
    let res;
    if (window.tobyflowElectron?.importLegacyData) {
      res = await window.tobyflowElectron.importLegacyData(pathVal || undefined);
    } else {
      if (!pathVal) {
        toast('Vui lòng chọn hoặc nhập đường dẫn thư mục cần nhập.', true);
        if (statusEl) statusEl.hidden = true;
        return;
      }
      res = await post('/api/import-legacy-data', { folderPath: pathVal });
    }

    if (res.canceled) {
      if (statusEl) statusEl.hidden = true;
      return;
    }

    if (res.ok) {
      const details = res.result || res;
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.style.color = '#10b981';
        statusEl.textContent = `✓ Đã nhập thành công từ '${details.from}'! (${details.copied?.join(', ') || ''})`;
      }
      toast('✓ Đã nhập thành công cấu hình và lịch sử từ phiên bản cũ!');
      await loadStatus();
      await scanSourceFolder(true);
    } else {
      throw new Error(res.error || 'Nhập dữ liệu không thành công');
    }
  } catch (err) {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.style.color = '#ef4444';
      statusEl.textContent = `Lỗi: ${err.message}`;
    }
    toast(`Lỗi nhập dữ liệu: ${err.message}`, true);
  }
}

// --- Automated Test Runner ---
async function runAutomatedTests() {
  const btn = $('btn-run-mock-tests');
  const reportBox = $('test-report-box');

  btn.disabled = true;
  btn.textContent = 'Đang chạy kiểm thử tự động...';
  reportBox.hidden = false;
  reportBox.innerHTML = '<div style="padding:12px; color:var(--muted);">Đang thực thi các kịch bản kiểm thử độ tin cậy...</div>';

  try {
    const res = await post('/api/test/mock-run');
    reportBox.innerHTML = `
      <div style="background:#191d28; padding:16px; border-radius:10px; border:1px solid #2a2e3a;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <strong style="color:var(--text); font-size:14px;">${escapeHtml(res.title || 'KẾT QUẢ KIỂM THỬ')}</strong>
          <span style="font-weight:700; color:${res.ok ? 'var(--green)' : 'var(--red)'};">
            ${res.passedCount}/${res.totalCount} ĐẠT (${res.durationMs}ms)
          </span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${(res.results || []).map(r => `
            <div style="font-size:12px; display:flex; gap:8px; align-items:baseline;">
              <span style="font-weight:bold; color:${r.ok ? 'var(--green)' : 'var(--red)'}; font-family:monospace;">
                [${r.ok ? 'PASS' : 'FAIL'}]
              </span>
              <div>
                <strong style="color:#f0f2f5;">${escapeHtml(r.name)}</strong>
                ${r.details ? `<div style="color:var(--muted); font-size:11px; margin-top:2px;">${escapeHtml(r.details)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    toast(res.ok ? 'Tất cả các bài kiểm thử nội bộ đã ĐẠT!' : 'Có bài kiểm thử chưa đạt.', !res.ok);
  } catch (err) {
    reportBox.innerHTML = `<div style="color:var(--red); padding:12px;">Lỗi thực thi kiểm thử: ${escapeHtml(err.message)}</div>`;
    toast(`Lỗi: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '🧪 Chạy Kiểm Thử Tự Động Nội Bộ';
  }
}

// --- Setup Event Listeners ---
function setupEvents() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(b => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });

  $('top-settings').addEventListener('click', () => switchView('settings'));

  // Guidance banner button
  const btnBanner = $('btn-banner-go-settings');
  if (btnBanner) btnBanner.addEventListener('click', () => switchView('settings'));

  // Auto-Save Toggle Button
  const btnAutoSave = $('btn-toggle-autosave');
  if (btnAutoSave) btnAutoSave.addEventListener('click', toggleAutoSave);

  // Retry All Failed Button
  const btnRetryAll = $('btn-retry-all-failed');
  if (btnRetryAll) btnRetryAll.addEventListener('click', retryAllFailedVideos);

  // Subnav filter chips
  document.querySelectorAll('.subnav-chip').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('.subnav-chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      state.libFilter = c.dataset.libfilter;
      renderLibrary();
    });
  });

  // Search
  $('search').addEventListener('input', renderLibrary);

  // Scan & Open Buttons
  $('btn-scan-source').addEventListener('click', () => scanSourceFolder(true));
  $('btn-open-source-dir').addEventListener('click', () => post('/api/open-folder', { type: 'source' }));
  $('btn-open-dest-dir').addEventListener('click', () => post('/api/open-folder', { type: 'destination' }));
  $('btn-empty-settings').addEventListener('click', () => switchView('settings'));

  // Quick Change Links on Overview Card
  $('btn-quick-change-source').addEventListener('click', () => {
    switchView('settings');
    $('settings-source-folder').focus();
  });
  $('change-folder').addEventListener('click', () => {
    switchView('settings');
    $('settings-destination').focus();
  });

  // Selection Bar Actions
  $('clear-selection').addEventListener('click', () => {
    state.selected.clear();
    updateSelectionBar();
  });
  $('save-selected').addEventListener('click', () => handleSaveSelected());

  // Modal Actions
  $('modal-close').addEventListener('click', closePreviewModal);
  $('modal-backdrop').addEventListener('click', closePreviewModal);
  $('modal-save-btn').addEventListener('click', () => {
    if (state.previewId) {
      handleSaveSelected([state.previewId]);
      closePreviewModal();
    }
  });

  // Settings Actions
  $('settings-browse-source').addEventListener('click', () => pickFolder('settings-source-folder'));
  $('settings-browse-folder').addEventListener('click', () => pickFolder('settings-destination'));
  $('settings-save-folders').addEventListener('click', saveFoldersSettings);
  $('settings-rescan-btn').addEventListener('click', () => scanSourceFolder(true));

  // Legacy Data Import Actions
  if ($('btn-browse-legacy')) {
    $('btn-browse-legacy').addEventListener('click', () => pickFolder('settings-legacy-folder'));
  }
  if ($('btn-import-legacy')) {
    $('btn-import-legacy').addEventListener('click', handleImportLegacyData);
  }

  // Automated Tests Button
  $('btn-run-mock-tests').addEventListener('click', runAutomatedTests);

  // GitHub Releases Auto-Update Actions
  setupUpdateManager();

  // Escape key closes modal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('preview-modal').hidden) {
      closePreviewModal();
    }
  });
}

// --- Version & Update Management ---
async function initAppVersion() {
  let ver = '2.0.0';
  if (window.tobyflowElectron?.getAppVersion) {
    try {
      ver = await window.tobyflowElectron.getAppVersion();
    } catch {}
  }
  const badge = $('app-version-badge');
  if (badge) badge.textContent = `v${ver}`;
  const sideTag = $('sidebar-version-tag');
  if (sideTag) sideTag.textContent = `v${ver}`;
}

function setupUpdateManager() {
  const btnCheck = $('btn-check-updates');
  const btnDownload = $('btn-download-update');
  const btnInstall = $('btn-install-restart');
  const statusText = $('update-status-text');
  const dot = $('update-indicator-dot');
  const detailsBox = $('update-details-box');
  const releaseNotes = $('update-release-notes');
  const newVerText = $('update-new-version-text');
  const progressContainer = $('update-progress-container');
  const progressPercent = $('update-progress-percent');
  const progressFill = $('update-progress-fill');
  const progressBytes = $('update-progress-bytes');

  function setStatus(type, msg) {
    if (dot) {
      dot.className = `status-indicator-dot ${type}`;
    }
    if (statusText) {
      statusText.textContent = msg;
    }
  }

  if (window.tobyflowElectron) {
    window.tobyflowElectron.onUpdateStatus((data) => {
      if (!data) return;
      switch (data.status) {
        case 'checking':
          setStatus('checking', data.message || 'Đang kiểm tra phiên bản mới từ GitHub Releases...');
          if (btnCheck) btnCheck.disabled = true;
          break;
        case 'not-available':
          setStatus('downloaded', `Bạn đang sử dụng phiên bản mới nhất (${data.version || data.currentVersion || 'v2.0.0'}).`);
          if (btnCheck) btnCheck.disabled = false;
          if (btnDownload) btnDownload.hidden = true;
          if (btnInstall) btnInstall.hidden = true;
          if (detailsBox) detailsBox.hidden = true;
          if (progressContainer) progressContainer.hidden = true;
          break;
        case 'available':
          setStatus('available', `Đã có bản cập nhật mới v${data.version}!`);
          if (btnCheck) btnCheck.disabled = false;
          if (btnDownload) {
            btnDownload.hidden = false;
            btnDownload.disabled = false;
            btnDownload.innerHTML = `<span>📥</span> Tải bản cập nhật v${data.version}`;
          }
          if (btnInstall) btnInstall.hidden = true;
          if (newVerText) newVerText.textContent = `v${data.version}`;
          if (data.releaseNotes && releaseNotes) {
            releaseNotes.textContent = data.releaseNotes;
            if (detailsBox) detailsBox.hidden = false;
          }
          break;
        case 'downloading':
          setStatus('downloading', 'Đang tải bản cập nhật mới từ GitHub...');
          if (btnCheck) btnCheck.disabled = true;
          if (btnDownload) btnDownload.disabled = true;
          if (progressContainer) progressContainer.hidden = false;
          if (progressPercent) progressPercent.textContent = `${data.percent || 0}%`;
          if (progressFill) progressFill.style.width = `${data.percent || 0}%`;
          if (progressBytes) {
            const tr = ((data.transferred || 0) / (1024 * 1024)).toFixed(1);
            const tot = ((data.total || 0) / (1024 * 1024)).toFixed(1);
            progressBytes.textContent = `${tr} MB / ${tot} MB`;
          }
          break;
        case 'downloaded':
          setStatus('downloaded', `Bản cập nhật v${data.version} đã tải xong và sẵn sàng cài đặt!`);
          if (btnCheck) btnCheck.disabled = false;
          if (btnDownload) btnDownload.hidden = true;
          if (progressContainer) progressContainer.hidden = true;
          if (btnInstall) {
            btnInstall.hidden = false;
            btnInstall.disabled = false;
          }
          toast(`✓ Bản cập nhật v${data.version} đã sẵn sàng. Bấm "Cài đặt & Khởi động lại" để hoàn tất.`);
          break;
        case 'installing':
          setStatus('checking', data.message || 'Đang chuẩn bị cài đặt...');
          if (btnInstall) btnInstall.disabled = true;
          break;
        case 'error':
          setStatus('error', `Lỗi: ${data.message || 'Không thể kiểm tra hoặc tải cập nhật'}`);
          if (btnCheck) btnCheck.disabled = false;
          if (btnDownload) btnDownload.disabled = false;
          break;
      }
    });

    if (btnCheck) {
      btnCheck.addEventListener('click', async () => {
        try {
          btnCheck.disabled = true;
          setStatus('checking', 'Đang kết nối tới GitHub Releases...');
          await window.tobyflowElectron.checkForUpdates();
        } catch (err) {
          btnCheck.disabled = false;
          setStatus('error', `Lỗi kiểm tra: ${err.message}`);
        }
      });
    }

    if (btnDownload) {
      btnDownload.addEventListener('click', async () => {
        try {
          btnDownload.disabled = true;
          if (progressContainer) progressContainer.hidden = false;
          await window.tobyflowElectron.downloadUpdate();
        } catch (err) {
          btnDownload.disabled = false;
          toast(`Lỗi tải cập nhật: ${err.message}`, true);
        }
      });
    }

    if (btnInstall) {
      btnInstall.addEventListener('click', async () => {
        try {
          btnInstall.disabled = true;
          setStatus('checking', 'Đang lưu trữ dữ liệu an toàn và khởi động lại để cài đặt...');
          await window.tobyflowElectron.quitAndInstall();
        } catch (err) {
          btnInstall.disabled = false;
          toast(`Lỗi khi cài đặt: ${err.message}`, true);
        }
      });
    }
  } else {
    // Nếu chạy trên trình duyệt web thông thường
    if (btnCheck) {
      btnCheck.addEventListener('click', () => {
        toast('Tính năng cập nhật tự động hoạt động khi chạy từ ứng dụng TobyFlow Studio cài đặt trên Windows.');
      });
    }
  }
}

// --- App Initialization ---
window.addEventListener('DOMContentLoaded', async () => {
  startClock();
  setupEvents();
  await initAppVersion();

  // Load initial settings and trigger initial scan
  await loadStatus();
  await scanSourceFolder();

  // Periodic poll to refresh UI status and counters
  setInterval(() => {
    loadStatus();
    if (state.view === 'library') {
      scanSourceFolder(false);
    }
  }, 4000);
});
