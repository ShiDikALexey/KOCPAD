/**
 * Builds the static `latest.json` that the Tauri updater reads from a release.
 *
 * The release job runs this after the installers are downloaded. If the build was
 * made without an updater signing key there are no `.sig` files, so the script
 * exits quietly and the release simply has no auto-update entry — the app then
 * reports that no update information is available.
 */

const fs = require('node:fs');
const path = require('node:path');

const artifactsDir = process.argv[2] ?? 'artifacts';
const version = require('../package.json').version;
const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME ?? `v${version}`;

if (!repository) {
  console.error('GITHUB_REPOSITORY is not set');
  process.exit(1);
}

const files = fs.readdirSync(artifactsDir, { recursive: true }).map((file) => String(file));
const signatureFile = files.find((file) => file.endsWith('-setup.exe.sig'));
if (!signatureFile) {
  console.log('No .sig file found: release will not include updater metadata');
  process.exit(0);
}

const installer = signatureFile.replace(/\.sig$/, '');
if (!files.includes(installer)) {
  console.error(`Signature without installer: ${signatureFile}`);
  process.exit(1);
}

const signature = fs.readFileSync(path.join(artifactsDir, signatureFile), 'utf8').trim();
const assetUrl = `https://github.com/${repository}/releases/download/${tag}/${path.basename(installer)}`;

const latest = {
  version,
  notes: `KOCPAD ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: assetUrl,
    },
  },
};

const target = path.join(artifactsDir, 'latest.json');
fs.writeFileSync(target, `${JSON.stringify(latest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${target} for ${installer}`);
