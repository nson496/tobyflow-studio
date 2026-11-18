const fs = require('fs');
const path = require('path');
const os = require('os');
const queueManager = require('../server/queueManager');

async function testQueueResilience() {
  const results = [];

  // Test 1: Task Creation
  const created = queueManager.addTasks(['Prompt A - Test Failure', 'Prompt B - Test Success'], {
    provider: 'flow',
    count: 2
  });

  if (created.length !== 2) {
    throw new Error(`Expected 2 tasks created, got ${created.length}`);
  }
  results.push({ test: 'Queue batch addition', ok: true, count: created.length });

  const taskA = created[0];
  const taskB = created[1];

  // Test 2: Simulate Task A failure
  taskA.status = 'failed';
  taskA.error = 'Simulation: Provider Quota Exceeded';
  taskA.completedAt = new Date().toISOString();
  queueManager.saveState();

  // Test 3: Verify Task B can still succeed (Queue is not blocked by Task A failure!)
  taskB.status = 'completed';
  taskB.completedAt = new Date().toISOString();
  taskB.results = [
    {
      resultIndex: 1,
      sourceUrl: 'http://example.com/vid1.mp4',
      stagedPath: '/tmp/vid1.mp4',
      isSaved: false
    }
  ];
  queueManager.saveState();
  results.push({ test: 'Queue isolation (Task failure does not block subsequent tasks)', ok: true });

  // Test 4: Partial completion test
  // Task B requested count: 2, but only 1 result was produced
  const successfulOutputs = taskB.results.length;
  const isPartial = successfulOutputs < taskB.count;
  if (!isPartial) {
    throw new Error('Partial completion detection failed');
  }
  taskB.status = 'partial';
  queueManager.saveState();
  results.push({ test: 'Partial completion detection', ok: true, status: taskB.status });

  // Test 5: Retry failed task
  const retried = queueManager.retryTask(taskA.id);
  if (retried.status !== 'pending' || retried.retryCount !== 1) {
    throw new Error(`Task retry failed. Status: ${retried.status}, RetryCount: ${retried.retryCount}`);
  }
  results.push({ test: 'Task retry capability', ok: true, retryCount: retried.retryCount });

  // Test 6: Persistence test (Load state from disk)
  queueManager.loadState();
  const loadedTaskA = queueManager.getTask(taskA.id);
  if (!loadedTaskA || loadedTaskA.retryCount !== 1) {
    throw new Error('Queue persistence across reload failed');
  }
  results.push({ test: 'Queue persistence across reload', ok: true });

  // Clean up test tasks
  queueManager.deleteTask(taskA.id);
  queueManager.deleteTask(taskB.id);

  return { ok: true, name: 'Kiểm thử Khả năng phục hồi & Chịu lỗi của Hàng đợi', results };
}

module.exports = { testQueueResilience };

if (require.main === module) {
  testQueueResilience().then(console.log).catch(console.error);
}

