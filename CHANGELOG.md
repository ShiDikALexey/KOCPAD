# Changelog

All notable changes to KOCPAD are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

> **On version numbers.** 0.x–1.x releases were daily checkpoints: 14 releases in
> three days, and `1.0.0` was called "stable" too early. See
> [docs/VERSIONING.md](docs/VERSIONING.md) for the honest maturity assessment and
> the rules used from now on. The history below is left as written.

## [1.5.1-a] — 2026-11-21

### Changed

- **Printing prints the note, not the application.** `Ctrl+P` prints the selected
  fragment when there is a selection and the whole note otherwise. Release builds
  also turn off WebView2's browser accelerator keys (Ctrl+P, Ctrl+F, F5, zoom,
  devtools) and its default context menu, so the app's own print, find and refresh
  handlers receive those keys instead of the browser printing the whole UI.


### Fixed

- **Drafts panel: «Перейти» on the already open draft did nothing visible.** The
  active draft row now shows «В редакторе» instead of a no-op button; navigating to
  another open draft closes the panel, activates the tab and focuses the editor.
- **The inline assistant reacted to clicks on the empty part of a line.** Only the
  tinted fragment itself opens the popover now; clicking beside it leaves the caret
  alone.
- **An inline tag at the start of a line was reported as a broken heading.**
  `#Ячейка 262:` is recognized as a tag and left alone; `##Heading` and headings
  with spaces after the first word still get the missing-space hint.
- **Keyboard shortcuts depended on the keyboard layout.** `Ctrl+B`, `Ctrl+I`,
  `Ctrl+K` and friends now use the physical key (`event.code`), so they work on a
  Russian layout where `event.key` is `и`/`ш`, and `Ctrl+Alt+0…3` accepts the
  physical digit even if the layout produces another character.
- **Synced scrolling stuttered on long notes.** Scroll sync is now throttled to one
  layout read and one write per animation frame, with programmatic scroll feedback
  ignored instead of forcing layout on every event.

## [1.5.1] — 2026-11-21

The first stable release since `1.4.0`. It collects the 1.5 beta line (data safety,
boundaries, export/keyboard/search) and the inline markup assistant that grew on the
`Experimental` branch.

### Added

- **Inline markup assistant.** Sixteen deterministic markdown checks (heading spaces,
  bare and unclosed links, list markers, code fences, inline code, wiki links, glued
  tags, blank lines, trailing and double spaces). Suspicious ranges get a subtle
  lavender background; a click opens an explanation with the fixed example and
  «Исправить / Игнорировать / Больше не предлагать». Fully local: no network, no model
  download, no telemetry.
- **Assistant learning panel** in settings: per-rule accepted/ignored counters,
  confidence that reorders suggestions, formatting habits inferred from the active
  note (links, list markers, quotes, headings), and «Сбросить обучение».
- **Crash-recovery journal.** Dirty notes are snapshotted about twice a second; after
  a kill or power loss the next launch offers the recovered text.
- **External-edit conflict detection.** Before writing, KOCPAD compares the file
  version and asks «перечитать / оставить моё / сохранить копию» instead of silently
  overwriting; clean notes reload automatically.
- **Internal 30-day trash.** Deletion is reversible, old entries are purged
  automatically.
- **Encoding and line-ending preservation.** UTF-8/BOM, UTF-16LE/BE and cp1251 files
  open and save in their original encoding; CRLF stays CRLF.
- **Export improvements.** HTML/PDF embed `assets/` images and style `[[links]]`.
- **Keyboard and link work.** Arrow/Home/End navigation in menus, `Del` in the tree,
  creating a note from an unresolved `[[link]]`, renaming rewrites links in other
  notes, workspace-search race guard.

### Changed

- File commands are scoped to the workspace (no `..`, symlinks or escapes).
- File I/O is async: a large folder no longer freezes the window.
- Single-instance: a second launch focuses the existing window.
- `Cargo.lock` is committed; the CSP is stricter.
- CI launches the packaged `.exe` as a native smoke test.

### Fixed

- Modal focus trap, small-text contrast, duplicate menu/selection edge cases, typing
  performance (the sidebar tree is not rebuilt on every keystroke).

