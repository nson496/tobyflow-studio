const fs = require('fs');
const path = require('path');
const os = require('os');
const { commitVideoToDestination, verifyVideoFile } = require('../server/fileManager');
const configManager = require('../server/configManager');

async function testSelectiveSaveAndSecurity() {
  const testDestDir = path.join(os.tmpdir(), `tobyflow_dest_test_${Date.now()}`);
  const testStagingDir = path.join(os.tmpdir(), `tobyflow_stage_test_${Date.now()}`);

  fs.mkdirSync(testDestDir, { recursive: true });
  fs.mkdirSync(testStagingDir, { recursive: true });

  const results = [];

  try {
    // Create 3 simulated staged video files (with dummy MP4 header 'ftyp')
    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const vid1 = path.join(testStagingDir, 'staged_vid1.mp4');
    const vid2 = path.join(testStagingDir, 'staged_vid2.mp4');
    const vid3 = path.join(testStagingDir, 'staged_vid3.mp4');

    fs.writeFileSync(vid1, Buffer.concat([mp4Header, Buffer.from('video data 1')]));
    fs.writeFileSync(vid2, Buffer.concat([mp4Header, Buffer.from('video data 2')]));
    fs.writeFileSync(vid3, Buffer.concat([mp4Header, Buffer.from('video data 3')]));

    // Verification check
    const check1 = verifyVideoFile(vid1);
    if (!check1.valid) throw new Error('Simulated video header check failed');
    results.push({ test: 'Staging video verification', ok: true, size: check1.size });

    // User only selects Video #1 and Video #3. Video #2 is NOT selected!
    const saved1 = commitVideoToDestination(vid1, 'prompt 1', testDestDir);
    const saved3 = commitVideoToDestination(vid3, 'prompt 3', testDestDir);

    results.push({ test: 'Selected Video 1 saved', ok: true, path: saved1.fullPath });
    results.push({ test: 'Selected Video 3 saved', ok: true, path: saved3.fullPath });

    // Verify Destination Folder contents
    const destFiles = fs.readdirSync(testDestDir);
    if (destFiles.length !== 2) {
      throw new Error(`Expected exactly 2 files in destination folder, got ${destFiles.length}`);
    }

    // CRITICAL REQUIREMENT: Video 2 must NOT be in destination folder!
    const containsVid2 = destFiles.some(f => f.includes('prompt_2') || f.includes('vid2'));
    if (containsVid2) {
      throw new Error('Unselected video was leaked into destination folder!');
    }
    results.push({ test: 'Unselected Video 2 NOT in destination folder', ok: true });

    // Test Destination Folder Write-Protection Check
    // Create an invalid/read-only path or test checkDestinationFolder
    const invalidPath = 'Z:\\non_existent_drive_folder_12345';
    const writeCheck = configManager.checkDestinationFolder(invalidPath);
    if (writeCheck.ok) {
      throw new Error('Write check should have failed for invalid drive path');
    }
    results.push({ test: 'Folder write-permission error detection', ok: true, errorCaptured: writeCheck.error });

    return { ok: true, name: 'Kiểm thử Lưu chọn lọc & An toàn thư mục đích', results };
  } finally {
    try {
      fs.rmSync(testDestDir, { recursive: true, force: true });
      fs.rmSync(testStagingDir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = { testSelectiveSaveAndSecurity };

if (require.main === module) {
  testSelectiveSaveAndSecurity().then(console.log).catch(console.error);
}

