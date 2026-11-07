const fs = require('node:fs');
const path = require('node:path');

// Shared allowlist for review and export. No recursive copy of the working folder.
function publicFiles(root) {
  const files = [
    '.gitignore', 'README.md', 'LICENSE',
    '.github/workflows/windows.yml',
    'docs/ASSETS.md', 'docs/TESTING.md', 'docs/RELEASE.md', 'docs/PIKABU_DRAFT.md', 'docs/PREPARATION_STATUS.md', 'docs/CHANGELOG.md',
    'docs/superpowers/specs/2026-11-07-public-alpha-design.md',
    'docs/superpowers/specs/2026-11-07-pet-menu-behavior-design.md',
    'scripts/public-files.cjs', 'scripts/check-project.cjs', 'scripts/export-source.cjs',
    'app_frames/package.json', 'app_frames/package-lock.json', 'app_frames/start.bat',
    'app_frames/LICENSE', 'app_frames/PRIVACY.md',
    'app_frames/tests/core.test.cjs', 'app_frames/tests/behavior.test.cjs', 'app_frames/tests/live.cjs', 'app_frames/tests/native-smoke.cjs'
  ];
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'app_frames/package.json'), 'utf8'));
  for (const pattern of pkg.build.files) {
    if (!pattern.includes('*')) { files.push('app_frames/' + pattern); continue; }
    if (!/^(skills\/\*\.js|assets\/\*\.png)$/.test(pattern)) throw new Error('Unexpected export pattern: ' + pattern);
    const [dir, glob] = pattern.split('/');
    const extension = glob.slice(1);
    for (const name of fs.readdirSync(path.join(root, 'app_frames', dir)).sort()) {
      if (name.endsWith(extension)) files.push(`app_frames/${dir}/${name}`);
    }
  }
  return [...new Set(files)].sort();
}
module.exports = { publicFiles };
