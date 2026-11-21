// Fails when the version or the tag disagree between the files that ship a build.
// Usage: node scripts/check-versions.cjs
// Tag check is active when GITHUB_REF_NAME is set (GitHub Actions).
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
const cargo = /^version = "([^"]+)"/m.exec(read('src-tauri/Cargo.toml'));

const problems = [];
const expect = pkg.version;
const compare = (label, value) => {
  if (value !== expect) problems.push(`${label} is ${value}, package.json is ${expect}`);
};

compare('package-lock.json', lock.version);
if (lock.packages && lock.packages['']) compare('package-lock.json packages[]', lock.packages[''].version);
compare('src-tauri/tauri.conf.json', conf.version);
compare('src-tauri/Cargo.toml', cargo ? cargo[1] : 'MISSING');

const tag = (process.env.GITHUB_REF_NAME ?? '').trim();
if (tag.startsWith('v')) {
  const tagVersion = tag.slice(1);
  if (tagVersion !== expect) {
    problems.push(`tag ${tag} does not match version ${expect}`);
  }
  const tagIsBeta = tagVersion.includes('-');
  const versionIsBeta = expect.includes('-');
  if (tagIsBeta !== versionIsBeta) {
    problems.push(
      `tag/version prerelease mismatch: ${tag} vs ${expect} (beta builds must carry a suffix such as -beta.1)`,
    );
  }
}

if (problems.length) {
  console.error('Version check failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Versions agree: ${expect}${tag ? ` (tag ${tag})` : ''}`);
