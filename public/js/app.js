// TobyFlow Video Manager Frontend Application
let appState = {
  config: null,
  tasks: [],
  selectedVideos: new Set(), // Set of "taskId:resultIndex"
  currentFilter: 'all',
  pollInterval: null
};

// --- Toast System ---
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
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

// --- Format Bangkok Datetime ---
function formatBangkokDate(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d);
  } catch (e) {
    return isoString;
  }
}

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupModeToggle();
  setupForms();
  setupResultsToolbar();
  await loadConfig();
  await refreshStatus();
  await loadTasks();
  await loadMcpSurvey();

  // Start polling every 3.5 seconds
  appState.pollInterval = setInterval(async () => {
    await refreshStatus();
    await loadTasks(false); // background refresh without resetting selection
  }, 3500);
});

// --- Tab Navigation ---
function setupNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(tab.dataset.tab);
      if (targetPane) targetPane.classList.add('active');

      if (tab.dataset.tab === 'tab-results') {
        renderResults();
      } else if (tab.dataset.tab === 'tab-survey') {
        loadMcpSurvey();
      } else if (tab.dataset.tab === 'tab-history') {
        renderHistory();
      }
    });
  });
}

// --- Single vs Batch Mode Toggle ---
function setupModeToggle() {
  const btnSingle = document.getElementById('btn-mode-single');
  const btnBatch = document.getElementById('btn-mode-batch');
  const groupSingle = document.getElementById('group-single-prompt');
  const groupBatch = document.getElementById('group-batch-prompts');

  btnSingle.addEventListener('click', () => {
    btnSingle.classList.add('active');
    btnBatch.classList.remove('active');
    groupSingle.classList.remove('hidden');
    groupBatch.classList.add('hidden');
    document.getElementById('prompt-input').required = true;
    document.getElementById('batch-prompts-input').required = false;
  });

  btnBatch.addEventListener('click', () => {
    btnBatch.classList.add('active');
    btnSingle.classList.remove('active');
    groupBatch.classList.remove('hidden');
    groupSingle.classList.add('hidden');
    document.getElementById('prompt-input').required = false;
    document.getElementById('batch-prompts-input').required = true;
  });

  // Filter buttons in queue
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appState.currentFilter = btn.dataset.filter;
      renderQueue();
    });
  });
}

// --- Load Config ---
async function loadConfig() {
  try {
    const config = await API.getConfig();
    appState.config = config;

    // Populate Settings Form
    document.getElementById('setting-server-url').value = config.mcpServerUrl || 'https://tobyflow.mcp';
    document.getElementById('setting-token').value = config.mcpTokenMasked || '';
    document.getElementById('setting-transport').value = config.transportMode || 'auto';
    document.getElementById('setting-dest-folder').value = config.destinationFolder || '';
    document.getElementById('setting-naming-template').value = config.namingTemplate || '{date}_{time}_{index}.mp4';
    document.getElementById('setting-poll-interval').value = config.pollIntervalSeconds || 6;
    document.getElementById('setting-concurrency').value = config.concurrency || 1;

    // Populate Tab 2 Destination Folder
    document.getElementById('current-dest-path').textContent = config.destinationFolder || 'Chưa thiết lập';

    updateFilenamePreview();
  } catch (err) {
    showToast(`Lỗi khi tải cấu hình: ${err.message}`, 'error');
  }
}

