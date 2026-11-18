# Publishing KOCPAD on GitHub

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
- **windows**: `npm ci` → `npm run tauri:build` → uploads the NSIS installer, the
  MSI and the portable `kocpad.exe` as the `kocpad-windows` artifact
- **release**: on a `v*` tag the installers are attached to a GitHub Release

Give the Windows job 10–15 minutes the first time (Rust dependencies compile from
scratch). Later runs reuse the cargo cache.

## 4. Cut a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds the installers and publishes a release with generated notes.
Bump the version in three places before tagging:

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `version`

## Notes

- Code signing is not configured. Unsigned installers trigger a SmartScreen
  warning; adding an OV/EV certificate is on the roadmap.
- Committer identity is set locally in this checkout
  (`git config user.name`, `git config user.email`). Set it to your own before
  pushing so the history is attributed correctly.
