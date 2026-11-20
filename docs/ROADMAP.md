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

## 0.3.2 — localization pass (done)

- [x] Russian strings for the CodeMirror find & replace panel and editor tooltips
      (`EditorState.phrases`)
- [x] Panel layout tightened for the longer labels (one row in editor mode)

## 0.3.3 — signed installers

- [ ] Buy or obtain an OV/EV code-signing certificate and add the two CI secrets
- [ ] Verify the release on a clean Windows machine (fresh profile, no WebView2
      cache) and document the first launch
- [x] Attach a checksum file (`SHA256SUMS`) to the release assets — done in the CI
      release job since v0.4.0

## 0.4.0 — tags and bulk actions (done)

- [x] Tags `#tag`: sidebar panel with counts and per-tag note lists; code blocks
      and inline code are ignored
- [x] Multi-select in the tree (`Ctrl+Click`, `Shift+Click`) with bulk move to a
      folder and bulk delete

## 0.4.1 — wiki links (done)

- [x] Internal links `[[note]]` with autocomplete and a backlinks panel
      (outgoing links, reverse links, click navigation)

## 0.4.2 — scale (folded into 1.0.0)

- [x] Incremental workspace search index: note text is cached after the first read
      and invalidated on write, rename, delete and F5
- [x] Lazy tree loading: 150 rows per folder chunk with «Показать ещё», filter
      capped at 300 results

## 1.0.0 — stable (done)

- [x] Quick capture on the global hotkey `Ctrl+Alt+N` (Rust global-shortcut)
- [x] Front matter card (`title`, `date`, `tags`, arbitrary keys)
- [x] Export theme setting for HTML and print/PDF
- [x] Playwright smoke tests in CI (11 scenarios)
- [x] Sidebar refresh button actually works
- [ ] Code-sign the installer — still blocked on an OV/EV certificate; CI step ready
- [ ] Verify the released installer on a clean Windows machine

## 1.1.0 — performance and focus (done)

- [x] Split text edits into a `dirty` topic: typing no longer rebuilds the tree or
      the tab strip (regression test in CI)
- [x] Focus mode (`Ctrl+Shift+Z`): one narrow column, no panels
- [x] Keyboard formatting: `Ctrl+B`, `Ctrl+I`, ``Ctrl+` ``, `Ctrl+Shift+K`
- [x] Recent notes in the command palette
- [x] Reading time in the status bar
- [x] 16 e2e tests, including the typing-performance guard

## 1.2.0 — formatting controls (done)

- [x] Format bar: block-type field that follows the caret plus inline buttons
- [x] Block conversion for text, headings 1–3, lists, task list, quote, code, hr
- [x] Context menu on right click (clipboard, formatting, blocks, find selection,
      strip markup)
- [x] `Ctrl+Alt+0…3` block shortcuts and palette commands
- [x] Main-column layout fix and 5 more e2e tests (21 total)

## 1.3.0 — auto-updates (done)

- [x] Updater plugin wired: menu and palette command, signature verification,
      passive install
- [x] Keypair generated; public key committed, private key kept out of the repo
- [x] CI: updater artifacts enabled when the signing secret exists, `latest.json`
      generated for the release
- [x] Documentation: how to enable updates, and the honest state of Windows signing

## 1.4.0 — interface pass (done)

- [x] Menus toggle on the second click and close on outside clicks
- [x] All modals dismiss on a backdrop click
- [x] Notepad-style line breaks by default, markdown-style as a setting
- [x] Faint line numbers on by default
- [x] Compact context menu: icon toolbar plus a block tile grid
- [x] Softer visual language: radii, shadows, cards in settings, accent checkboxes
- [x] 5 more e2e tests (27 total)

## 1.4.1 — notepad exit and drafts (beta)

- [x] Closing the window keeps drafts and restores tabs on the next launch
- [x] Drafts live in their own list: a sidebar button with a counter opens the panel
- [x] Draft tab can be closed without losing the draft; search/tags/links see all drafts
- [x] Context menus back to clear text labels in a compact two-column layout
- [x] Selection colour follows the theme even when the editor is unfocused
- [x] `beta` branch + CI builds it; `docs/BETA.md` describes the workflow

## After 1.0 (backlog)

- [ ] Two notes side by side
- [ ] Optional workspace encryption
- [ ] Mobile build (Tauri 2 targets) — the storage seam already allows it
- [ ] Sync server or cloud accounts are explicitly out of scope

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
