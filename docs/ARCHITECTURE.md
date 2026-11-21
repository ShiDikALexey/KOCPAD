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
  mountRoot(path: string): Promise<boolean>;
  restoreRoot(): Promise<boolean>;
  closeRoot(): Promise<void>;
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
  push pending saves. Closing the window flushes writes, then closes silently:
  drafts stay in local storage and the tabs come back on the next launch. Only a
  write that failed asks for confirmation before quitting.
- **External edits.** A document remembers the `{mtimeMs, size}` stamp it was read
  from (`Storage.stat` → Tauri `fs_stat`). Before every write the stamp is compared;
  if another program changed the file, the write is skipped and `Store.onConflict`
  asks the user (reload / keep mine / save copy). Focus and `visibilitychange` run a
  cheap re-check: a clean note is reloaded and a toast is shown, a dirty one raises
  the conflict dialog. F5 re-reads the active note but never discards unsaved text.

## Editor

CodeMirror 6 with:

- `@codemirror/lang-markdown` for syntax, `history()` for undo, `EditorView.lineWrapping`
  for notepad-like soft wrap;
- `@codemirror/search` panels styled to match the app, bound to `Ctrl+F` / `Ctrl+H`;
- a single `HighlightStyle` whose colours are CSS variables — one style, both themes;
- per-document `EditorState` stored in a `Map<path, EditorState>`.

Editor font family and size are CSS variables (`--font-editor`,
`--editor-font-size`), so the settings screen changes them without touching the
editor instance. Tab width and keymap are CodeMirror compartments instead:
`EditorState.tabSize` + `indentUnit` for indentation, and the Vim extension from
`@replit/codemirror-vim`, which is imported dynamically — the 122 kB chunk is only
fetched when Vim mode is turned on. Changing either clears the cached states of
inactive tabs, because those were built with the old settings.

## Window and workspace memory

- `tauri-plugin-window-state` (Rust side) saves the window size, position and
  maximized flag and restores them on the next launch; no frontend code or ACL
  permission is involved.
- The last workspace root lives in `localStorage` (`kocpad.root`) and in
  `settings.lastRoot`; `settings.recentFolders` keeps the last eight native
  folders for the command palette. Recent folders reopen through
  `Storage.mountRoot()`, which only the native backend implements — a browser
  cannot reopen a folder from a path string.
- The very first launch shows a two-option onboarding dialog (draft or folder) and
  stores `onboarded: true` afterwards.

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

## Tags

`src/tags.ts` extracts inline tags from a document:

- a tag is `#` at the start of a line or after whitespace/an opening bracket, then
  letters, digits, `_`, `-` or `/` — so `#работа/проект` is one tag;
- fenced code blocks and inline code spans are removed before matching, so a
  `#fff` colour in a CSS snippet is not a tag;
- comparison is case-insensitive (`toLocaleLowerCase('ru')`), display uses the
  first spelling that was seen.

`Store.indexTags()` walks every stored draft and every workspace file through
`readCached()` and aggregates `{ tag, key, count, paths }`, sorted by count. There
is no persistent tag index: the panel rebuilds it when opened or when the tree
changes. That is fine for hundreds of notes; thousands would need an on-disk index
(on the roadmap).

## Bulk actions

`TreeView` keeps a `Set<path>` of selected notes (files only; folders are not
selectable). `Ctrl+Click` toggles, `Shift+Click` takes the range from the anchor in
the rendered row order, `Esc` clears. The action bar calls `Store.deleteMany()` /
`Store.moveMany()`:

- both refresh the tree once instead of once per file;
- `moveMany` skips a target that already exists and reports how many were moved and
  skipped, instead of overwriting;
- open tabs follow the moved files, because the store rewrites their paths;
- selections are pruned on every render if the note no longer exists.

The move target comes from `ui/pickers.ts`, a small folder chooser built from
`Store.listFolders()` (the workspace root plus every directory in the tree).

## Event topics and repaint discipline

`Store` emits topics, and the subscribers are deliberately split by cost:

- `docs` — the list of open documents changed (open, close, rename, save landed).
  Tabs, tree and editor state are rebuilt; this is rare.
- `active` — the active tab changed. Editor, preview, outline and the status bar
  sync.
- `dirty` — the text of the active document changed. Only the title, the preview
  (debounced), the status bar and per-panel refreshes react.
- `tree`, `root`, `settings`, `theme`, `mode`, `status` — structural changes.

Typing used to emit `docs`, which meant every keystroke rebuilt the whole tree and
the tab strip. On a 300-note workspace that is visible; the split now keeps typing
at text-render cost only, and `tests/app.spec.ts` fails if the tree ever starts
mutating per keystroke again. Panels that read the workspace (tags, backlinks) and
the outline listen to `dirty` through `debounce()` with 350–1500 ms so a pause, not
a keystroke, triggers the work.

## Focus mode

`Settings.focusMode` is a persisted boolean, applied as `body.focus-mode`. CSS hides
the sidebar, the splitter and the preview pane and constrains `.editor-host` to
760 px, so the editor keeps all its behaviour (markdown, Vim, find) in a narrow
column. `Ctrl+Shift+Z` toggles it, `Esc` leaves it, and the settings screen exposes
the same switch.


## Format bar and context menu

Two UI surfaces sit on top of the same editor primitives:

- **Block types.** `detectBlockType(line)` reads the leading markdown markers of the
  caret line (`#`, `-`, `1.`, `- [ ]`, `>`, fences, `---`). `setBlockType(type)`
  strips the existing marker from every line of the selection and writes the new
  one; `code` wraps the range in fences instead of prefixing lines, `hr` replaces
  the current line. `BLOCK_LABELS` / `BLOCK_TYPES` are shared by the format bar, the
  context menu and the palette, so the three never drift apart.
