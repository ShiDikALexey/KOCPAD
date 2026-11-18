# Changelog

All notable changes to KOCPAD are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

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
- The README is now Russian, with an English mirror in `README.en.md`; both link to
  the CI build and to the release installers.

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
