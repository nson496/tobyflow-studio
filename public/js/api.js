// TobyFlow API Helper Layer
const API = {
  async getStatus() {
    const res = await fetch('/api/status');
    return await res.json();
  },

  async getConfig() {
    const res = await fetch('/api/config');
    return await res.json();
  },

  async saveConfig(config) {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    return await res.json();
  },

  async testMcpConnection(config = null) {
    const res = await fetch('/api/mcp/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config || {})
    });
    return await res.json();
  },

  async getMcpTools() {
    const res = await fetch('/api/mcp/tools');
    return await res.json();
  },

  async checkProviderStatus() {
    const res = await fetch('/api/mcp/provider-status');
    return await res.json();
  },

  async getTasks() {
    const res = await fetch('/api/tasks');
    return await res.json();
  },

  async createTask(data) {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  },

  async retryTask(taskId) {
    const res = await fetch(`/api/tasks/${taskId}/retry`, { method: 'POST' });
    return await res.json();
  },

  async cancelTask(taskId) {
    const res = await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' });
    return await res.json();
  },

  async deleteTask(taskId) {
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    return await res.json();
  },

  async saveSelectedResults(taskId, selectedIndexes) {
    const res = await fetch(`/api/tasks/${taskId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedIndexes })
    });
    return await res.json();
  },

  async openFile(path) {
    const res = await fetch('/api/files/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    return await res.json();
  },

  async exploreFolder(path) {
    const res = await fetch('/api/files/explore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    return await res.json();
  },

  async pickFolder() {
    const res = await fetch('/api/files/pick-folder', { method: 'POST' });
    return await res.json();
  },

  async runTests() {
    const res = await fetch('/api/test/run', { method: 'POST' });
    return await res.json();
  }
};

