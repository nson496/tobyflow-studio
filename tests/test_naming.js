const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateFilename, getBangkokDateParts } = require('../server/fileManager');

async function testNamingAndCollision() {
  const testDir = path.join(os.tmpdir(), `tobyflow_naming_test_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  const results = [];

  try {
    // 1. Check Bangkok timezone format
    const parts = getBangkokDateParts();
    if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute || !parts.second) {
      throw new Error(`Bangkok timezone date parts invalid: ${JSON.stringify(parts)}`);
    }

    const template = '{date}_{time}_{index}.mp4';

    // 2. Generate first file
    const f1 = generateFilename(testDir, template, 'cyberpunk city', 1);
    fs.writeFileSync(f1.fullPath, 'dummy video 1');
    results.push({ test: 'File 1 creation', ok: true, filename: f1.filename });

    // 3. Generate second file immediately (same second/date) -> MUST auto-increment index!
    const f2 = generateFilename(testDir, template, 'cyberpunk city', 1);
    if (f2.filename === f1.filename) {
      throw new Error(`Collision detected! File 2 generated identical name: ${f2.filename}`);
    }
    if (!f2.filename.includes('002')) {
      throw new Error(`Auto-increment failed. Expected 002, got: ${f2.filename}`);
    }
    fs.writeFileSync(f2.fullPath, 'dummy video 2');
    results.push({ test: 'File 2 auto-increment (anti-collision)', ok: true, filename: f2.filename });

    // 4. Generate third file
    const f3 = generateFilename(testDir, template, 'cyberpunk city', 1);
    if (!f3.filename.includes('003')) {
      throw new Error(`Auto-increment failed for 3rd file. Expected 003, got: ${f3.filename}`);
    }
    fs.writeFileSync(f3.fullPath, 'dummy video 3');
    results.push({ test: 'File 3 auto-increment (anti-collision)', ok: true, filename: f3.filename });

    return { ok: true, name: 'Kiểm thử đặt tên Asia/Bangkok & Chống trùng tên file', results };
  } finally {
    // Clean up
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = { testNamingAndCollision };

if (require.main === module) {
  testNamingAndCollision().then(console.log).catch(console.error);
}

