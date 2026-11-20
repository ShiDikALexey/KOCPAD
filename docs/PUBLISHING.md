# Publishing KOCPAD on GitHub

> **Status:** the repository is live at
> <https://github.com/ShiDikALexey/KOCPAD>, branch `main`, with CI building the
> Windows installers on every push. The steps below are kept for reference — how
> the repo was created and how to cut the next release.

The repository is ready to push; only the remote is missing. Nothing in the code
refers to a hard-coded GitHub account, so pick your own name.

## 1. Create an empty repository

On <https://github.com/new>:

- **Repository name:** `KOCPAD`
- **Visibility:** your choice (the MIT license already allows anything)
- **Do not** initialise it with a README, `.gitignore` or license — this repo
  already has all three, and an empty remote keeps the first push trivial.

With the GitHub CLI installed (`winget install GitHub.cli`, then `gh auth login`),
one command does the same:

```bash
gh repo create KOCPAD --public --source=. --remote=origin --push
```

## 2. Push

```bash
git branch -M main
git remote add origin https://github.com/<your-account>/KOCPAD.git
git push -u origin main
```

If you use SSH instead:

```bash
git remote add origin git@github.com:<your-account>/KOCPAD.git
git push -u origin main
```

## 3. Check the build

`.github/workflows/build.yml` runs on the first push:

- **frontend** (Ubuntu): `npm ci` → `npm run typecheck` → `vite build`
- **e2e** (Ubuntu): `npm ci` → Playwright Chromium → `npm run test:e2e`
- **windows**: `npm ci` → `npm run tauri:build` → uploads the NSIS installer, the
  MSI and the portable `kocpad.exe` as the `kocpad-windows` artifact
- **release**: on a `v*` tag the installers and `SHA256SUMS.txt` are attached to a
  GitHub Release

Give the Windows job 10–15 minutes the first time (Rust dependencies compile from
scratch). Later runs reuse the cargo cache.

## 4. Cut a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds the installers and publishes a release with generated notes.
The release job also writes `SHA256SUMS.txt` next to the installers, so anyone can
verify a download. Bump the version with the script — it updates `package.json`,
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` in one go and writes plain
UTF-8 (PowerShell's `Set-Content` adds a BOM, which Tauri's config parser rejects):

```bash
node scripts/bump-version.cjs 0.2.2
git commit -am "release: 0.2.2"
git tag -a v0.2.2 -m "KOCPAD 0.2.2"
git push origin main v0.2.2
```

## 5. Auto-updates

The in-app updater is wired up but inactive until one secret exists. It needs its
own minisign keypair — this is **not** the Windows Authenticode certificate and it
does not remove SmartScreen warnings.

How it is built:

- the **public** key lives in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
  and is safe to commit. Do not regenerate it unless you accept that installed
  copies can no longer be updated;
- the **private** key is generated once with
  `npx tauri signer generate -w ~/.tauri/kocpad.key` and stored outside the repo;
- the endpoint is
  `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`.

Steps to turn it on:

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

- only NSIS installs (the default installer) update in place; the portable
  `kocpad.exe` and a manually installed MSI are updated by downloading a new release;
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
