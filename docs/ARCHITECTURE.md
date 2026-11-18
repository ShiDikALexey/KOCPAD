# Architecture

## The shape of the app

KOCPAD is two pieces:

1. **A frontend** — plain TypeScript, Vite, CodeMirror 6, `marked`, DOMPurify.
   No UI framework: the DOM surface is small enough that a framework would cost
   more than it saves, and a notepad must start instantly.
2. **A Tauri 2 shell** — a native Windows window that hosts the frontend in
   WebView2 and exposes a handful of Rust commands for real file access.

```text
┌──────────────────────────── frontend (src/) ─────────────────────────────┐
│  main.ts ── theme, layout, shortcuts, actions, autosave, preview sync     │
│     │                                                                    │
│     ├── ui/*            tree · tabs · status bar · dialogs · palette      │
│     ├── editor.ts       CodeMirror 6, one EditorState per open document   │
│     ├── markdown.ts     GFM → sanitized HTML, highlight, print/export     │
│     └── store.ts        settings · workspace tree · tabs · save queue     │
│            │                                                             │
│            └── storage/types.ts  ◀── the only seam to the host            │
│                 ├── tauri.ts     invoke() → src-tauri/src/fs_ops.rs       │
│                 ├── browser.ts   File System Access API + IndexedDB       │
│                 └── demo.ts      in-memory sample workspace               │
└──────────────────────────────────────────────────────────────────────────┘
```

## Storage seam

Every filesystem operation goes through `Storage` (`src/storage/types.ts`):

```ts
interface Storage {
  chooseRoot(): Promise<boolean>;
  restoreRoot(): Promise<boolean>;
  listTree(): Promise<NoteNode[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeBinary(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  createFile(path: string, text?: string): Promise<void>;
  createDir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  saveAs(name: string, content: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  reveal(path: string): Promise<void>;
}
```

`createStorage()` picks a backend once, at boot:

| Runtime | Backend | Root path style |
| --- | --- | --- |
| Tauri window | `TauriStorage` | absolute Windows path (`D:\Notes`) |
| Chromium (dev/preview) | `BrowserStorage` | slash path relative to the picked folder (`Идеи/План.md`) |
| Anything else, or `?demo=1` | `DemoStorage` | in-memory sample notes |

The rest of the app treats paths as opaque strings and only uses the helpers in
`src/path.ts`, which understand both separators.

**Why Rust commands instead of `tauri-plugin-fs`:** the plugin needs a configured
allow-list scope per directory, which is awkward for a user-picked folder at
runtime. Eleven small commands keep permissions simple and let the native side
decide which files are notes (`.md`, `.markdown`, `.mdown`, `.txt`).

Binary assets cross the Tauri IPC boundary as base64 (`fs_read_binary` /
`fs_write_binary`), because a JSON array of bytes is dramatically slower for a
few-megabyte image. The browser backend writes an `ArrayBuffer` straight into the
File System Access stream.

## Document lifecycle

```text
open → readText() → Doc { path, name, content, savedContent }
       ↓
   editor.open(path, content)   each path keeps its own EditorState,
                                so undo history and caret survive tab switches
       ↓
   keystroke → updateListener → store.updateContent(path, text)
       ↓                          emits 'docs' → preview re-render (90 ms debounce)
   autosave timer (700 ms) → store.saveDoc(path)
       ↓
   storage.writeText() → savedContent = snapshot → dirty cleared
```

Guarantees:

- **One write per path at a time.** `saveDoc` chains on the previous promise, so
  an autosave and a `Ctrl+S` cannot race.
- **Clean means written.** A document is only marked clean after the write for
  that exact snapshot resolved; edits made during the write keep it dirty.
- **Flush points.** Tab close, window blur, `visibilitychange` and `pagehide` all
  push pending saves. Closing the window with unsaved changes asks first.

## Editor

CodeMirror 6 with:

- `@codemirror/lang-markdown` for syntax, `history()` for undo, `EditorView.lineWrapping`
  for notepad-like soft wrap;
- `@codemirror/search` panels styled to match the app, bound to `Ctrl+F` / `Ctrl+H`;
- a single `HighlightStyle` whose colours are CSS variables — one style, both themes;
- per-document `EditorState` stored in a `Map<path, EditorState>`.

Editor font family and size are CSS variables (`--font-editor`,
`--editor-font-size`), so the settings screen changes them without touching the
editor instance.

## Outline

