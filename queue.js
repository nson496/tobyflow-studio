const fs = require('node:fs');
const path = require('node:path');
const { bangkokStamp } = require('./library');

const DATA_DIR = process.env.TOBYFLOW_DATA_DIR || path.join(__dirname, 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

class QueueManager {
  constructor(library, getMcpClient, options = {}) {
    this.library = library;
    this.getMcp = getMcpClient; // function returning current active StdioMcpClient
    this.jobsFile = options.jobsFile || (process.env.TOBYFLOW_DATA_DIR ? path.join(process.env.TOBYFLOW_DATA_DIR, 'jobs.json') : path.join(__dirname, 'data', 'jobs.json'));
    this.tasks = options.initialTasks ? [...options.initialTasks] : readJson(this.jobsFile, []);
    this.isProcessing = false;
    this.activePollers = new Map();
    this.pollIntervalMs = options.pollIntervalMs || 5000;
  }

  save() {
    writeJson(this.jobsFile, this.tasks);
  }

  getTasks() {
    return this.tasks;
  }

  getTask(id) {
    return this.tasks.find(t => t.id === id);
  }

  resumeActiveTasks() {
    const mcp = this.getMcp();
    if (!mcp || !mcp.connected) return;

    for (const task of this.tasks) {
      if (task.status === 'running' && task.jobId && !this.activePollers.has(task.id)) {
        console.log(`[Queue] Khôi phục theo dõi job ${task.jobId} (Tác vụ ${task.id})...`);
        this.startPolling(task.id, task.jobId);
      }
    }
    this.processQueue();
  }

  addTasks(prompts, options = {}) {
    const list = Array.isArray(prompts) ? prompts : [prompts];
    const created = [];
    const now = new Date();

    for (const p of list) {
      const promptText = (p || '').trim();
      if (!promptText) continue;

      const task = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        prompt: promptText,
        provider: options.provider || '',
        model: options.model || '',
        aspectRatio: options.aspectRatio || '16:9',
        count: parseInt(options.count, 10) || 1,
        referenceImage: options.referenceImage || '',
        startFrame: options.startFrame || '',
        endFrame: options.endFrame || '',
        workflow: options.workflow || '',
        status: 'pending', // pending, submitting, running, completed, partial, failed, cancelled
        progress: 0,
        createdAt: now.toISOString(),
        createdAtBangkok: bangkokStamp(now),
        startedAt: null,
        completedAt: null,
        jobId: null,
        error: null,
        resultCount: 0
      };

      this.tasks.push(task); // Append to maintain FIFO order
      created.push(task);
    }

    this.save();
    this.processQueue();
    return created;
  }

  /**
   * REQUIREMENT 1:
   * Sửa processQueue() để mọi tác vụ pending tiếp tục chạy sau khi tác vụ trước hoàn tất hoặc thất bại.
   * Xử lý vòng lặp tuần tự an toàn tránh re-entrancy deadlock.
   */
  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (true) {
        const mcp = this.getMcp();
        if (!mcp || !mcp.connected) {
          break; // Chưa kết nối MCP, dừng hàng đợi
        }

        // Concurrency limit: 1 tác vụ chạy tại 1 thời điểm
        const runningTasks = this.tasks.filter(t => t.status === 'running' || t.status === 'submitting');
        if (runningTasks.length >= 1) {
          break; // Có tác vụ đang chạy, đợi tác vụ đó xong (startPolling sẽ gọi lại processQueue)
        }

        const pendingTask = this.tasks.find(t => t.status === 'pending');
        if (!pendingTask) {
          break; // Không còn tác vụ pending nào
        }

        // Thực thi tác vụ pending tiếp theo
        await this.submitTask(pendingTask);
        // Sau khi submitTask hoàn tất:
        // - Nếu pendingTask chuyển sang 'running', lần lặp tiếp theo runningTasks.length >= 1 sẽ break.
        // - Nếu pendingTask chuyển sang 'completed' hoặc 'failed' (lỗi đồng bộ hoặc kết quả trực tiếp),
        //   vòng lặp while sẽ tiếp tục ngay lập tức tới tác vụ pending kế tiếp!
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * REQUIREMENT 4:
   * Chỉ gọi tool và gửi tham số có trong schema thực tế.
   * Không đoán tên tool hay dùng trường string bất kỳ.
   */
  buildToolArguments(tool, task) {
    const props = tool.inputSchema?.properties;
    if (!props || typeof props !== 'object') {
      throw new Error(`Tool "${tool.name}" không có định nghĩa properties trong inputSchema.`);
    }

    const args = {};

    // 1. Trường prompt: Bắt buộc phải có trường 'prompt' rõ ràng trong schema
    if (props.prompt && typeof props.prompt === 'object') {
      args.prompt = task.prompt;
    } else {
      throw new Error(`Tool "${tool.name}" không có trường "prompt" phù hợp trong inputSchema.`);
    }

    // 2. Tỉ lệ khung hình: Chỉ gửi nếu schema có trường 'aspect_ratio' hoặc 'ratio'
    if (props.aspect_ratio) {
      args.aspect_ratio = task.aspectRatio;
    } else if (props.ratio) {
      args.ratio = task.aspectRatio;
    }

    // 3. Provider: Chỉ gửi nếu schema có trường 'provider'
    if (props.provider && task.provider) {
      args.provider = task.provider;
    }

    // 4. Model: Chỉ gửi nếu schema có trường 'model'
    if (props.model && task.model) {
      args.model = task.model;
    }

    // 5. Số lượng kết quả: Chỉ gửi nếu schema có 'count' hoặc 'n'
    if (props.count) {
      args.count = task.count;
    } else if (props.n) {
      args.n = task.count;
    }

    // 6. Ảnh tham chiếu: Chỉ gửi nếu schema có 'reference_image' hoặc 'image'
    if (task.referenceImage) {
      if (props.reference_image) args.reference_image = task.referenceImage;
      else if (props.image) args.image = task.referenceImage;
    }

    // 7. Khung hình đầu / cuối
    if (task.startFrame && props.start_frame) args.start_frame = task.startFrame;
    if (task.endFrame && props.end_frame) args.end_frame = task.endFrame;

    // Kiểm tra các trường bắt buộc của schema
    const required = tool.inputSchema?.required || [];
    for (const reqField of required) {
      if (args[reqField] === undefined || args[reqField] === '') {
        throw new Error(`Tool "${tool.name}" yêu cầu tham số bắt buộc "${reqField}", nhưng chưa được cung cấp.`);
      }
    }

    return args;
  }

  async submitTask(task) {
    const mcp = this.getMcp();
    if (!mcp || !mcp.connected) {
      task.status = 'failed';
      task.error = 'Chưa kết nối TobyFlow MCP.';
      this.save();
      return;
    }

    // REQUIREMENT 4: Tìm chính xác tool gen_video, không đoán tên tool bất kỳ
    const genTool = mcp.findTool('gen_video') || mcp.findTool('generate_video');
    if (!genTool) {
      task.status = 'failed';
      task.error = 'Tài khoản MCP này không cung cấp tool tạo video "gen_video". Không thể tự đoán tool thay thế.';
      this.save();
      return;
    }

    task.status = 'submitting';
    task.progress = 10;
    task.startedAt = new Date().toISOString();
    task.error = null;
    this.save();

    try {
      const toolArgs = this.buildToolArguments(genTool, task);
      console.log(`[Queue] Gọi tool ${genTool.name} với tham số thực tế:`, JSON.stringify(toolArgs));

      const rawResult = await mcp.callTool(genTool.name, toolArgs, 90000);

      const jobId = rawResult?.job_id || rawResult?.jobId || rawResult?.id ||
                    (typeof rawResult === 'string' && rawResult.startsWith('job_') ? rawResult : null);

      const directOutputs = rawResult?.videos || rawResult?.outputs || rawResult?.results ||
                            (Array.isArray(rawResult) ? rawResult : null);

      if (directOutputs && Array.isArray(directOutputs) && directOutputs.length > 0) {
        task.progress = 100;
        const effectiveJobId = jobId || task.id;

        // Gộp kết quả vào thư viện thống nhất
        this.library.addResults(directOutputs, {
          jobId: effectiveJobId,
          prompt: task.prompt,
          provider: task.provider
        });

        // Sửa task.resultCount thành số kết quả của chính job đó
        const jobResults = this.library.getResultsByJobId(effectiveJobId);
        task.resultCount = jobResults.length;

        if (task.count > 1 && jobResults.length > 0 && jobResults.length < task.count) {
          task.status = 'partial';
        } else {
          task.status = 'completed';
        }
        task.completedAt = new Date().toISOString();
        this.save();
      } else if (jobId) {
        task.jobId = String(jobId);
        task.status = 'running';
        task.progress = 25;
        this.save();
        this.startPolling(task.id, task.jobId);
      } else {
        throw new Error(`MCP không trả về job_id hợp lệ: ${JSON.stringify(rawResult).slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[Queue] Lỗi gửi tác vụ ${task.id}:`, err.message);
      task.status = 'failed';
      task.error = err.message;
      task.completedAt = new Date().toISOString();
      this.save();
    }
  }

  startPolling(taskId, jobId) {
    if (this.activePollers.has(taskId)) {
      clearInterval(this.activePollers.get(taskId));
      this.activePollers.delete(taskId);
    }

    const task = this.getTask(taskId);
    if (!task) return;

    const mcp = this.getMcp();

    // KIỂM TRA NGAY: Nếu thiếu tool get_job hoặc trường Job ID trong schema, đánh dấu tác vụ thất bại ngay và cho hàng đợi chạy tiếp
    if (!mcp || !mcp.connected) {
      task.status = 'failed';
      task.error = 'Chưa kết nối TobyFlow MCP.';
      task.completedAt = new Date().toISOString();
      this.save();
      this.processQueue();
      return;
    }

    const getJobTool = mcp.findTool('get_job');
    if (!getJobTool) {
      task.status = 'failed';
      task.error = 'Không tìm thấy tool "get_job" trong danh sách MCP của tài khoản. Không thể tự đoán tool.';
      task.completedAt = new Date().toISOString();
      this.save();
      this.processQueue(); // Đánh dấu thất bại ngay và cho hàng đợi chạy tiếp
      return;
    }

    const props = getJobTool.inputSchema?.properties || {};
    let idKey = null;
    if (props.job_id) idKey = 'job_id';
    else if (props.jobId) idKey = 'jobId';
    else {
      task.status = 'failed';
      task.error = 'Tool "get_job" không có trường Job ID ("job_id" hoặc "jobId") phù hợp trong schema.';
      task.completedAt = new Date().toISOString();
      this.save();
      this.processQueue(); // Đánh dấu thất bại ngay và cho hàng đợi chạy tiếp
      return;
    }

    let attempts = 0;
    const maxAttempts = 150;

    const timer = setInterval(async () => {
      attempts++;
      const currentTask = this.getTask(taskId);
      const currentMcp = this.getMcp();

      if (!currentTask || currentTask.status === 'cancelled' || currentTask.status === 'failed' || !currentMcp || !currentMcp.connected) {
        clearInterval(timer);
        this.activePollers.delete(taskId);
        this.processQueue(); // Đảm bảo gọi lại để chạy các task pending kế tiếp
        return;
      }

      try {
        const currentGetJob = currentMcp.findTool('get_job');
        if (!currentGetJob) {
          clearInterval(timer);
          this.activePollers.delete(taskId);
          currentTask.status = 'failed';
          currentTask.error = 'Không tìm thấy tool "get_job" trong danh sách MCP của tài khoản. Không thể tự đoán tool.';
          currentTask.completedAt = new Date().toISOString();
          this.save();
          this.processQueue();
          return;
        }

        const currentProps = currentGetJob.inputSchema?.properties || {};
        let currentIdKey = null;
        if (currentProps.job_id) currentIdKey = 'job_id';
        else if (currentProps.jobId) currentIdKey = 'jobId';
        else {
          clearInterval(timer);
          this.activePollers.delete(taskId);
          currentTask.status = 'failed';
          currentTask.error = 'Tool "get_job" không có trường Job ID ("job_id" hoặc "jobId") phù hợp trong schema.';
          currentTask.completedAt = new Date().toISOString();
          this.save();
          this.processQueue();
          return;
        }

        const rawStatus = await currentMcp.callTool(currentGetJob.name, { [currentIdKey]: jobId }, 30000);
        const status = String(rawStatus?.status || rawStatus?.state || '').toLowerCase();
        const progress = rawStatus?.progress || rawStatus?.percent;

        if (typeof progress === 'number') {
          currentTask.progress = Math.min(95, Math.max(25, Math.round(progress)));
        } else {
          currentTask.progress = Math.min(90, 25 + Math.floor(attempts * 2));
        }

        if (['completed', 'success', 'done'].includes(status)) {
          clearInterval(timer);
          this.activePollers.delete(taskId);
          currentTask.progress = 100;

          const rawOutputs = rawStatus.outputs || rawStatus.videos || rawStatus.results || rawStatus.video_urls || rawStatus;
          this.library.addResults(rawOutputs, {
            jobId,
            prompt: currentTask.prompt,
            provider: currentTask.provider
          });

          // Sửa task.resultCount thành số kết quả của chính job đó
          const jobResults = this.library.getResultsByJobId(jobId);
          currentTask.resultCount = jobResults.length;

          if (currentTask.count > 1 && jobResults.length > 0 && jobResults.length < currentTask.count) {
            currentTask.status = 'partial';
          } else {
            currentTask.status = 'completed';
          }
          currentTask.completedAt = new Date().toISOString();
          this.save();
          // Tác vụ hoàn tất -> Tiếp tục chạy tác vụ pending tiếp theo
          this.processQueue();
        } else if (['failed', 'error'].includes(status)) {
          clearInterval(timer);
          this.activePollers.delete(taskId);
          currentTask.status = 'failed';
          currentTask.error = rawStatus.error || rawStatus.message || 'Tác vụ tạo video thất bại từ provider.';
          currentTask.completedAt = new Date().toISOString();
          this.save();
          // Tác vụ thất bại -> Tiếp tục chạy tác vụ pending tiếp theo
          this.processQueue();
        } else {
          this.save();
        }
      } catch (pollErr) {
        console.warn(`[Queue] Lỗi poll job ${jobId} (lần ${attempts}):`, pollErr.message);
        if (attempts >= maxAttempts) {
          clearInterval(timer);
          this.activePollers.delete(taskId);
          currentTask.status = 'failed';
          currentTask.error = `Quá thời gian chờ phản hồi kết quả từ MCP (${maxAttempts} lần kiểm tra).`;
          currentTask.completedAt = new Date().toISOString();
          this.save();
          // Quá hạn thất bại -> Tiếp tục chạy tác vụ pending tiếp theo
          this.processQueue();
        }
      }
    }, this.pollIntervalMs);

    this.activePollers.set(taskId, timer);
  }

  retryTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw new Error('Không tìm thấy tác vụ.');
    task.status = 'pending';
    task.progress = 0;
    task.error = null;
    task.startedAt = null;
    task.completedAt = null;
    task.jobId = null;
    this.save();
    this.processQueue();
    return task;
  }

  cancelTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw new Error('Không tìm thấy tác vụ.');
    if (this.activePollers.has(taskId)) {
      clearInterval(this.activePollers.get(taskId));
      this.activePollers.delete(taskId);
    }
    task.status = 'cancelled';
    task.error = 'Đã hủy theo dõi trong ứng dụng.';
    task.completedAt = new Date().toISOString();
    this.save();
    this.processQueue();
    return task;
  }

  deleteTask(taskId) {
    const idx = this.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) throw new Error('Không tìm thấy tác vụ.');
    if (this.activePollers.has(taskId)) {
      clearInterval(this.activePollers.get(taskId));
      this.activePollers.delete(taskId);
    }
    this.tasks.splice(idx, 1);
    this.save();
    this.processQueue();
    return true;
  }
}

module.exports = { QueueManager };
