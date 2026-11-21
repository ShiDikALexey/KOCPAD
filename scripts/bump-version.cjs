// Bumps KOCPAD's version in the places that must agree, including the lockfile.
const fs = require('node:fs');

const VERSION = process.argv[2];
// Plain semver plus prerelease suffixes such as 1.5.0-beta.1 (beta tags).
if (!VERSION || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(VERSION)) {
  console.error('usage: node bump-version.cjs <x.y.z[-beta.N]>');
  process.exit(1);
}

const pkgPath = 'package.json';
const confPath = 'src-tauri/tauri.conf.json';
const cargoPath = 'src-tauri/Cargo.toml';
const lockPath = 'package-lock.json';

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = VERSION;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
conf.version = VERSION;
fs.writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);

const cargo = fs.readFileSync(cargoPath, 'utf8').replace(/^version = "[^"]+"/m, `version = "${VERSION}"`);
fs.writeFileSync(cargoPath, cargo);

// The lockfile keeps its own copy of the root version; leaving it stale makes
// npm ci print a mismatch warning.
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = VERSION;
  if (lock.packages && lock.packages['']) lock.packages[''].version = VERSION;
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

console.log(`package.json -> ${pkg.version}`);
console.log(`tauri.conf.json -> ${conf.version}`);
console.log(`Cargo.toml -> ${/^version = "([^"]+)"/m.exec(cargo)[1]}`);
if (fs.existsSync(lockPath)) console.log(`package-lock.json -> ${VERSION}`);