`parseHeadings()` walks the active document line by line, tracks fenced code
blocks (` ``` ` / `~~~`) so a `# comment` inside a snippet is not mistaken for a
section, and collects ATX headings with their line number. Inline markdown is
stripped for display. The outline highlights the last heading at or above the
caret, which gives a sense of position in long notes; clicking an entry dispatches
`editor.scrollToLine()`.

## Images

Pasted and dropped images go through `ImageStore` (`src/images.ts`):

1. bytes are written to `assets/` next to the note (name collisions get a numeric
   suffix, `screen.png` → `screen-1.png`);
2. `![](assets/screen.png)` is inserted on its own line at the caret;
3. when the preview renders, every relative `img[src]` is resolved against the
   note's folder, the bytes are read through the storage backend and turned into a
   blob URL. Remote schemes (`http`, `data`, `blob`) pass through untouched, and a
   missing file becomes a readable placeholder instead of a broken image icon.

Because resolution goes through `Storage.readBinary`, images work identically for
native files, a browser folder and the in-memory demo.

`assets/` folders that contain no notes are pruned from the notes tree so the
sidebar stays a list of notes.

## Dropped files

HTML5 drag & drop is enabled in the Tauri window (`dragDropEnabled: false`), which
hands the webview the actual `File` objects. Dropped markdown and text files are
imported into the active note's folder and opened; an existing note with the same
name is opened instead of overwritten. Dropped images follow the image pipeline
above.

## Drafts

A note does not need a folder to exist. Documents without a file are represented
by a `draft:<id>` path inside the same `Doc` list, so tabs, the editor, the
outline, search and export treat them exactly like files.

- `src/drafts.ts` owns the `kocpad.drafts` localStorage record:
  `{ id, title, content, updatedAt }[]`.
- The autosave path for a draft writes to localStorage instead of the storage
  backend; a draft is never a reason to touch the disk.
- «Сохранить в папку…» writes the content into the chosen folder and rewrites the
  document in place: `path` becomes the real file, the editor state is dropped by
  its old key, and the draft record disappears.
- Closing a folder keeps drafts open, because they are not attached to it.

## Closing the window

A notepad should not quit silently with unsaved drafts, but the webview cannot
block the OS close by itself in a way that survives a broken frontend. The split:

1. The frontend calls `kocpad_ready` once it is interactive.
2. Rust's `on_window_event` sees `CloseRequested`, and only if that flag is set it
   calls `prevent_close()` and evaluates `window.__kocpadRequestClose()`.
3. The handler saves pending file changes, then asks about drafts:
   «Сохранить в папку…» / «Оставить черновиками» / «Удалить и закрыть»
   (three-button `choiceDialog`; `Esc` cancels and keeps the window open).
4. The final close goes through the `kocpad_close_window` command, which destroys
   the webview window. Custom commands need no extra ACL permissions, and if the
   `eval` itself fails Rust destroys the window, so the app can never become
   unclosable.

File changes that failed to reach the disk take a separate, simpler confirmation.

## Preview and export

`renderMarkdown()` runs `marked` (GFM) and then DOMPurify with an explicit
allow-list. After insertion, `decoratePreview()` highlights code blocks
(`highlight.js`), marks external links, wraps tables and turns disabled task
checkboxes into clickable ones — clicking one rewrites the corresponding
`- [ ]` / `- [x]` in the source text.

Export reuses the same rendered HTML inside a standalone document with its own
stylesheet (`buildExportHtml`). PDF output goes through the system print dialog
(`printDocument`), which works both in the desktop window and in a browser.

## UI state

`Store` is the only mutable state owner and emits topic events (`tree`, `docs`,
`active`, `mode`, `theme`, `settings`, `root`, `status`). Views subscribe and
re-render from state; there is no virtual DOM and no diffing. Settings live in
`localStorage` (`kocpad.settings`), the last workspace root in `kocpad.root`, and
open tabs in `kocpad.tabs`.

The settings screen writes through `store.patchSettings()`, so a control never
mutates the DOM directly: the change is persisted, a `settings` event fires, and
`applyLayout()` / `applyTypography()` / `applySidebarTab()` re-apply tokens and
layout from state.

## Theming

Two themes, tokens only (`src/style.css`): a graphite “paper” chrome with one
accent. The accent is chosen from five presets (`marker`, `azure`, `jade`, `iris`,
`rose`) which override `--accent`, selection and quote-bar variables per theme.
Editor, preview and every dialog read the same CSS variables, so adding a theme
means adding one token block. `system` follows `prefers-color-scheme` and reacts to
runtime changes.

## Security notes

- Markdown is sanitized; raw HTML scripts, `iframe`, inline event handlers and
  `style` attributes are stripped.
- External links are opened through the OS after a scheme check (`http`, `https`,
  `mailto` only).
- The Tauri CSP forbids remote script and frame sources; the frontend loads no
  network resources at runtime.

## Deliberate non-goals (for now)

- No plugin system, no sync server, no cloud account.
- No custom file format: if KOCPAD disappears, the notes are still just markdown.
- No editing binary files.
