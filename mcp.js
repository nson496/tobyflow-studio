const { spawn } = require('node:child_process');

function decodeToolResult(result) {
  if (result?.isError) {
    const message = result.content?.filter(x => x.type === 'text').map(x => x.text).join(' ') || 'TobyFlow báo lỗi';
    throw new Error(message);
  }
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const blocks = result?.content?.filter(x => x.type === 'text').map(x => x.text) || [];
  if (blocks.length === 1) {
    try { return JSON.parse(blocks[0]); } catch { return blocks[0]; }
  }
  return blocks.length ? blocks.map(x => { try { return JSON.parse(x); } catch { return x; } }) : result;
}

class StdioMcpClient {
  constructor(url, token, options = {}) {
    this.url = url;
    this.token = token;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.tools = [];
    this.stderr = '';
    this.runner = options.runner;
    this.connected = false;
    this.serverInfo = null;
  }

  async connect() {
    const url = new URL(this.url);
    if (url.protocol !== 'https:') throw new Error('Địa chỉ MCP phải dùng HTTPS.');
    if (!this.token || !this.token.trim()) throw new Error('Token MCP không được để trống.');

    // Token stays strictly in child process environment; never in command-line arguments.
    const env = { ...process.env, TOBYFLOW_AUTH_HEADER: `Bearer ${this.token.trim()}` };
    const header = 'Authorization:${TOBYFLOW_AUTH_HEADER}';
    const command = this.runner?.command || (process.platform === 'win32' ? 'cmd.exe' : 'npx');
    const args = this.runner?.args || (process.platform === 'win32'
      ? ['/d', '/s', '/c', `npx -y mcp-remote "${url.href}" --header "${header}"`]
      : ['-y', 'mcp-remote', url.href, '--header', header]);

    this.child = spawn(command, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', chunk => this.onData(chunk));
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-2000); });
    this.child.on('error', error => this.failAll(error));
    this.child.on('exit', code => {
      this.connected = false;
      this.failAll(new Error(`MCP bridge đã dừng (${code}). ${this.stderr.slice(-300)}`));
    });

    const init = await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'TobyFlow Studio Windows', version: '2.0.0' }
    }, 25000);

    this.serverInfo = init.serverInfo || { name: 'TobyFlow MCP Server' };
    this.notify('notifications/initialized', {});

    const listed = await this.request('tools/list', {}, 20000);
    this.tools = listed.tools || [];
    let cursor = listed.nextCursor;
    while (cursor) {
      const page = await this.request('tools/list', { cursor }, 20000);
      this.tools.push(...(page.tools || []));
      cursor = page.nextCursor;
    }

    // REQUIREMENT 3: Khi MCP trả 0 tool, không trả connected: true; hiển thị không khả dụng và cảnh báo rõ.
    if (!this.tools || this.tools.length === 0) {
      this.connected = false;
      this.close();
      throw new Error('MCP Server phản hồi nhưng không cung cấp tool nào (0 tool khả dụng). Quyền MCP hoặc tài khoản TobyFlow chưa sẵn sàng.');
    }

    this.connected = true;

    return {
      serverInfo: this.serverInfo,
      tools: this.tools,
      toolCount: this.tools.length,
      hasTools: true
    };
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id === undefined) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || 'MCP RPC error'));
      else pending.resolve(message.result);
    }
  }

  request(method, params = {}, timeoutMs = 30000) {
    if (!this.child || this.child.killed) return Promise.reject(new Error('Chưa kết nối MCP. Hãy kết nối trong mục Cài đặt.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP không phản hồi lệnh ${method} trong ${Math.round(timeoutMs / 1000)} giây. Kiểm tra xem Chrome và extension TobyFlow có đang mở không.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params = {}) {
    if (this.child && !this.child.killed) {
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }
  }

  findTool(name) {
    return this.tools.find(tool => tool.name === name);
  }

  async callTool(name, args = {}, timeoutMs = 60000) {
    const raw = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    return decodeToolResult(raw);
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.connected = false;
    this.failAll(new Error('Kết nối MCP đã đóng.'));
    if (this.child && !this.child.killed) {
      try { this.child.kill(); } catch {}
    }
  }
}

module.exports = { StdioMcpClient, decodeToolResult };
