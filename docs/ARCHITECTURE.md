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
runtime. Nine small commands keep permissions simple and let the native side
decide which files are notes (`.md`, `.markdown`, `.mdown`, `.txt`).

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

## Theming

Two themes, tokens only (`src/style.css`): a graphite “paper” chrome with one
marker-yellow accent. The editor, the preview and every dialog read the same CSS
variables, so adding a theme means adding one token block. `system` follows
`prefers-color-scheme` and reacts to runtime changes.

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