// --- Refresh System Status ---
async function refreshStatus() {
  try {
    const status = await API.getStatus();
    const pill = document.getElementById('mcp-status-pill');

    if (status.mcpConnected) {
      pill.className = 'status-pill status-success';
      pill.querySelector('.text').textContent = 'MCP: Đã kết nối';
    } else if (status.mcpConfigured) {
      pill.className = 'status-pill status-warning';
      pill.querySelector('.text').textContent = 'MCP: Chưa kiểm tra';
    } else {
      pill.className = 'status-pill status-danger';
      pill.querySelector('.text').textContent = 'MCP: Chưa có Token';
    }

    // Destination badge check
    const destBadge = document.getElementById('dest-status-badge');
    if (status.destinationValid) {
      destBadge.className = 'badge badge-success';
      destBadge.textContent = 'Sẵn sàng ghi';
    } else {
      destBadge.className = 'badge badge-failed';
      destBadge.textContent = `Lỗi: ${status.destinationError || 'Không thể ghi'}`;
    }
  } catch (err) {
    // Ignore transient network errors
  }
}

// --- Load Tasks ---
async function loadTasks(fullRender = true) {
  try {
    const tasks = await API.getTasks();
    appState.tasks = tasks;

    // Update un-saved badge
    let unsavedCount = 0;
    for (const t of tasks) {
      if (t.results && t.results.length > 0) {
        unsavedCount += t.results.filter(r => r.stagedPath && !r.isSaved).length;
      }
    }
    document.getElementById('badge-unsaved').textContent = unsavedCount;
    document.getElementById('queue-count').textContent = tasks.length;

    renderQueue();
    if (document.getElementById('tab-results').classList.contains('active')) {
      renderResults();
    }
    if (document.getElementById('tab-history').classList.contains('active')) {
      renderHistory();
    }
  } catch (err) {
    console.error('Error loading tasks:', err);
  }
}

