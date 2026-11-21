# Wave 3 — export, keyboard, native smoke (`1.5.0-beta.3`)

Wave 3 closes the most visible product gaps and adds the first check that runs the
real Windows binary.

## Tasks

### 1. Export and print (done)

- [x] Relative images from `assets/` are embedded into the exported HTML as data
      URLs; a missing image becomes an alt text instead of a broken icon.
- [x] `[[target]]` / `[[target|label]]` are rendered as link-styled spans with a
      `Заметка: target` tooltip (inside code blocks they stay literal text).
- [x] Export and print share one document builder, so PDF gets the inlined images
      too.
- [x] The absolute file path is no longer printed under the title; the document
      title is the only header.
- [x] e2e: the exported HTML contains `data:image/png;base64,…` and
      `class="wikilink"`, and no `assets/…` path or raw `[[…]]` syntax.

### 2. Keyboard and accessibility (done)

- [x] `Delete` in the tree removes the selected notes (with the confirmation dialog)
      and never fires while the caret is in the editor or an input.
- [x] Modals trap Tab inside themselves, focus the dialog container on open and
      restore the previous focus on close.
- [x] Contrast: `--ink-faint` darkened in both themes; the "unsaved" status uses a
      darker amber instead of the light accent colour.
- [x] e2e: Delete removes a selected note; Tab keeps focus inside an open modal.
- [ ] Menu arrow-key navigation (menus are click/Tab accessible today) — deferred;
      the context menu is reachable with the keyboard and Escape closes it.

### 3. Native smoke test (done)

- [x] The Windows CI job starts the freshly built `kocpad.exe`, waits, asserts the
      process is alive and has a window title, then stops it. This is the first
      automated check of the packaged app rather than the Vite dev page.
- [ ] Full native e2e (tauri-driver + WebDriver, open folder → edit → kill →
      recover → update) — prepared in `tests/native/smoke.mjs` and a manual CI job,
      but blocked on GitHub-hosted Windows runners (elevated process, WebView2
      ignores remote debugging; tauri-apps/wry#1782). Needs a non-elevated or
      self-hosted runner; tracked in ROADMAP.

### 4. Formatting entry points (decision pending)

Formatting exists in four places: hotkeys, the format bar, the right-click menu and
the palette. Keeping the bar helps newcomers; removing the palette duplicates would
trim the long menu. No code change yet — the owner should decide whether the bar
stays.

## Release

- Version `1.5.0-beta.3`, CHANGELOG section, README/RU+EN truthfulness pass,
  docs updated, CI green, beta artifact published as a pre-release-capable build.

## Progress

| Task | Status |
|---|---|
| 1. Export/print | **done**, 1 e2e |
| 2. Keyboard/a11y | **done** (menus deferred), 2 e2e |
| 3. Native smoke | **done** in CI |
| 4. Formatting entry points | waiting for a product decision |