- **Format bar.** A row between the tabs and the panes: the block-type button shows
  the current block (updated from the editor's `onCursor` callback), the inline
  buttons reuse `formatBold/Italic/Strike/Code/Link`, and a «ПКМ — ещё» button opens
  the same menu as a right click, for mouse-only use. Focus mode hides the row.
- **Context menu.** A `contextmenu` handler on the editor host builds a `MenuItem[]`
  with `separator: true` entries: clipboard (only with a selection), inline
  formatting, nine block conversions, «Найти выделенное» (prefills the find panel
  through `setSearchQuery`) and «Убрать форматирование». Clipboard operations use
  `navigator.clipboard` and report a toast when the WebView denies access.
- **Layout note.** `.main` is a flex column (tabs → format bar → panes → status bar)
  on purpose: adding the bar to the previous three-row grid pushed the panes into the
  wrong row and the editor intercepted clicks on the bar. The e2e test «block-type
  bar shows the caret block and converts it» fails if the layout regresses.


## Wiki links

`src/wikilinks.ts` owns the syntax `[[Заметка]]` / `[[Заметка|текст]]`:

- extraction skips fenced code blocks and inline code spans, so a note explaining
  the syntax does not link itself;
- `Store.resolveLink()` tries, in order: a note title (file name without
  extension, case-insensitive), a path suffix (`Идеи/План на неделю`), then a draft
  title. Unresolved targets stay visible;
- the preview decorates links after rendering by walking text nodes outside
  `pre`/`code`/`a` and replacing `[[…]]` with anchors, so markdown parsing never
  mangles them;
- autocomplete is a CodeMirror `CompletionSource` triggered by `matchBefore(/\[\[…/)`
  that inserts the title plus the closing `]]`;
- `Store.indexLinks()` reads every note once per panel open to build backlinks;
  `LinksView` shows outgoing links from the active document and the notes that
  point back to it.


## Drafts

A note does not need a folder to exist. Drafts are stored as a separate list in
`kocpad.drafts` (localStorage) independently of the open tabs, so closing a tab or
the whole app never deletes one.

- `src/drafts.ts` owns the record: `{ id, title, content, updatedAt }[]`.
- `Store.openDraft(id)` materialises a draft as a tab with the synthetic
  `draft:<id>` path, so tabs, the editor, outline, search and export treat it like
  any other document.
- Autosave for a draft writes to localStorage instead of the storage backend; a
  draft never touches the disk. A failed localStorage write keeps the document
  dirty and surfaces an error — silent close refuses to pretend the text was saved.
- The sidebar button with a counter opens `src/ui/drafts.ts`: open, «В папку…»,
  delete (two-step inline confirmation). "Новый черновик" always creates a draft,
  even when a folder is connected.
- «Сохранить в папку…» writes the content into the chosen folder and rewrites the
  document in place: `path` becomes the real file and the draft record disappears.
- Session restore brings draft tabs back with their order; if there is no saved tab
  list, the most recent draft opens. Closing a folder keeps drafts open.

## Closing the window

A notepad should not quit silently with unsaved text, but the webview cannot block
the OS close by itself in a way that survives a broken frontend. The split:

1. The frontend calls `kocpad_ready` once it is interactive.
2. Rust's `on_window_event` sees `CloseRequested`, and only if that flag is set it
   calls `prevent_close()` and evaluates `window.__kocpadRequestClose()`.
3. The handler calls `store.saveAll()` (files through the atomic write, drafts into
   localStorage). If a write failed, a single confirmation offers to close anyway;
   otherwise the window closes with no questions. Drafts and the tab list are
   already persisted, so nothing is lost.
4. The final close goes through the `kocpad_close_window` command, which destroys
   the webview window. Custom commands need no extra ACL permissions. If the
   `eval` fails, Rust destroys the window anyway — the app is never left unclosable
   (the known edge case is a crashed webview that keeps `FRONTEND_READY` set).

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

## Search index and large folders

`Store` keeps `textCache: Map<path, string>` — the text of every note it has read.
Search, tags and backlinks go through `readCached()` instead of `storage.readText()`,
so the first query reads the workspace and later ones are in-memory. The cache is
kept honest by construction:

- `saveDoc` writes the snapshot into the cache after the disk write succeeds;
- rename and move relocate the cached entry, delete removes it (including children
  of a deleted folder);
- `refreshTree` prunes entries for files that disappeared;
- F5 / «Обновить» calls `clearTextCache()` so external edits are picked up.

The tree renders at most 150 rows per folder (`DIR_PAGE_SIZE`) and appends a
«Показать ещё» button; collapsing a folder resets its pagination. The name filter
is a flat list capped at 300 matches with an explicit hint.

## Front matter

`src/frontmatter.ts` splits a leading `---` block and parses a deliberately small
subset: `key: value`, `[a, b]` lists and comma lists. `renderMarkdown()` renders the
metadata as a `.frontmatter` card and parses only the body, so the delimiters never
reach the reader. `Store.indexTags()` merges front-matter tags with inline `#tags`;
other keys are displayed as-is instead of being dropped.

## Export themes

`ExportTheme` is a setting (`light` / `dark`). `buildExportHtml()` takes it and
appends a dark palette to the document stylesheet; `printDocument()` passes it
through so print/PDF output matches the chosen paper.

## Quick capture

`tauri-plugin-global-shortcut` registers `CommandOrControl+Alt+N` in Rust. On press
the handler shows, unminimizes and focuses the main window and evaluates
`window.__kocpadQuickCapture()`, which the frontend installs next to the close
handler. No ACL permission is involved: the hotkey lives entirely on the Rust side.


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
