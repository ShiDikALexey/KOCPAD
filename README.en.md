<div align="center">
  <img src="docs/icon.png" alt="KOCPAD icon" width="80" height="80">
  <h1>KOCPAD · beta</h1>
  <p><b>The next-version branch — only what changed and what is being tested.</b></p>

  [![build](https://github.com/ShiDikALexey/KOCPAD/actions/workflows/build.yml/badge.svg?branch=beta)](https://github.com/ShiDikALexey/KOCPAD/actions/workflows/build.yml)
  [![beta](https://img.shields.io/badge/beta-1.5.0--beta.4-orange)](https://github.com/ShiDikALexey/KOCPAD/tree/beta)
  [![stable release](https://img.shields.io/github/v/release/ShiDikALexey/KOCPAD?label=stable)](https://github.com/ShiDikALexey/KOCPAD/releases/latest)

  <sub><a href="README.md">Русский</a> · English · <a href="https://github.com/ShiDikALexey/KOCPAD/blob/main/README.en.md">full description (main)</a></sub>
</div>

---

This is the **`beta`** branch, version **`1.5.0-beta.4`**. The full product
description, screenshots and FAQ live in the
[stable README](https://github.com/ShiDikALexey/KOCPAD/blob/main/README.en.md); this
file only covers what changed since `1.4.0` and what is being verified.

## What changed since 1.4.0

**No lost data**
- external edits are detected before writing: conflict dialog «reload / keep mine /
  save a copy»; clean notes are reloaded automatically;
- a crash-recovery journal snapshots dirty files every ~0.5 s and offers restoration
  after a kill;
- encodings and line endings are preserved (UTF-8/BOM, UTF-16LE/BE, cp1251; CRLF);
- an internal 30-day trash makes deletion reversible and purges old entries.

**Boundaries and reproducibility**
- file commands are scoped to the workspace (no `..`, symlinks or escapes);
- file operations are async, so a large folder no longer freezes the window;
- single-instance: a second launch focuses the existing window;
- `Cargo.lock` is committed and the CSP is hardened.

**Export and interface**
- HTML/PDF embed `assets/` images and style `[[links]]`;
- `Del` in the tree, modal focus trap, better small-text contrast;
- menu arrow navigation, create a note from a missing `[[link]]`, renaming rewrites
  links, workspace-search race guard;
- CI now runs a smoke launch of the built `.exe`.

## What is being tested

Manual checklist before merging into `main`:

- [ ] edit a note, change the file in Notepad, return to KOCPAD → conflict dialog;
- [ ] type and kill the process (`taskkill /F /IM kocpad.exe`) → restored text on
      the next launch;
- [ ] an old cp1251 `.txt` and a CRLF file open, edit and save in their encoding;
- [ ] delete a note → «⋯» → «Корзина…» → restore;
- [ ] launch the app twice → one window remains;
- [ ] export HTML with an image and a `[[link]]`; print to PDF without a file path;
- [ ] keyboard menus, note creation from a missing link, rename rewrites links.

Automated: **46 e2e scenarios** (Chromium) plus a native smoke in the Windows CI job.
A full native e2e against the `.exe` is blocked by the GitHub runner environment
(elevated process and WebView2) — see [ROADMAP](docs/ROADMAP.md).

## Getting a beta build

CI builds the **`kocpad-windows`** artifact on every push to `beta`: the portable
`kocpad.exe` and the NSIS installer. MSI is intentionally skipped for prerelease
versions (WiX rejects a non-numeric prerelease).

No tags and releases are cut from this branch — only after the checklist and a merge
into `main`.

## What comes next

1. Pass the checklist above and merge `beta` into `main` → release `1.5.0`.
2. A separate [`Experimental`](https://github.com/ShiDikALexey/KOCPAD/blob/Experimental/README.en.md)
   branch holds the inline markup assistant; it is not part of beta.
3. Known limitations and plans — [ROADMAP](docs/ROADMAP.md); honest version policy —
   [VERSIONING](docs/VERSIONING.md).