## [1.5.0-beta.4] — 2026-11-21 (keyboard, links, search)

### Added

- **Menu keyboard navigation.** Arrow keys move between menu items, Home/End jump to
  the first/last one, Enter activates, Escape closes; the first item receives focus
  when a menu opens.
- **Unresolved `[[links]]` can be created.** Clicking a missing wiki link offers
  «Создать заметку?» and creates a note in the current folder (or opens the target
  if it already exists).
- **Renaming a note updates its `[[links]]`.** Every file and draft that references
  the old title is rewritten through the normal save pipeline, so encoding and line
  endings survive; labels (`[[Old|label]]`) and folder prefixes (`[[dir/Old]]`) are
  preserved.

### Fixed

- **Workspace search race.** A slower earlier query can no longer overwrite the
  results of a newer one (request-id guard).

### Tests

- 3 new e2e scenarios (46 total): menu arrow navigation, creating a note from a
  missing wiki link, renaming a note updates links in other notes.

## [1.5.0-beta.3] — 2026-11-21 (export, keyboard, native smoke)

Wave 3: the export became self-contained, the tree and dialogs got keyboard
attention, and CI now starts the real Windows binary. Plan: [docs/WAVE-3.md](docs/WAVE-3.md).

### Changed

- **HTML export embeds images.** Relative images from `assets/` are inlined as data
  URLs (a missing file becomes alt text), `[[links]]` are rendered as link-styled
  spans with a tooltip, and the absolute file path is no longer printed under the
  title. Print/PDF uses the same inlined document, so images appear there too.
- **Delete in the tree.** `Delete` removes the selected notes (with confirmation)
  and is ignored while the caret is in the editor or a text field.
- **Modal focus handling.** Tab is trapped inside an open dialog, the dialog gets
  focus when it opens, and the previous element is focused again after closing.
- **Contrast.** `--ink-faint` is darker in both themes; the "unsaved" status uses the
  accessible amber instead of the light accent colour.

### Added

- **Native smoke test in CI.** The Windows job launches the freshly built
  `kocpad.exe`, verifies that the process stays alive and opens a window, then
  stops it — the first automated check of the packaged app.

### Tests

- 3 new e2e scenarios (43 total): export embeds images and renders wiki links;
  Delete removes a selected note; a modal keeps keyboard focus inside itself.

## [1.5.0-beta.2] — 2026-11-21 (boundaries and reproducibility)

Wave 2: the native file layer is scoped to the workspace, fs commands no longer run
on the UI thread, and Rust dependencies are pinned. Plan: [docs/WAVE-2.md](docs/WAVE-2.md).

### Security

- **File-system sandbox.** `WorkspaceRoot` state + `fs_set_root`; every native file
  command rejects `..`, paths outside the canonical workspace root, symlinks and the
  root itself. Binary reads are capped at 25 MB. The export/«Save as» path uses a
  separate `fs_save_text` command because it comes from the native save dialog, not
  from a note.
- **CSP hardening:** `object-src`, `frame-src`, `base-uri` and `form-action` are now
  `'none'` in both the production and development policies.

### Changed

- **File commands run asynchronously**, so Tauri executes them off the UI thread; a
  large folder or a slow disk no longer freezes the window.
- **Single instance:** `tauri-plugin-single-instance` (registered first) shows and
  focuses the existing window instead of starting a second copy that would race on
  the same files.

### Build

- `src-tauri/Cargo.lock` is committed; CI regenerates it, uploads it as an artifact
  and fails when `Cargo.toml` changes without a matching lockfile. The version bump
  script updates the lockfile's package version too.

## [1.5.0-beta.1] — 2026-11-21 (data-safety wave)

Wave 1 of the "never loses a note" plan. Plan and acceptance criteria:
[docs/WAVE-1.md](docs/WAVE-1.md).

### Added

- **External-edit detection.** Every open file remembers the `{mtime, size}` stamp
  it was read from; `Storage.stat()` is implemented by all three backends (Tauri
  `fs_stat`, File System Access, demo). Before a write the stamp is compared: a file
  changed by another program aborts the write and asks what to do —
  **перечитать с диска / оставить моё / сохранить копию**. Window focus and
  `visibilitychange` trigger a cheap re-check; a clean note is reloaded silently,
  `F5` re-reads the active note, and autosave never repeats the same dialog.
