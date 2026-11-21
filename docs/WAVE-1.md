# Wave 1 — data safety (`1.5.0-beta.1`)

The promise "a notepad that never loses a note" is not true yet. This wave closes the
four gaps that break it, in the order of how much data they can destroy. Everything
lands on `beta`; `main` stays on the last release until the owner asks to merge.

## Decisions (agreed with the owner)

| Question | Decision |
|---|---|
| External edit conflict | Detect and ask: **reload from disk / keep mine / save a copy** |
| Deletion | **Internal KOCPAD trash** (`%APPDATA%\app.kocpad.desktop\trash\`), restore on demand, auto-purge after **30 days** |
| Encodings | Auto-detect + manual "Open as…", **save back in the original encoding**, preserve CRLF/LF |
| Version | `1.5.0-beta.1` when the wave is done; `1.5.0` only after a week of real use |

## Non-goals for this wave

- Recycle Bin integration (the internal trash covers restore and expiry; the OS bin
  would not survive profile resets anyway).
- Sync/cloud conflict merging (no cloud, no accounts).
- Two KOCPAD instances writing the same folder — that is wave 2 (single-instance);
  this wave only detects changes made by *other* programs.

## Task 1 — external edits are detected, not overwritten

**Problem.** KOCPAD reads a file once and then writes a full snapshot. Anything
changed meanwhile (Notepad, VS Code, OneDrive, Yandex.Disk) is silently replaced.

**Design.**

- `Storage.stat(path) → { mtimeMs, size } | null` in all three backends
  (Tauri command `fs_stat`, File System Access `getFile()`, demo in-memory clock).
- A document remembers the stamp it was read from (`Doc.disk`). After every
  successful write the stamp is refreshed.
- Before a write: compare the current stamp with `Doc.disk`. Different → do **not**
  write; mark the document as conflicted and notify the UI once (no autosave spam).
- On window focus / `visibilitychange` → check open files. If the file changed and
  the document is clean, reload it and show a quiet toast; if it is dirty, show the
  conflict dialog (the user may still be typing, so no automatic overwrite).
- `F5` reloads the active tab from disk (not just the tree), so the manual escape
  hatch keeps working.
- Conflict dialog choices:
  - **Перечитать с диска** — drop local edits (explicit choice), take disk text.
  - **Оставить моё** — write local text, refresh stamp.
  - **Сохранить копию** — write local text to
    `<name> (конфликт YYYY-MM-DD HH-mm).md` next to the original, then reload the
    original from disk so no version is lost.

**Acceptance.**
1. e2e: external `writeText` → local edit → `Ctrl+S` → dialog appears; each of the
   three choices ends in the expected state (disk text, my text, both files).
2. e2e: clean document, external edit, window focus → reloaded + toast.
3. Manual: OneDrive/Notepad changes a note between autosaves; nothing is lost.
4. No dialog storm: one dialog per conflict, autosave does not repeat it.

## Task 2 — crash recovery journal

**Problem.** Autosave is delayed (up to 1.5 s in settings). A kill/BSOD loses the
last keystrokes; there is no recovery path.

**Design.**

- While a document is dirty, write a snapshot to the app profile every ~1 s:
  `recovery/<hash-of-path>.json` = `{ path, text, savedAt, baseStamp }`.
  Skipped when the document is clean; removed after a successful save/close.
- On startup: scan the recovery folder; if `savedAt` is newer than the file's
  `mtime` (or the file is missing), offer **«Восстановить» / «Открыть файл» /
  «Удалить»**. Recovery does not overwrite the file until the user saves.
- Crash writing the journal itself must never block editing (best effort, bounded
  size, one file per open dirty doc).

**Acceptance.**
1. e2e: write a recovery snapshot, reload the page, the dialog appears and restores.
2. Manual (this machine): type, `taskkill /F`, relaunch → text is there.
3. Journal files disappear after a normal save/close; no growth over a session.
4. A recovered draft/file is dirty, never silently written to disk.

## Task 3 — encodings: open old files, save them back unchanged

**Problem.** Only UTF-8 is read: a cp1251 `.txt` from old Notepad breaks, UTF-16
files do not open, and every save rewrites CRLF as LF and drops the BOM. That is a
silent corruption of files the user did not ask to convert.

**Design.**

- `src/encoding.ts`:
  - detect: BOM (UTF-8/UTF-16LE/BE), strict UTF-8 validity, else cp1251 fallback;
    keep the result in the document (`Doc.encoding`), default UTF-8.
  - decode with `TextDecoder` for UTF-16, a small cp1251 table for legacy text, and
    strip the BOM before editing.
  - encode back with the same encoding (cp1251 table), restore the BOM if it was
    there.
  - EOL: detect dominant `\r\n` vs `\n`, normalise to `\n` in the editor, restore the
    original EOL on write (mixed files keep their dominant style).
- "Открыть как…" in the note context menu / palette: re-read the active file as
  UTF-8 / cp1251 / UTF-16LE (the only case where the user overrides detection).
- Settings: a per-note read-only hint in the status bar (`cp1251`, `UTF-16`, `CRLF`).

**Acceptance.**
1. Unit/e2e fixtures: cp1251, UTF-16LE with BOM, UTF-8 with BOM, CRLF file —
   open correctly, edit, save, bytes keep encoding/BOM/EOL.
2. Bytes before/after an untouched round-trip are identical except the edit.
3. "Open as…" fixes a deliberately wrong detection.
4. Binary read/write paths are untouched (images are separate).

## Task 4 — internal trash with 30-day restore

**Problem.** Delete is `fs::remove_file` — permanent. A misclick in the tree or a
bulk delete loses text (and there is no version history).

**Design.**

- Rust commands: `trash_put(path)` (move the file into the app data trash, keep
  metadata: original path, name, deletedAt, size), `trash_list()`,
  `trash_restore(id)` (refuse if the original path is occupied; suggest a variant
  name), `trash_purge()` (delete entries older than 30 days), `trash_delete(id)`.
- Layout: `%APPDATA%\app.kocpad.desktop\trash\<id>\` with `payload` + `meta.json`;
  works for files and folders (folders go as a directory tree).
- Purge runs on startup and after each delete; the trash is capped (e.g. 200 items).
- UI: «⋯» → «Корзина…» opens a panel (same style as drafts): restore, delete
  forever, "Очистить"; each row shows the original path and the days left.
- Deleting from the tree and bulk delete go through the trash; the toast says
  «В корзине KOCPAD» instead of «Удалено».
- Browser/demo fallback: an in-memory/localStorage trash so the UI works in tests.

**Acceptance.**
1. e2e: delete a note → it disappears from the tree and appears in the trash panel;
   restore returns it with the same path and content.
2. Restoring into an occupied name asks for a new name instead of overwriting.
3. Entries older than 30 days are purged on startup (fixture with an old timestamp).
4. Bulk delete of 10 notes produces 10 trash entries and one toast.
5. Nothing is written outside the app profile and the workspace.

## Order and commits

1. `feat: expose file stamps through the storage seam` (backend + Rust `fs_stat`).
2. `feat: detect external edits and offer a conflict dialog` (store + UI + tests).
3. `feat: keep a recovery journal for dirty buffers` (Rust/journal + startup UI).
4. `feat: read and preserve legacy encodings and line endings` (encoding module +
   "Open as…" + fixtures).
5. `feat: move deletions to an internal 30-day trash` (Rust + UI + tests).
6. `release: 1.5.0-beta.1` with CHANGELOG, docs, screenshots; beta tag as a
   pre-release.

Each commit keeps the suite green (typecheck, build, e2e) and updates
`docs/ARCHITECTURE.md` for the behaviour it changes. Manual checks that need the
owner's machine are marked in the PR/commit description.

## Risks

| Risk | Mitigation |
|---|---|
| `stat` on OneDrive placeholder files may be slow or cloud-only | best effort, timeouts, never block typing; treat a failed stat as "unknown" and keep the old behaviour |
| Recovery journal + antivirus/power loss | journal is written atomically (temp + rename), never read-modify-write in place |
| Encoding detection guesses wrong | manual "Open as…" always available; the detected encoding is shown in the status bar |
| Trash on a network/OneDrive drive | the trash lives in the app profile (local disk), not next to the notes |
| Two KOCPAD instances | out of scope here; wave 2 adds single-instance |
| Trash growth | purge >30 days + 200-item cap + explicit "empty trash" |

## Progress

| Task | Status |
|---|---|
| 1. External-edit detection (stamps, dialog, focus check, F5) | **done** on `beta`, 3 e2e tests |
| 2. Crash recovery journal (snapshots, startup dialog, cleanup) | **done** on `beta`, 2 e2e tests |
| 3. Encodings and line endings (detect, "Open as…", preserve on save) | **done** on `beta`, 2 e2e tests |
| 4. Internal 30-day trash (Rust commands, panel, purge) | **done** on `beta`, 2 e2e tests |
| 5. `1.5.0-beta.1` release | **done**: version bumped, CHANGELOG written, docs updated |
