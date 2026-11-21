# Publishing KOCPAD on GitHub

> **Status:** the repository is live at
> <https://github.com/ShiDikALexey/KOCPAD>. `main` is the release line (currently
> `1.4.0`), `beta` is the next version (`1.4.1`). CI builds Windows installers on
> every push and publishes a release on every `v*` tag. This page documents the
> workflow and how to cut the next release.

## 1. Repository

The repository already exists; there is nothing to create or push the first time.
`origin` points at GitHub, and both branches are built by
`.github/workflows/build.yml`. If you ever move the project, update `origin` and the
updater endpoint in `src-tauri/tauri.conf.json`.

## 2. Check the build

`.github/workflows/build.yml` runs on every push to `main` and `beta`, on pull
requests and on tags:

- **frontend** (Ubuntu): `npm ci` → version/tag check → `npm run typecheck` →
  `vite build`
- **e2e** (Ubuntu): `npm ci` → Playwright Chromium → `npm run test:e2e`
- **windows**: `npm ci` → `npm run tauri:build` → uploads the NSIS installer, the
  MSI and the portable `kocpad.exe` as the `kocpad-windows` artifact. The upload
  fails if the installers are missing.
- **release**: on a `v*` tag the installers and `SHA256SUMS.txt` are attached to a
  GitHub Release; the tag must match the version in all four files.

Give the Windows job 10–15 minutes the first time (Rust dependencies compile from
scratch). Later runs reuse the cargo cache.

## 3. Cut a release

The rules live in [VERSIONING.md](VERSIONING.md). In short: features land on
`beta`, get used there, then merge to `main` and are tagged. One release per week at
most.

```bash
git checkout main
git merge beta                    # after the beta has been used for a while
npm run check:versions            # tag/version sanity while working
node scripts/bump-version.cjs 1.4.2
# write the "## [1.4.2]" section in CHANGELOG.md — the release job requires it
git commit -am "release: 1.4.2"
git tag -a v1.4.2 -m "KOCPAD 1.4.2"
git push origin main v1.4.2
```

The release job extracts the `CHANGELOG.md` section for the tag as the release
body, writes `SHA256SUMS.txt` next to the installers, and publishes `latest.json`
when the updater key is configured.

- A tag with a suffix (`v1.5.0-beta.1`) is published as a **pre-release**: it does
  not become `/releases/latest`, so the updater never offers a beta to stable users.
- A pre-release tag needs a matching `-beta` version; CI fails otherwise.
- Do not renumber backwards and do not delete releases — see VERSIONING.md.

The bump script updates `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`
and `src-tauri/tauri.conf.json` in one go and writes plain UTF-8 (PowerShell's
`Set-Content` adds a BOM, which Tauri's config parser rejects).

## 4. Auto-updates

The updater is **active**: the project keypair exists, the public half is committed
and `TAURI_SIGNING_PRIVATE_KEY` is set in the repository secrets. This is a
minisign key, **not** the Windows Authenticode certificate, and it does not remove
SmartScreen warnings.

How it is built:

- the **public** key lives in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
  and is safe to commit. Do not regenerate it unless you accept that installed
  copies can no longer be updated;
- the **private** key is generated once with
  `npx tauri signer generate -w ~/.tauri/kocpad.key` and stored outside the repo;
- the endpoint is
  `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`.

How it was switched on (already done):

1. Keep the private key safe. If it is lost, already installed copies can never
   receive another update — they would have to be reinstalled by hand.
2. Repository → Settings → Secrets and variables → Actions → New secret:
   - `TAURI_SIGNING_PRIVATE_KEY` — the whole content of `kocpad.key` (one line);
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the key password; skip the secret if the
     key has no password.
3. Push a `v*` tag. The Windows job runs `scripts/enable-updater.cjs`, which flips
   `bundle.createUpdaterArtifacts` on for that build, so Tauri writes
   `KOCPAD_<version>_x64-setup.exe.sig` next to the installer.
4. The release job runs `scripts/make-latest-json.cjs`, which writes `latest.json`
   (version, installer URL, signature) and attaches it to the release together with
   the `.sig` file.
5. In the app: «⋯» → «Проверить обновления…». KOCPAD verifies the signature against
   the public key, downloads the installer and, in `passive` mode, installs it; on
   Windows the app closes itself during the install and must be started again.

Notes:

- the updater channel is the NSIS installer (`installMode: passive`); the portable
  `kocpad.exe` and a manually installed MSI are updated by downloading a new
  release. The MSI in-place update path has **not** been verified — do not promise
  it;
- update signatures and Windows code signing are independent: without a certificate
  the first install still shows SmartScreen, while the update itself is verified by
  the minisign key;
- without the secret CI builds an unsigned-updater release: no `.sig`, no
  `latest.json`, and the app reports that no update information is available.

## Notes

- **Code signing.** The Windows job has an optional signing step: with
  `WINDOWS_CERTIFICATE` (base64 of the certificate) and
  `WINDOWS_CERTIFICATE_PASSWORD` set, the portable exe, the NSIS installer and the
  MSI are signed with `signtool` plus a timestamp. Without the secrets the step is
  skipped and the build stays unsigned.

  **Important:** Authenticode rewrites the installer bytes and would invalidate the
  updater `.sig`, so after signing the job re-signs the NSIS installer with the
  updater key (`tauri signer sign`). Without that step every auto-update would fail
  the signature check. The signing secrets are scoped to their steps so `npm ci` and
  crate build scripts never see them.

  What changed in 2023–2026 matters here:

  - since June 2023 the CA/Browser Forum requires code-signing private keys to live
    on FIPS-140-2 hardware (USB token or cloud HSM), so a downloadable `.pfx` is no
    longer issued — the `signtool /f` step only works with legacy or self-signed
    certificates;
  - Microsoft's recommended service is **Azure Artifact Signing** (formerly Trusted
    Signing), ~$10/month, with a 3-year tax history required for organizations in the
    USA, Canada, EU and UK, and individuals only in the USA and Canada;
  - for developers in Russia foreign CAs (Sectigo, DigiCert, GlobalSign) stopped
    issuing to Russian entities and revoke existing certificates; the industry
    ОТУЦ (отраслевой технологический УЦ) issues Russian code-signing certificates,
    but its root is not in Microsoft's trusted list, so SmartScreen will most likely
    keep saying «Unknown publisher»;
  - a self-signed certificate only makes sense for internal distribution where the
    root is deployed by policy.

  Practical conclusion for KOCPAD: shipping unsigned installers with published
  `SHA256SUMS.txt` and auto-updates signed by the updater key is the realistic setup
  until a trusted certificate becomes available.
- Committer identity is set locally in this checkout
  (`git config user.name`, `git config user.email`). Set it to your own before
  pushing so the history is attributed correctly.
