// Prepares the bundle for the version in package.json.
//
// WiX/MSI rejects prerelease identifiers that are not numeric ("1.5.0-beta.1"),
// so beta builds ship the NSIS installer only. The release job and the updater
// only use the NSIS installer anyway; MSI returns for plain releases.
const fs = require('node:fs');

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const prerelease = version.includes('-');

const path = 'src-tauri/tauri.conf.json';
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.bundle = config.bundle ?? {};
const targets = prerelease ? ['nsis'] : ['nsis', 'msi'];
const current = JSON.stringify(config.bundle.targets ?? null);
if (current === JSON.stringify(targets)) {
  console.log(`bundle targets already ${current}`);
  process.exit(0);
}
config.bundle.targets = targets;
fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
if (prerelease) {
  console.log(`prerelease ${version}: MSI disabled (WiX needs a numeric prerelease), NSIS only`);
} else {
  console.log(`plain version ${version}: NSIS + MSI enabled`);
}
