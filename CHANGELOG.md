# Changelog

All notable changes to KOCPAD are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

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
