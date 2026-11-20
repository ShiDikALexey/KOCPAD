/**
 * Enables updater artifacts when a signing key is available.
 *
 * Tauri cannot build updater bundles without `TAURI_SIGNING_PRIVATE_KEY`, so the
 * committed configuration keeps `createUpdaterArtifacts` off and CI turns it on
 * right before the build once the secret exists. The file is written as UTF-8
 * without BOM, because Tauri's JSON parser rejects a BOM.
 */

const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');
const key = process.env.TAURI_SIGNING_PRIVATE_KEY;

if (!key) {
  console.log('TAURI_SIGNING_PRIVATE_KEY is not set: building without updater artifacts');
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.bundle = config.bundle ?? {};

if (config.bundle.createUpdaterArtifacts === true) {
  console.log('Updater artifacts are already enabled');
  process.exit(0);
}

config.bundle.createUpdaterArtifacts = true;
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log('Updater artifacts enabled: the build will produce .sig files');