- **Crash-recovery journal.** While a document has unsaved edits, a snapshot is
  written to the app profile every ~0.5 s (Rust `recovery_*` commands on the native
  build, localStorage in the browser fallback). After a kill or a power cut the next
  start offers «Восстановить / Открыть файл с диска / Удалить снапшот». A normal
  save or tab close removes the snapshot.
- **Encodings and line endings are preserved.** Files are read through the byte
  level: UTF-8 (with or without BOM), UTF-16LE/BE with a BOM, BOM-less UTF-16
  heuristics and cp1251 (old Russian Notepad). The detected encoding and EOL are
  shown in the status bar, «Кодировка: открыть как…» in the palette overrides a
  wrong guess, and saving writes the file back in its original encoding, BOM and
  line endings instead of silently converting it.
- **Internal trash with 30-day retention.** Deleting a note (or a bulk selection)
  moves it into `%APPDATA%\app.kocpad.desktop\trash\<id>\` with its original path;
  «⋯» → «Корзина…» or the palette lists the entries with the days left, restores
  them (to a free name if the original is occupied) or deletes them permanently.
  Expired entries (older than 30 days) and anything beyond 200 items are purged on
  startup. The browser/demo fallback keeps the content in localStorage.

### Tests

- 6 new e2e scenarios (40 total): conflict dialog, silent reload of a clean note,
  "keep mine", restore-from-crash, journal cleanup on save, cp1251+CRLF round trip,
  UTF-16LE with BOM, trash restore and 30-day purge.

## [1.4.1] — 2026-11-21 (beta branch)

Notepad-style exit, a real drafts list, and two interface fixes from the review.

### Added

- **Drafts panel.** The sidebar header has a button with a count badge; it opens a
  list of every stored draft — open in a tab or not. From the list a draft can be
  opened, saved into the workspace folder, or deleted (with confirmation).
- **Drafts are stored independently of tabs.** Closing a draft tab no longer deletes
  it; the note stays in the list. Search, tags, links and backlinks now include
  drafts that are not open.
- **Session restore covers drafts.** On launch the saved tab order comes back,
  including draft tabs; if there are no saved tabs, the most recent draft opens.

### Changed

- **Closing the window asks nothing.** File notes are already written by autosave,
  drafts stay in local storage, and the tabs return on the next launch. The exit
  dialog is gone; only a failed write asks for confirmation.
- Context menus are text again: the glyph/tile experiment is replaced by a compact
  two-column layout with clear labels («Жирный», «Заголовок 1», …) — one click, no
  guessing.
- Text selection uses the accent-tinted colour from the theme in every state,
  including when the editor is unfocused (it used to fall back to the system
  lavender).
- `docs/BETA.md` documents the `beta` branch workflow; CI builds it too.

### Fixed (found by the 2026-11-21 audit pass)

- **Images were broken in packaged builds.** The production CSP lacked `blob:`, so
  every pasted or relative image was blocked by the webview while dev/e2e looked
  fine. `img-src` now allows `blob:` and `https:`.
- **A failed draft save could look successful.** A full localStorage used to mark
  the draft clean anyway, so closing silently lost the text. The document now stays
  dirty and reports the error; closing asks before dropping unsaved text.
- **Switching folders could drop unsaved files.** `saveAll()` now reports failures
  and the folder switch aborts instead of replacing open documents.
- **A reopened note could show stale text.** The editor cache is content-aware and
  forgets the buffer when a tab is closed, renamed or deleted.
- **A note starting with `---` lost its body in the preview.** Only a block where
  every line is `key: value` is treated as front matter; a horizontal rule is not.
- **Deleting several notes could close tabs of notes that failed to delete**, losing
  their unsaved buffers.
- **Opening an external link no longer goes through `cmd.exe`** (a shell-quoting
  injection surface); the `open` crate uses `ShellExecuteW`, and only http(s)/mailto
  are allowed.
- **The quick-capture hotkey can no longer block startup**: a conflict with another
  app logs a warning instead of panicking.
- **Atomic writes use a unique temp file per write** (two notes with the same stem
  could collide), flush with `sync_all()`, and clean up after a failure.
- **Status bar no longer runs full-document word counts on every keystroke**; stats
  are debounced with the rest of the typing updates.
- **A second error toast** no longer appears for the same failure.
- Removed dead code left over from the old close flow and the previous drafts model
  (`saveAllDraftsAsFiles`, `hasDrafts`, `cachedNotes`, `clearStoredDrafts`,
  `wrapSelection`, `replaceExtension`, `EditorExtension`).

### CI and release gates

- Tag, `package.json`, `package-lock.json`, `Cargo.toml` and `tauri.conf.json` must
  agree (`scripts/check-versions.cjs`); a `-beta` tag requires a `-beta` version.
- Release notes now come from the `CHANGELOG.md` section for the tag
  (`scripts/changelog-notes.cjs`); a release without a section fails.
- Tags with a suffix are published as pre-releases, so `/releases/latest` (and the
  updater) keeps pointing at the last plain release.
- Signing secrets are scoped to the steps that need them; Authenticode signing now
  re-signs the installer afterwards, so the updater signature stays valid.
- `if-no-files-found: error` for installers, job timeouts, and a release check that
  refuses to publish updater metadata without a `.sig` when the key exists.

### Tests

- Four more e2e scenarios (31 total): the drafts panel lists stored drafts and keeps
  a draft after closing its tab; "Новый черновик" always creates a draft even with a
  folder open; the two-step delete works; a leading horizontal rule is not eaten as
  front matter; and the selection colour stays on the theme accent when the editor
  loses focus.

## [1.4.0] — 2026-11-20

Interface pass from a hands-on review: six defects fixed and the UI made less boxy.

### Fixed

- **Menus toggle.** Clicking the block-type button (or «⋯») while its menu is open
  now closes it instead of reopening. Menus also close on any click outside.
- **Modals close on the dimmed backdrop** — settings, dialogs, the folder picker,
  the command palette and workspace search all dismiss when the area around them is
  clicked, not just with Esc or «Готово».
- **Single newlines became one paragraph in the preview.** Rendering now treats a
  newline as a line break by default ("Как в Блокноте"); settings offer "Как в
  Markdown" for the old behaviour. Existing profiles are migrated once (schema 2).
- **Line numbers were off by default and invisible.** They are now on by default and
  drawn faintly (72% size, 62% opacity), with no gutter border.
- The «Проверить обновления…» item moved to the bottom of the «⋯» menu.

### Changed

- **Compact context menu with glyphs**: clipboard and inline formatting are a single
  icon row, block conversions a 3×3 tile grid with `#`/`·`/`1.`/`☑` marks — the menu
  shrank from ~600 px to ~330 px.
