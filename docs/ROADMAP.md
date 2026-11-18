# Roadmap

## 0.1.0 — first working notepad (done)

- [x] Folder of `.md` files as the workspace, tree sidebar
- [x] Tabs with independent undo history and autosave
- [x] Markdown syntax highlighting and live GFM preview with sync scrolling
- [x] Find & replace in a note, search across the workspace
- [x] Create, rename, delete notes and folders; context menus
- [x] Light / dark / follow-Windows themes; editor, split and preview modes
- [x] Command palette, keyboard shortcuts, Russian UI
- [x] Export to standalone HTML, print-to-PDF
- [x] Three storage backends: Tauri, browser File System Access, in-memory demo
- [x] Tauri 2 shell with native file commands, app icons, CI build

## 0.2.0 — writing comfort (done)

- [x] Outline panel: every heading of the current note, click to jump, active section
  follows the caret
- [x] Paste or drop an image: saved to `assets/` next to the note, markdown inserted
  on its own line, relative images rendered in the preview
- [x] Drag `.md` / `.txt` files into the window to import and open them
- [x] Settings screen (`Ctrl+,`): theme, five accent colours, editor font family and
  size, preview font family and size, autosave delay, line numbers, sync scrolling
- [x] Autosave delay is a setting instead of a constant
- [x] Binary storage on all three backends (base64 over Tauri IPC)

## 0.2.1 — 0.2.2 (done)

- [x] Refuse to create notes without a connected folder
- [x] `Ctrl+N` creates a note immediately under an automatic name; no name dialog
- [x] «Закрыть папку»: save, detach the workspace, forget the remembered folder,
      reset the demo workspace
- [x] CI guard against UTF-8 BOM in `package.json`, `tauri.conf.json`, `Cargo.toml`
- [x] `scripts/bump-version.cjs` so the three version fields cannot drift

## 0.3.0 — draft notes (done)

- [x] `Ctrl+N` creates an untitled note without a folder; content persists in
      localStorage and comes back after a restart
- [x] «Сохранить в папку…» turns a draft into a real `.md` file; `F2` renames it
- [x] Closing the window asks what to do with drafts: save into a folder, keep
      them as drafts, or delete them (Rust-side close interception)
- [x] Drafts appear in tabs, workspace search and restore with their titles
- [x] Closing a folder keeps drafts open

## 0.3.1 — installer and polish (done)

- [x] Verify the produced installer by running the released binary on Windows and
      attach installers to a release (done since v0.2.0, re-verified every release)
- [x] Remember window size and position between launches
      (`tauri-plugin-window-state`)
- [x] «Recent folders» in the command palette (native builds; graceful message in
      a browser)
- [x] First-run onboarding: one dialog, «Начать с черновика» or «Открыть папку»
- [x] Configurable tab width (2/4/8) and an optional Vim keymap, loaded on demand
- [ ] Code-sign the exe and installer — CI plumbing is in place (optional
      `WINDOWS_CERTIFICATE` secret), blocked on buying a certificate

## 0.3.2 — ship signed installers

- [ ] Verify `tauri build` on a clean Windows machine and attach the installer to a release
- [ ] Code-sign the exe and installer (avoids SmartScreen warnings)
- [ ] Remember window size and position between launches
- [ ] “Recent folders” list in the palette
- [ ] First-run onboarding: pick a folder in one step
- [ ] Configurable tab width and a Vim / Emacs keymap option

## 0.4.0 — larger libraries

- [ ] Lazy tree loading for folders with thousands of notes
- [ ] Incremental workspace search index (currently reads files on each query)
- [ ] Internal links `[[note]]` with autocomplete and backlinks
- [ ] Tags `#tag` and a tag filter
- [ ] Multi-select in the tree for bulk move/delete

## Later / ideas

- [ ] Quick capture window on a global hotkey
- [ ] Optional front-matter rendering (title, date, tags)
- [ ] Per-document export themes and a PDF stylesheet setting
- [ ] Split view of two notes side by side
- [ ] Optional encryption of the workspace (age / gpg)
- [ ] Mobile build (Tauri 2 targets) — the storage seam already allows it

## Explicitly out of scope

- Cloud accounts and a sync server
- A proprietary database format
- Plugin marketplace
- Editing non-text files