// --- Render Queue ---
function renderQueue() {
  const container = document.getElementById('queue-list');
  const emptyState = document.getElementById('queue-empty-state');

  let filtered = appState.tasks;
  if (appState.currentFilter !== 'all') {
    filtered = appState.tasks.filter(t => t.status === appState.currentFilter);
  }

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    container.innerHTML = '';
    return;
  }
  emptyState.classList.add('hidden');

  container.innerHTML = filtered.map(task => {
    const isRunning = task.status === 'running' || task.status === 'submitting';
    const isFailed = task.status === 'failed';
    const hasResults = task.results && task.results.length > 0;

    let statusText = {
      pending: 'Đang chờ',
      submitting: 'Đang gửi...',
      running: 'Đang tạo video...',
      completed: 'Hoàn thành',
      partial: 'Một phần (Xong 1 số video)',
      failed: 'Thất bại',
      cancelled: 'Đã hủy'
    }[task.status] || task.status;

    return `
      <div class="task-item" id="item-${task.id}">
        <div class="task-header">
          <div class="task-prompt">${escapeHtml(task.prompt)}</div>
          <span class="badge-status badge-${task.status}">${statusText}</span>
        </div>

        <div class="task-meta">
          <span>🎯 Provider: <strong>${escapeHtml(task.provider)}</strong></span>
          <span>📐 Tỉ lệ: <strong>${escapeHtml(task.aspectRatio)}</strong></span>
          <span>🎞️ Yêu cầu: <strong>${task.count} video</strong></span>
          <span>🕒 Tạo lúc: ${formatBangkokDate(task.createdAt)}</span>
          ${task.jobId ? `<span>🆔 Job: <code>${escapeHtml(task.jobId)}</code></span>` : ''}
        </div>

        ${isRunning ? `
          <div class="progress-bar-container">
            <div class="progress-bar" style="width: ${task.progress || 20}%"></div>
          </div>
        ` : ''}

        ${task.error ? `
          <div class="alert alert-danger" style="padding: 6px 10px; font-size: 11px; margin-bottom: 8px;">
            ⚠️ ${escapeHtml(task.error)}
          </div>
        ` : ''}

        <div class="task-footer">
          <span>Tiến độ: ${task.progress || 0}%</span>
          <div class="task-actions">
            ${hasResults ? `
              <button class="btn btn-sm btn-primary" onclick="viewTaskResults('${task.id}')">
                👁️ Xem video (${task.results.length})
              </button>
            ` : ''}
            ${isFailed ? `
              <button class="btn btn-sm btn-secondary" onclick="retryTask('${task.id}')">
                🔄 Thử lại
              </button>
            ` : ''}
            ${isRunning ? `
              <button class="btn btn-sm btn-outline" onclick="cancelTask('${task.id}')">
                ⏹️ Hủy theo dõi
              </button>
            ` : ''}
            <button class="btn btn-sm btn-outline" onclick="deleteTask('${task.id}')" title="Xóa tác vụ">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Render Results & Video Selection (Tab 2) ---
function renderResults() {
  const container = document.getElementById('results-container');
  const emptyState = document.getElementById('results-empty-state');

  // Filter tasks that have results
  const tasksWithResults = appState.tasks.filter(t => t.results && t.results.length > 0);

  if (tasksWithResults.length === 0) {
    emptyState.classList.remove('hidden');
    container.innerHTML = '';
    updateSelectedCounter();
    return;
  }
  emptyState.classList.add('hidden');

  container.innerHTML = tasksWithResults.map(task => {
    return `
      <div class="task-result-group">
        <div class="group-title-row">
          <div>
            <h3>${escapeHtml(task.prompt)}</h3>
            <span class="sub-text">Mã tác vụ: ${task.id} | Hoàn thành lúc: ${formatBangkokDate(task.completedAt)}</span>
          </div>
          <span class="badge-status badge-${task.status}">
            ${task.results.length} video kết quả
          </span>
        </div>

        <div class="video-grid">
          ${task.results.map(res => {
            const key = `${task.id}:${res.resultIndex}`;
            const isChecked = appState.selectedVideos.has(key);
            const isSaved = res.isSaved;

            return `
              <div class="video-card ${isSaved ? 'video-saved' : ''}">
                <div class="video-player-wrapper">
                  ${res.stagedPath ? `
                    <video controls preload="metadata" src="/api/video-stream?path=${encodeURIComponent(res.stagedPath)}"></video>
                  ` : `
                    <div class="empty-state">
                      <p>⚠️ Không tải được video</p>
                      <span>${escapeHtml(res.error || 'File video bị lỗi')}</span>
                    </div>
                  `}
                </div>

                <div class="video-details">
                  <label class="video-select-row">
                    <input type="checkbox"
                      ${isSaved ? 'disabled' : ''}
                      ${isChecked || isSaved ? 'checked' : ''}
                      onchange="toggleVideoSelection('${task.id}', ${res.resultIndex}, this.checked)">
                    <span>${isSaved ? '✅ Đã lưu vào thư mục đích' : `Chọn lưu Video #${res.resultIndex}`}</span>
                  </label>

                  <div class="video-path-preview">
                    ${isSaved ? `
                      <span class="text-success">📁 Đường dẫn: ${escapeHtml(res.savedPath)}</span>
                    ` : `
                      <span class="text-muted">Dung lượng: ${(res.size / (1024 * 1024)).toFixed(2)} MB</span>
                    `}
                  </div>

                  <div class="video-card-actions">
                    ${isSaved ? `
                      <button class="btn btn-sm btn-outline" onclick="openSavedVideo('${encodeURIComponent(res.savedPath)}')">
                        ▶️ Mở video
                      </button>
                      <button class="btn btn-sm btn-outline" onclick="exploreSavedFolder('${encodeURIComponent(res.savedPath)}')">
                        📁 Mở thư mục
                      </button>
                    ` : `
                      <button class="btn btn-sm btn-success" onclick="saveSingleVideo('${task.id}', ${res.resultIndex})">
                        💾 Lưu video này
                      </button>
                    `}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  updateSelectedCounter();
}

// --- Toggle Video Selection ---
function toggleVideoSelection(taskId, resultIndex, checked) {
  const key = `${taskId}:${resultIndex}`;
  if (checked) {
    appState.selectedVideos.add(key);
  } else {
    appState.selectedVideos.delete(key);
  }
  updateSelectedCounter();
}

function updateSelectedCounter() {
  const counter = document.getElementById('selected-counter');
  counter.textContent = `Đã chọn: ${appState.selectedVideos.size} video`;
}

// --- Results Toolbar Setup ---
function setupResultsToolbar() {
  document.getElementById('btn-select-all').addEventListener('click', () => {
    appState.tasks.forEach(t => {
      if (t.results) {
        t.results.forEach(r => {
          if (!r.isSaved && r.stagedPath) {
            appState.selectedVideos.add(`${t.id}:${r.resultIndex}`);
          }
        });
      }
    });
    renderResults();
  });

  document.getElementById('btn-deselect-all').addEventListener('click', () => {
    appState.selectedVideos.clear();
    renderResults();
  });

  document.getElementById('btn-save-selected').addEventListener('click', async () => {
    if (appState.selectedVideos.size === 0) {
      showToast('Vui lòng tích chọn ít nhất 1 video để lưu.', 'warning');
      return;
    }

    // Group selected videos by taskId
    const taskGroups = {};
    for (const item of appState.selectedVideos) {
      const [taskId, idxStr] = item.split(':');
      const idx = parseInt(idxStr, 10);
      if (!taskGroups[taskId]) taskGroups[taskId] = [];
      taskGroups[taskId].push(idx);
    }

    let totalSaved = 0;
    const errors = [];

    for (const [taskId, indexes] of Object.entries(taskGroups)) {
      try {
        const res = await API.saveSelectedResults(taskId, indexes);
        if (res.saved) {
          totalSaved += res.saved.length;
          // Remove saved items from selection
          indexes.forEach(idx => appState.selectedVideos.delete(`${taskId}:${idx}`));
        }
        if (res.errors && res.errors.length > 0) {
          errors.push(...res.errors);
        }
      } catch (err) {
        errors.push(`Lỗi lưu tác vụ ${taskId}: ${err.message}`);
      }
    }

    await loadTasks();
    renderResults();

    if (totalSaved > 0) {
      showToast(`Đã lưu thành công ${totalSaved} video vào thư mục đích!`, 'success');
    }
    if (errors.length > 0) {
      showToast(`Lỗi: ${errors.join('; ')}`, 'error', 6000);
    }
  });

  // Change destination folder
  document.getElementById('btn-change-folder').addEventListener('click', async () => {
    const res = await API.pickFolder();
    if (res.ok && res.path) {
      await API.saveConfig({ destinationFolder: res.path });
      await loadConfig();
      await refreshStatus();
      showToast(`Đã cập nhật thư mục lưu: ${res.path}`, 'success');
    }
  });

  // Open Destination folder in explorer
  document.getElementById('btn-open-dest-folder').addEventListener('click', async () => {
    const folder = appState.config?.destinationFolder;
    if (folder) {
      await API.exploreFolder(folder);
    } else {
      showToast('Chưa cấu hình thư mục đích', 'warning');
    }
  });
}

// --- Save Single Video ---
async function saveSingleVideo(taskId, resultIndex) {
  try {
    const res = await API.saveSelectedResults(taskId, [resultIndex]);
    if (res.success) {
      showToast(`Đã lưu thành công Video #${resultIndex}!`, 'success');
      appState.selectedVideos.delete(`${taskId}:${resultIndex}`);
      await loadTasks();
      renderResults();
    } else {
      showToast(`Lỗi: ${res.errors?.join('; ') || 'Không thể lưu'}`, 'error');
    }
  } catch (err) {
    showToast(`Lỗi: ${err.message}`, 'error');
  }
}

function openSavedVideo(encodedPath) {
  API.openFile(decodeURIComponent(encodedPath));
}

function exploreSavedFolder(encodedPath) {
  API.exploreFolder(decodeURIComponent(encodedPath));
}

function viewTaskResults(taskId) {
  // Switch to results tab
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

  const resultsTab = document.querySelector('[data-tab="tab-results"]');
  const resultsPane = document.getElementById('tab-results');
  if (resultsTab && resultsPane) {
    resultsTab.classList.add('active');
    resultsPane.classList.add('active');
    renderResults();
  }
}

// --- Task Actions ---
async function retryTask(taskId) {
  try {
    await API.retryTask(taskId);
    showToast('Đã thêm lại tác vụ vào hàng đợi!', 'success');
    await loadTasks();
  } catch (err) {
    showToast(`Lỗi thử lại: ${err.message}`, 'error');
  }
}

async function cancelTask(taskId) {
  try {
    await API.cancelTask(taskId);
    showToast('Đã dừng theo dõi tác vụ trong ứng dụng.', 'info');
    await loadTasks();
  } catch (err) {
    showToast(`Lỗi hủy tác vụ: ${err.message}`, 'error');
  }
}

async function deleteTask(taskId) {
  if (!confirm('Bạn có chắc chắn muốn xóa tác vụ này khỏi danh sách?')) return;
  try {
    await API.deleteTask(taskId);
    showToast('Đã xóa tác vụ thành công.', 'info');
    await loadTasks();
  } catch (err) {
    showToast(`Lỗi xóa tác vụ: ${err.message}`, 'error');
  }
}

// --- Setup Forms ---
function setupForms() {
  const form = document.getElementById('create-task-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const isBatch = document.getElementById('btn-mode-batch').classList.contains('active');
    let prompts = [];

    if (isBatch) {
      const raw = document.getElementById('batch-prompts-input').value;
      prompts = raw.split('\n').map(s => s.trim()).filter(Boolean);
      if (prompts.length === 0) {
        showToast('Vui lòng nhập ít nhất 1 dòng prompt.', 'warning');
        return;
      }
    } else {
      const prompt = document.getElementById('prompt-input').value.trim();
      if (!prompt) {
        showToast('Vui lòng nhập nội dung prompt.', 'warning');
        return;
      }
      prompts = [prompt];
    }

    const payload = {
      prompts,
      provider: document.getElementById('provider-select').value,
      model: document.getElementById('model-select').value,
      aspectRatio: document.getElementById('aspect-ratio-select').value,
      count: parseInt(document.getElementById('count-select').value, 10),
      workflow: document.getElementById('workflow-select').value.trim(),
      referenceImage: document.getElementById('ref-image-input').value.trim(),
      startFrame: document.getElementById('start-frame-input').value.trim(),
      endFrame: document.getElementById('end-frame-input').value.trim(),
      continuation: document.getElementById('continuation-check').checked
    };

    try {
      const res = await API.createTask(payload);
      showToast(`Đã thêm ${res.count} tác vụ vào hàng đợi!`, 'success');
      form.reset();
      await loadTasks();
    } catch (err) {
      showToast(`Lỗi khi tạo tác vụ: ${err.message}`, 'error');
    }
  });

  // Check Provider Button
  document.getElementById('btn-check-provider').addEventListener('click', async () => {
    try {
      showToast('Đang kiểm tra trạng thái Provider...', 'info');
      const res = await API.checkProviderStatus();
      if (res.ok) {
        alert(`Trạng thái Provider:\n\n${res.message || JSON.stringify(res.result, null, 2)}\n\n${res.notice || ''}`);
      } else {
        alert(`Kiểm tra Provider thất bại:\n\n${res.error}`);
      }
    } catch (err) {
      showToast(`Lỗi kiểm tra provider: ${err.message}`, 'error');
    }
  });

  // Settings Form
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const serverUrl = document.getElementById('setting-server-url').value.trim();
    const token = document.getElementById('setting-token').value.trim();
    const transport = document.getElementById('setting-transport').value;

    try {
      await API.saveConfig({
        mcpServerUrl: serverUrl,
        mcpToken: token,
        transportMode: transport
      });
      showToast('Đã lưu cấu hình kết nối MCP thành công!', 'success');
      await loadConfig();
      await refreshStatus();
    } catch (err) {
      showToast(`Lỗi lưu cài đặt: ${err.message}`, 'error');
    }
  });

  // File Settings Form
  document.getElementById('file-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dest = document.getElementById('setting-dest-folder').value.trim();
    const template = document.getElementById('setting-naming-template').value.trim();
    const poll = parseInt(document.getElementById('setting-poll-interval').value, 10);
    const conc = parseInt(document.getElementById('setting-concurrency').value, 10);

    try {
      await API.saveConfig({
        destinationFolder: dest,
        namingTemplate: template,
        pollIntervalSeconds: poll,
        concurrency: conc
      });
      showToast('Đã lưu cấu hình thư mục & file!', 'success');
      await loadConfig();
      await refreshStatus();
    } catch (err) {
      showToast(`Lỗi lưu cấu hình: ${err.message}`, 'error');
    }
  });

  // Test Connection Button in Settings
  document.getElementById('btn-test-conn').addEventListener('click', async () => {
    const serverUrl = document.getElementById('setting-server-url').value.trim();
    const token = document.getElementById('setting-token').value.trim();
    const transport = document.getElementById('setting-transport').value;

    showToast('Đang kiểm tra kết nối MCP...', 'info');
    try {
      const res = await API.testMcpConnection({
        mcpServerUrl: serverUrl,
        mcpToken: token,
        transportMode: transport
      });

      if (res.ok) {
        showToast(`Kết nối thành công qua ${res.transport}! Tìm thấy ${res.toolCount} tool.`, 'success', 5000);
        await refreshStatus();
        await loadMcpSurvey();
      } else {
        alert(`Kiểm tra kết nối thất bại:\n\n${res.error}`);
      }
    } catch (err) {
      showToast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  });

  // Browse Folder in Settings
  document.getElementById('btn-browse-folder').addEventListener('click', async () => {
    const res = await API.pickFolder();
    if (res.ok && res.path) {
      document.getElementById('setting-dest-folder').value = res.path;
      updateFilenamePreview();
    }
  });

  // Live Filename Preview
  document.getElementById('setting-naming-template').addEventListener('input', updateFilenamePreview);

  // Run Test Suite Button
  document.getElementById('btn-run-tests').addEventListener('click', async () => {
    showToast('Đang chạy bộ 8 bài kiểm thử hệ thống...', 'info');
    try {
      const res = await API.runTests();
      if (res.ok) {
        alert(`BỘ KIỂM THỬ THÀNH CÔNG!\n\nĐã vượt qua: ${res.passedCount}/${res.totalCount} bộ kiểm thử (${res.durationMs}ms)\n\n1. Kiểm thử đặt tên Asia/Bangkok & Chống trùng tên: ĐẠT\n2. Kiểm thử lưu chọn lọc & An toàn thư mục: ĐẠT\n3. Kiểm thử hàng đợi, chịu lỗi & phục hồi: ĐẠT`);
      } else {
        alert(`Có bài kiểm thử chưa đạt:\n\n${JSON.stringify(res, null, 2)}`);
      }
    } catch (err) {
      showToast(`Lỗi chạy kiểm thử: ${err.message}`, 'error');
    }
  });

  // Toggle Token Visibility
  document.getElementById('btn-toggle-token').addEventListener('click', () => {
    const input = document.getElementById('setting-token');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Refresh Queue Button
  document.getElementById('btn-refresh-queue').addEventListener('click', () => loadTasks());

  // Survey Probe Button
  document.getElementById('btn-run-mcp-probe').addEventListener('click', async () => {
    showToast('Đang quét tool MCP...', 'info');
    await loadMcpSurvey();
  });
}

function updateFilenamePreview() {
  const template = document.getElementById('setting-naming-template').value || '{date}_{time}_{index}.mp4';
  const now = new Date();
  const d = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(now).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});

  const dateStr = `${d.year}-${d.month}-${d.day}`;
  const timeStr = `${d.hour}-${d.minute}-${d.second}`;

  const preview = template
    .replace('{date}', dateStr)
    .replace('{time}', timeStr)
    .replace('{index}', '001')
    .replace('{prompt}', 'video');

  document.getElementById('preview-filename').textContent = preview.endsWith('.mp4') ? preview : `${preview}.mp4`;
}

// --- Load MCP Survey Tab ---
async function loadMcpSurvey() {
  try {
    const res = await API.getMcpTools();
    const connElem = document.getElementById('survey-conn-status');
    const transElem = document.getElementById('survey-transport');
    const countElem = document.getElementById('survey-tool-count');
    const toolsContainer = document.getElementById('mcp-tools-container');

    connElem.textContent = res.ok && res.count > 0 ? 'Đã kết nối' : 'Chưa kết nối';
    connElem.className = res.ok && res.count > 0 ? 'metric-value text-success' : 'metric-value text-warning';
    transElem.textContent = appState.config?.transportMode || 'Auto';
    countElem.textContent = res.count || 0;

    if (res.tools && res.tools.length > 0) {
      toolsContainer.innerHTML = res.tools.map(tool => {
        return `
          <div class="tool-item-card">
            <span class="tool-name-badge">${escapeHtml(tool.name)}</span>
            <p style="font-size: 13px; color: #cbd5e1; margin-top: 4px;">${escapeHtml(tool.description || 'Không có mô tả')}</p>
            <details>
              <summary style="font-size: 11px; color: #818cf8; cursor: pointer; margin-top: 6px;">Xem Schema tham số (JSON Schema)</summary>
              <pre class="schema-viewer">${escapeHtml(JSON.stringify(tool.inputSchema || {}, null, 2))}</pre>
            </details>
          </div>
        `;
      }).join('');
    } else {
      toolsContainer.innerHTML = `
        <div class="empty-state">
          <p>Chưa có dữ liệu tool MCP từ server.</p>
          <span>Vui lòng vào tab <strong>Cài đặt & Kết nối</strong> để cấu hình Token và bấm "Kiểm tra kết nối".</span>
        </div>
      `;
    }
  } catch (err) {
    console.error('Error loading MCP survey:', err);
  }
}

// --- Render History Tab ---
function renderHistory() {
  const tbody = document.getElementById('history-table-body');
  const search = document.getElementById('history-search').value.toLowerCase();

  let tasks = appState.tasks;
  if (search) {
    tasks = tasks.filter(t =>
      (t.prompt && t.prompt.toLowerCase().includes(search)) ||
      (t.id && t.id.toLowerCase().includes(search)) ||
      (t.jobId && t.jobId.toLowerCase().includes(search))
    );
  }

  if (tasks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Không tìm thấy tác vụ nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = tasks.map(task => {
    const savedResults = (task.results || []).filter(r => r.isSaved);
    const savedStr = savedResults.length > 0
      ? savedResults.map(r => `<code>${escapeHtml(r.savedFilename)}</code>`).join('<br>')
      : '<span class="text-muted">Chưa lưu</span>';

    return `
      <tr>
        <td>${formatBangkokDate(task.createdAt)}</td>
        <td><code>${escapeHtml(task.id)}</code></td>
        <td>${task.jobId ? `<code>${escapeHtml(task.jobId)}</code>` : '<span class="text-muted">-</span>'}</td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(task.prompt)}">${escapeHtml(task.prompt)}</td>
        <td>${escapeHtml(task.provider)} ${task.model ? `(${escapeHtml(task.model)})` : ''}</td>
        <td><span class="badge-status badge-${task.status}">${task.status}</span></td>
        <td>${savedStr}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="deleteTask('${task.id}')" title="Xóa">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
}

