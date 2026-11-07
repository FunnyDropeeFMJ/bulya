const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { publicFiles } = require('./public-files.cjs');
const root = path.resolve(__dirname, '..');
const checked = spawnSync(process.execPath, [path.join(__dirname, 'check-project.cjs')], { stdio: 'inherit' });
if (checked.status !== 0) process.exit(1);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(root, 'publish', `bulya-source-${stamp}`);
fs.mkdirSync(destination, { recursive: true });
const files = publicFiles(root);
for (const rel of files) {
  const target = path.join(destination, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, rel), target, fs.constants.COPYFILE_EXCL);
}
const verification = spawnSync(process.execPath, [path.join(destination, 'scripts/check-project.cjs')], { stdio: 'inherit' });
if (verification.status !== 0) process.exit(1);
console.log(`Exported ${files.length} files to ${destination}`);
console.log('No repository was created or published. Upload only this folder after reviewing it.');
