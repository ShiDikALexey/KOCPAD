// Bumps KOCPAD's version in the three places that must agree.
const fs = require('node:fs');

const VERSION = process.argv[2];
if (!VERSION || !/^\d+\.\d+\.\d+$/.test(VERSION)) {
  console.error('usage: node bump-version.cjs <x.y.z>');
  process.exit(1);
}

const pkgPath = 'package.json';
const confPath = 'src-tauri/tauri.conf.json';
const cargoPath = 'src-tauri/Cargo.toml';

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = VERSION;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
conf.version = VERSION;
fs.writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);

const cargo = fs.readFileSync(cargoPath, 'utf8').replace(/^version = "[^"]+"/m, `version = "${VERSION}"`);
fs.writeFileSync(cargoPath, cargo);

console.log(`package.json -> ${pkg.version}`);
console.log(`tauri.conf.json -> ${conf.version}`);
console.log(`Cargo.toml -> ${/^version = "([^"]+)"/m.exec(cargo)[1]}`);