- **Softer surfaces**: larger radii, warm layered shadows, card-style settings
  sections, accent-coloured checkboxes, a close button in the settings header,
  calmer tab strip and slimmer format bar.
- 5 more e2e tests (27 total): menu toggle, backdrop close, soft line breaks,
  line numbers, and the update item position.

## [1.3.0] — 2026-11-20

Auto-updates are in, and the signing situation is documented honestly.

### Added

- **In-app updater** (Tauri updater plugin): «⋯» → «Проверить обновления…» and a
  palette command. The app reads the release `latest.json`, compares versions,
  verifies the signature against the public key in `tauri.conf.json`, downloads the
  installer and installs it in `passive` mode; problems are reported as toasts.
- `scripts/enable-updater.cjs` — CI flips `bundle.createUpdaterArtifacts` on only
  when `TAURI_SIGNING_PRIVATE_KEY` exists, so builds without the secret keep working.
- `scripts/make-latest-json.cjs` — the release job writes `latest.json` (version,
  installer URL, signature) next to the `.sig` file.
- An updater keypair was generated: the public key is committed, the private key
  lives outside the repository (setup steps in `docs/PUBLISHING.md`).
- e2e test for the update command (22 total).

### Changed

- `docs/PUBLISHING.md`: the signing note now matches the 2023–2026 rules — private
  keys must live on hardware or a cloud HSM, Azure Artifact Signing is available to
  organizations in the US/Canada/EU/UK and individuals in the US/Canada, Russian
  developers have the industry ОТУЦ, and a `.pfx` file is no longer issued.

