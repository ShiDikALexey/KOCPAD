# Beta branch

`main` is the release line: a plain `v*` tag from it becomes `/releases/latest` and
feeds the stable updater. Finished work lands there.

`beta` is where the next version is built. UI changes, experiments and anything
that still needs a second look go here first. Beta tags carry a hyphen
(`1.5.3-beta.14`) and are published as GitHub prereleases.

## Workflow

1. Branch from `beta` for a change, or commit small fixes directly.
2. CI runs five jobs: typecheck + build, e2e (75 Playwright scenarios), Windows
   installers, a manual native-e2e job, and a release job for tags. The release job
   requires typecheck and e2e to be green and checks that a stable tag is on `main`
   and a prerelease tag is on `beta`.
3. On `beta` the Windows job uploads `kocpad-windows` — a portable exe, the NSIS
   installer and the updater signature. MSI is skipped for prerelease versions:
   WiX does not accept non-numeric identifiers.
4. When verified, merge `beta` into `main` only on the owner's explicit command,
   bump the version, and tag the release.

## Beta updates

A tag with a hyphen is a prerelease. It does not move `/releases/latest`; instead CI
updates the rolling `beta-channel` release whose `latest.json` the beta updater
reads. The beta channel refuses to move backwards. Stable users are not affected.

Beta builds are unsigned. A fresh beta build starts on the beta channel (until the
user picks a channel explicitly), so it can see the next beta; a stable build stays
on the stable channel.

## Getting a beta build

- From the Actions tab: open the latest `build` run on `beta`, download
  `kocpad-windows`, unpack the installer or `kocpad.exe`.
- Locally: `git checkout beta`, `npm ci`, then
  `node scripts/prepare-build.cjs && npm run tauri:build`. The prepare script drops
  the MSI target for prerelease versions; restore `src-tauri/tauri.conf.json` with
  `git checkout -- src-tauri/tauri.conf.json` afterwards if the version is stable.

## Do not

- Tag a stable version from `beta` — CI rejects it, because the release job verifies
  the tag's branch.
- Move `beta-channel` to an older build — CI rejects that too.
