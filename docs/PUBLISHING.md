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

## Notes

- **Code signing.** The Windows job has an optional signing step. Add two
  repository secrets and the portable exe, the NSIS installer and the MSI are
  signed with `signtool` plus a DigiCert timestamp:

  | Secret | Value |
  | --- | --- |
  | `WINDOWS_CERTIFICATE` | base64 of the `.pfx` file (`[Convert]::ToBase64String([IO.File]::ReadAllBytes('cert.pfx'))`) |
  | `WINDOWS_CERTIFICATE_PASSWORD` | the `.pfx` password |

  Without the secrets the step is skipped and the build stays unsigned. An
  OV/EV certificate is required to remove the SmartScreen warning.
- Committer identity is set locally in this checkout
  (`git config user.name`, `git config user.email`). Set it to your own before
  pushing so the history is attributed correctly.