## [1.2.0] — 2026-11-20

Formatting controls on top of the editor, Word-style.

### Added

- **Format bar** between the tabs and the panes: a block-type field that follows the
  caret («Текст», headings 1–3, bullet, ordered, task list, quote, code block,
  separator), inline buttons B / I / S / `</>` / ↗, and a «ПКМ — ещё» button that
  opens the same menu as a right click.
- **Context menu on right click** in the text: cut / copy / paste (selection only),
  inline formatting, block conversion, «Найти выделенное» (prefills the find panel)
  and «Убрать форматирование» (strips block and inline markers, keeps the words).
- **Block shortcuts**: `Ctrl+Alt+1/2/3` for headings, `Ctrl+Alt+0` back to text;
  the palette gained the same commands.
- `MenuItem.separator` for grouped context menus (thin divider between sections).

### Fixed

- The main column was a three-row grid, so the new format bar pushed the panes into
  the wrong row and the editor swallowed clicks on the bar. `.main` is now a flex
  column; the e2e test for the block-type bar guards the layout.

### Tests

- 5 more Playwright scenarios (21 total): block-type bar and `Ctrl+Alt` shortcuts,
  format-bar buttons, the right-click menu, and clearing markup.

## [1.1.0] — 2026-11-19

Performance pass, focus mode and keyboard formatting.

### Fixed

- **Typing rebuilt the sidebar.** Every keystroke emitted the `docs` topic, so the
  note tree, the tab strip and the status bar re-rendered per character. Text edits
  now emit a separate `dirty` topic; tree and tabs refresh through a debounce, and
  a CI regression test fails if the tree starts mutating on keystrokes again
  (measured before the fix: 25 keystrokes → 62 tree rebuilds, 124 tab rebuilds).
- **Recent notes lost freshly opened files.** `openNote` set the active path itself
  and never called `activate()`, so a newly opened note was not added to the
  recent list the palette uses.
- Sidebar «Обновить» re-read the tree without dropping the search cache; F5, the
  palette command and the button now share one `refreshWorkspace()` action.

### Added

- **Focus mode** (`Ctrl+Shift+Z`, `Esc` to leave, also in settings): hides the
  sidebar and the preview and centers a 760 px text column.
