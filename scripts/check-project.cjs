const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { publicFiles } = require('./public-files.cjs');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'app_frames/package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'app_frames/package-lock.json'), 'utf8'));
let failures = 0;
const fail = message => { failures++; console.error(message); };
const files = publicFiles(root);
const forbidden = /(^|\/)(node_modules|test_memory|test_fix|test_files|\.env[^/]*|brain\.key|brain\.json|сейф\.bin|память[^/]*|debug_shot\.png)(\/|$)|\.(log|bak)$/i;
const secret = /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,})\b/;
for (const rel of files) {
  if (forbidden.test(rel)) fail(`Private file in public manifest: ${rel}`);
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) { fail(`Missing public file: ${rel}`); continue; }
  const resolved = fs.realpathSync(full);
  const relative = path.relative(fs.realpathSync(root), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(full).isFile()) {
    fail(`File escapes project or is not regular: ${rel}`); continue;
  }
  if (fs.statSync(full).size > 50 * 1024 * 1024) fail(`Oversized public file: ${rel}`);
  if (!rel.endsWith('.png')) {
    const text = fs.readFileSync(full, 'utf8');
    if (secret.test(text)) fail(`Possible API credential in ${rel}; value hidden`);
  }
  if (/\.(js|cjs)$/.test(rel)) {
    const result = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
    if (result.status !== 0) fail(`Syntax check failed: ${rel}\n${result.stderr}`);
  }
}
for (const field of ['dependencies', 'devDependencies']) {
  const expected = pkg[field] || {}, actual = lock.packages[''][field] || {};
  if (JSON.stringify(Object.entries(expected).sort()) !== JSON.stringify(Object.entries(actual).sort())) fail(`${field} differs from package-lock.json`);
  for (const [name, version] of Object.entries(expected)) {
    if (lock.packages[`node_modules/${name}`]?.version !== version) fail(`Lockfile version mismatch: ${name}`);
  }
}
if (pkg.version !== lock.version) fail('Package version differs from lockfile');
if (fs.readFileSync(path.join(root, 'LICENSE'), 'utf8') !== fs.readFileSync(path.join(root, 'app_frames/LICENSE'), 'utf8')) fail('App and source licenses differ');
console.log(`Public files: ${files.length}. Checks failed: ${failures}.`);
console.log('Checks cover the public allowlist and recognizable token formats; they do not audit Git history or prove the absence of every secret.');
process.exitCode = failures ? 1 : 0;