- **Keyboard formatting**: `Ctrl+B` bold, `Ctrl+I` italic, ``Ctrl+` `` inline code,
  `Ctrl+Shift+K` link; pressing again removes the markers. Also in the palette.
- **Recent notes in the command palette** (`Ctrl+K` → «Недавняя заметка: …»).
- **Reading time** in the status bar for notes of 60+ words.
- Focus mode screenshot, docs on event topics and repaint discipline.
- 5 more e2e tests (16 total), including the typing-performance guard.

## [1.0.0] — 2026-11-19

First stable release. Everything from the roadmap that does not need a purchased
certificate or a different platform is in.

### Added

- **Quick capture (Ctrl+Alt+N).** A global hotkey handled in Rust: KOCPAD comes to
  the front from any application and starts a new note.
- **Front matter.** A leading `---` block is parsed (`title`, `date`, `tags` and any
  other `key: value`) and rendered as a compact metadata card above the note;
  front-matter tags join the tags panel. The raw block disappears from the preview.
- **Export themes.** Settings → Экспорт: light or dark background for saved HTML and
  print/PDF output.
- **Search index.** Note text is cached in memory after the first read and reused by
  search, tags and links; writes, renames, deletes and F5 keep the cache honest.
- **Large folders.** The tree renders 150 rows per folder chunk with «Показать ещё»,
  and the name filter caps at 300 results with a hint to narrow it down.
- **Automated smoke tests.** Eleven Playwright tests cover workspace, editor,
  tags, links, front matter, settings, drafts and the reload path; CI runs them on
  every push.

### Fixed

- The sidebar «Обновить» button existed in the markup but was never wired; it now
  re-reads the tree and reports the note count.

## [0.4.1] — 2026-11-19

Wiki links: notes can now point at each other.

### Added

- `[[Заметка]]` and `[[Заметка|текст ссылки]]` are rendered as clickable links in
  the preview; clicking opens the target note. Unresolved targets are shown with a
  dashed underline instead of disappearing, and clicking one explains what is
  missing.
- Autocomplete after `[[`: the editor suggests note titles (with their folder) and
  inserts the closing brackets on accept.
- «Связи» sidebar tab: outgoing links of the active note plus backlinks — every
  note whose `[[…]]` resolves to it, clickable.
- Resolution is case-insensitive and accepts a title (`Шпаргалка по markdown`) or
  a workspace path (`Идеи/План на неделю`); drafts are linkable too.
- Code blocks and inline code are ignored by the link parser, so documentation
  about the syntax does not link itself.

## [0.4.0] — 2026-11-19

Tags and bulk actions: the first half of the "larger libraries" milestone.

### Added

- **Tags.** Inline `#тег` (letters, digits, `_`, `-`, `/`) are collected across
  notes and drafts; fenced code blocks and inline code spans are ignored, so
  `#fff` in a CSS example is not a tag. The sidebar gains a third tab «Теги» with
  every tag and its note count; clicking a tag lists the notes that use it.
- **Multi-select in the tree.** `Ctrl+Click` toggles a note, `Shift+Click` selects
  a range, `Esc` clears it. A selection bar offers «Переместить» (folder picker
  inside the workspace) and «Удалить» with one confirmation for the whole batch.
  Collisions and failures are reported instead of silently overwriting.
- Release assets now include `SHA256SUMS.txt`, generated by the release job.

### Changed

- Tag and file counts use Russian plural forms in toasts and tooltips.

## [0.3.2] — 2026-11-18

Localization pass: the editor's built-in panels were the last English UI left.

### Fixed

- Find & replace panel is Russian now: «Найти», «Заменить», «далее», «назад»,
  «все», «регистр», «рег. выр.», «слово», «заменить», «заменить все». Strings come
  from `EditorState.phrases`, so the CodeMirror panels stay consistent with the
  rest of the interface. «Перейти к строке», «текущее совпадение», «заменено
  совпадений» and the tooltips are translated too.
- The panel is tightened for the longer Russian labels: narrower inputs, smaller
  gaps, the close button pinned to the corner; it fits on one row in editor-only
  mode and on two compact rows in split mode.

## [0.3.1] — 2026-11-18

Installer and polish milestone from the roadmap.

### Added

- Window size and position are remembered between launches
  (`tauri-plugin-window-state`, Rust side only).
- «Recent folders» in the command palette: the last eight native folders can be
  reopened without the picker. Browsers get an explanatory message instead.
- First-run onboarding: a single dialog offering «Начать с черновика» or
  «Открыть папку заметок»; the choice is remembered.
- Settings → Редактор: tab width (2 / 4 / 8 spaces) and an optional Vim keymap.
  The Vim extension is loaded on demand, so it does not cost anything until it is
  turned on; the status bar shows `· Vim`.
- CI: optional code-signing step. Setting `WINDOWS_CERTIFICATE` and
  `WINDOWS_CERTIFICATE_PASSWORD` secrets signs the portable exe, the NSIS
  installer and the MSI with `signtool` and a DigiCert timestamp.

### Changed

- Switching folders keeps drafts open instead of closing every tab.

## [0.3.0] — 2026-11-18

Notepad semantics: a note no longer needs a folder to exist.

### Added

- **Drafts.** `Ctrl+N` creates an untitled note immediately, with no folder and no
  dialog. The text is persisted in `localStorage` on every autosave, so it comes
  back after a restart or a crash, and it is listed in workspace search.
- **Draft → file.** «Сохранить в папку…» (`Ctrl+S` on a draft, the «Ещё» menu or the
  command palette) writes the draft as a real `.md` file; `F2` renames a draft.
- **Closing asks.** Intercepting the window close in Rust, KOCPAD now asks what to
  do with drafts before quitting: save them into a folder, keep them as local
  drafts, or delete them. The window only closes after an explicit choice, and a
  stale or crashed webview can never trap the window.
- Drafts appear in tabs, restore with their titles, and are searched like files.

### Changed

- Creating a note without a workspace no longer opens the folder picker first.
- Closing a folder keeps drafts open: they are not tied to a folder.
- Image paste in a draft explains that the note has to become a file first.

## [0.2.2] — 2026-11-18

Feedback fixes: fewer interruptions, and a way out of a folder.

### Changed

- `Ctrl+N` creates a note immediately with an automatic name («Новая заметка»,
  «Новая заметка 2», …) and focuses the editor. The name dialog is gone; rename
  with `F2` when the title matters.
- With no folder connected, creating a note opens the folder picker first instead
  of failing.

### Added

- «Закрыть папку» — in the sidebar header, the «Ещё» menu and the command palette.
  It saves pending changes, detaches the workspace (notes stay on disk) and clears
  the remembered folder, so the next launch starts empty. In demo mode the same
  action resets the demo notes.

## [0.2.1] — 2026-11-18

First patch release, from smoke-testing the 0.2.0 binary on Windows.

### Fixed

- Creating a note or folder without a connected workspace is now refused with a
  clear message. Previously the write resolved a relative path against the process
  working directory, so the file could land next to the executable instead of in a
  folder the user chose.

### Changed

- README is Russian (`README.md`) with an English mirror (`README.en.md`); both
  link to the release installers and the CI build.

## [0.2.0] — 2026-11-18

Writing comfort: structure, images and settings.

### Added

- Outline panel in the sidebar (Заметки / Контур tabs): lists every heading of the
  active note, skips headings inside fenced code, highlights the section the caret
  is in, and jumps to a line on click.
- Image support: pasting an image or dropping an image file writes it to an
  `assets/` folder next to the note, inserts `![](assets/name.png)` on its own
  line, and renders relative images in the preview through blob URLs. Name
  collisions get a numeric suffix.
- Drag & drop for `.md` / `.txt` files: a dropped note is imported into the current
  folder and opened; a note with the same name is opened instead of overwritten.
- Settings screen (`Ctrl+,`): theme, five accent colours, editor font family and
  size, preview font family and size, autosave delay, line numbers, synchronized
  scrolling, and a reset button.
- Accent themes applied across the whole UI as CSS variables.
- Binary read/write on every storage backend: base64 over Tauri IPC, `ArrayBuffer`
  through the File System Access API, in-memory blobs for the demo workspace.

### Changed

- Autosave delay is a user setting (0.3 s / 0.7 s / 1.5 s) instead of a constant.
- Editor and preview typography moved to CSS variables, so font changes apply
  without reloading the editor.
- `assets/` folders that contain no notes are hidden from the notes tree.
- The Tauri window disables native drag & drop so the webview receives HTML5 file
  drops with the actual file contents.

### Fixed

- Inserted images no longer glue to the following line when the caret sits at the
  start or middle of a line.

## [0.1.0] — 2026-11-18

First working version: a markdown notepad that keeps notes as plain files.

### Added

- Workspace as a folder of `.md` / `.markdown` / `.mdown` / `.txt` files with a
  tree sidebar, name filter, and create / rename / delete for notes and folders.
- Tabs that keep each document's own undo history and caret position.
- CodeMirror 6 editor with markdown highlighting, soft wrap, markdown
  bold/italic shortcuts and adjustable font size.
- Live GFM preview (headings, tables, task lists, highlighted code, quotes,
  links) with synchronized scrolling and clickable task checkboxes.
- Autosave with a 700 ms debounce, explicit save, and flushes on tab switch,
  window blur, page hide and close.
- In-note find & replace and workspace-wide search with line snippets.
- Command palette over every action; full keyboard shortcut set.
- Light, dark and follow-Windows themes; editor / split / preview modes;
  draggable sidebar and split divider.
- Export to a standalone HTML file; print-to-PDF through the system dialog.
- Three storage backends behind one interface: native Tauri commands, the browser
  File System Access API, and an in-memory demo workspace (`?demo=1`).
- Tauri 2 desktop shell with nine file commands, app icons and a CI build for
  Windows installers.
- Documentation: architecture, keybindings, roadmap, contributing guide.
