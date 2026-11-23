import type { Doc, NoteNode, SearchHit, Settings, ThemeMode, ViewMode } from './types';
import { DEFAULT_SETTINGS } from './types';
import type { Storage } from './storage';
import { journal, journalKeyFor, type JournalEntry } from './journal';
import { recordHistorySnapshot } from './history';
import { trash } from './trash';
import { decodeAs, decodeText, encodeText, type Eol, type TextEncoding } from './encoding';
import type { FileStat } from './storage/types';
import { basename, dirname, isInside, isTextFile, joinPath, normalizePath } from './path';
import { titleFromPath } from './util';
import { extractTags, tagKey, type TagSummary } from './tags';
import { extractWikiTargets, normalizeLinkTarget } from './wikilinks';
import { frontMatterTags, splitFrontMatter } from './frontmatter';
import {
  draftIdOf,
  draftPathOf,
  isDraftPath,
  loadDrafts,
  newDraftId,
  nextDraftTitle,
  persistDrafts,
  type StoredDraft,
} from './drafts';

export type Topic =
  | 'tree'
  | 'docs'
  | 'active'
  /** Text of an open document changed; cheap to emit, cheap to ignore. */
  | 'dirty'
  /** The stored drafts list changed (open, rename, delete, content). */
  | 'drafts'
  | 'mode'
  | 'theme'
  | 'settings'
  | 'root'
  | 'status';

type Handler = () => void;

const SETTINGS_KEY = 'kocpad.settings';

/**
 * Single source of truth for the app: settings, workspace tree, open tabs and
 * the autosave queue. The UI subscribes to topics and re-renders; nothing in
 * here touches the DOM.
 */
export interface BrokenLink {
  sourcePath: string;
  sourceName: string;
  target: string;
  line: number;
  column: number;
}

export class Store {
  readonly storage: Storage;
  settings: Settings;
  tree: NoteNode[] = [];
  docs: Doc[] = [];
  activePath: string | null = null;
  /** Transient text for the status bar (saved, errors, hints). */
  status: { text: string; kind: 'info' | 'error' } = { text: '', kind: 'info' };

  private listeners = new Map<Topic, Set<Handler>>();
  private saveTimers = new Map<string, number>();
  private writes = new Map<string, Promise<void>>();
  /** Cached file text, so search/tags/links do not re-read the workspace. */
  private textCache = new Map<string, string>();
  /** Encoding and line endings of every file that has been read this session. */
  private meta = new Map<string, { encoding: TextEncoding; bom: boolean; eol: Eol }>();
  /** Drafts kept between sessions independently of the open tabs. */
  private storedDrafts: StoredDraft[] = [];
  onError: (message: string) => void = () => undefined;
  /** Editor-state hook: forget the cached buffer for a closed document. */
  onDocClosed: (path: string) => void = () => undefined;
  /** Editor-state hook: the document moved, the old key must be dropped. */
  onDocRenamed: (from: string, to: string) => void = () => undefined;
  /** The text of a document changed programmatically (e.g. [[links]] renamed). */
  onDocContentSynced: (path: string) => void = () => undefined;
  /** The file changed on disk while the document had unsaved edits. */
  onConflict: (path: string) => void = () => undefined;
  /** A clean document was reloaded because the file changed on disk. */
  onExternalReload: (path: string) => void = () => undefined;
  /** Per-path stamps of externally changed files, waiting for a decision. */
  private conflicts = new Map<string, FileStat>();

  constructor(storage: Storage) {
    this.storage = storage;
    this.settings = loadSettings();
  }

  // ---------------------------------------------------------------- events

  on(topic: Topic, handler: Handler): () => void {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  private emit(...topics: Topic[]): void {
    for (const topic of topics) {
      this.listeners.get(topic)?.forEach((handler) => handler());
    }
  }

  setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
    this.status = { text, kind };
    this.emit('status');
  }

  // -------------------------------------------------------------- settings

  patchSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.emit('settings');
    if (patch.theme !== undefined) this.emit('theme');
    if (patch.mode !== undefined) this.emit('mode');
  }

  setTheme(theme: ThemeMode): void {
    this.patchSettings({ theme });
  }

  setMode(mode: ViewMode): void {
    this.patchSettings({ mode });
  }

  // ------------------------------------------------------------- workspace

  get rootName(): string {
    return this.storage.rootName;
  }

  async chooseRoot(): Promise<boolean> {
    const ok = await this.storage.chooseRoot();
    if (!ok) return false;
    this.patchSettings({ lastRoot: this.storage.root });
    if (this.storage.kind === 'tauri' && this.storage.root) this.addRecentFolder(this.storage.root);
    // Drafts are not tied to a folder and stay open across a switch.
    const drafts = this.docs.filter((doc) => isDraftPath(doc.path));
    this.docs = drafts;
    this.activePath = drafts[0]?.path ?? null;
    await this.refreshTree();
    this.emit('docs', 'active', 'root');
    return true;
  }

  /** Recent folders, newest first, capped at eight entries. */
  get recentFolders(): string[] {
    return this.settings.recentFolders;
  }

  addRecentFolder(path: string): void {
    if (!path) return;
    const list = [path, ...this.settings.recentFolders.filter((item) => item !== path)].slice(0, 8);
    this.patchSettings({ recentFolders: list });
  }

  /** Mounts a folder from the recent list without opening the picker. */
  async openWorkspaceByPath(path: string): Promise<boolean> {
    await this.saveAll();
    const ok = await this.storage.mountRoot(path);
    if (!ok) return false;
    this.patchSettings({ lastRoot: path });
    const drafts = this.docs.filter((doc) => isDraftPath(doc.path));
    this.docs = drafts;
    this.activePath = drafts[0]?.path ?? null;
    await this.refreshTree();
    this.addRecentFolder(path);
    this.emit('docs', 'active', 'root');
    return true;
  }

  async restoreRoot(): Promise<boolean> {
    const ok = await this.storage.restoreRoot();
    if (!ok) return false;
    await this.refreshTree();
    this.emit('root');
    return true;
  }

  async refreshTree(): Promise<void> {
    try {
      this.tree = pruneAssetFolders(await this.storage.listTree());
      // Drop cached text for notes that are gone; keep the rest for fast search.
      const available = new Set(this.flatFiles().map((file) => file.path));
      for (const path of [...this.textCache.keys()]) {
        if (!available.has(path)) this.textCache.delete(path);
      }
      this.emit('tree');
    } catch (error) {
      this.report(error, 'Не удалось прочитать папку');
    }
  }

  /** Reads a note through the cache; used by search, tags and links. */
  private async readCached(path: string): Promise<string> {
    const cached = this.textCache.get(path);
    if (cached !== undefined) return cached;
    // Read bytes, not `readText`: the file may be cp1251/UTF-16, and the encoding
    // must survive the round trip, otherwise saving silently converts the file.
    const bytes = await this.storage.readBinary(path);
    const decoded = decodeText(bytes);
    this.textCache.set(path, decoded.text);
    this.meta.set(path, { encoding: decoded.encoding, bom: decoded.bom, eol: decoded.eol });
    return decoded.text;
  }

  /** Encoding/EOL metadata of a document (null for drafts). */
  encodingInfo(path: string): { encoding: TextEncoding; bom: boolean; eol: Eol } | null {
    if (isDraftPath(path)) return null;
    const meta = this.meta.get(path);
    if (meta) return meta;
    const doc = this.docs.find((item) => item.path === path);
    if (doc?.encoding) return { encoding: doc.encoding, bom: doc.bom ?? false, eol: doc.eol ?? '\n' };
    return null;
  }

  /** "Open as…": re-reads the file with a forced encoding. */
  async reopenWithEncoding(path: string, encoding: TextEncoding): Promise<boolean> {
    const doc = this.docs.find((item) => item.path === path);
    if (!doc || isDraftPath(path)) return false;
    try {
      const bytes = await this.storage.readBinary(path);
      const decoded = decodeAs(bytes, encoding);
      doc.content = decoded.text;
      doc.savedContent = decoded.text;
      doc.encoding = decoded.encoding;
      doc.bom = decoded.bom;
      doc.eol = decoded.eol;
      doc.disk = await this.storage.stat(path).catch(() => null);
      this.textCache.set(path, decoded.text);
      this.meta.set(path, { encoding: decoded.encoding, bom: decoded.bom, eol: decoded.eol });
      this.conflicts.delete(path);
      this.forgetJournal(path);
      this.emit('docs', 'active');
      this.setStatus(`Открыто как ${encoding}`);
      return true;
    } catch (error) {
      this.report(error, `Не удалось перечитать ${doc.name} как ${encoding}`);
      return false;
    }
  }

  /** F5 / «Обновить»: forget cached text so external edits are picked up. */
  clearTextCache(): void {
    this.textCache.clear();
    this.meta.clear();
  }

  /** All openable files in the workspace, flattened. */
  flatFiles(): NoteNode[] {
    const out: NoteNode[] = [];
    const walk = (nodes: NoteNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'dir') walk(node.children ?? []);
        else out.push(node);
      }
    };
    walk(this.tree);
    return out;
  }

  findNode(path: string): NoteNode | null {
    let found: NoteNode | null = null;
    const walk = (nodes: NoteNode[]): void => {
      for (const node of nodes) {
        if (node.path === path) found = node;
        else if (node.kind === 'dir') walk(node.children ?? []);
      }
    };
    walk(this.tree);
    return found;
  }

  // ------------------------------------------------------------------ docs

  /** Notes with no file on disk. */
  get draftDocs(): Doc[] {
    return this.docs.filter((doc) => isDraftPath(doc.path));
  }

  /** All stored drafts, newest first — open or not. */
  get draftList(): StoredDraft[] {
    return [...this.storedDrafts].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get draftsCount(): number {
    return this.storedDrafts.length;
  }

  /** Loads the draft list saved in the previous session. Tabs reopen separately. */
  restoreDrafts(): void {
    this.storedDrafts = loadDrafts();
    if (this.storedDrafts.length) this.emit('drafts');
  }

  /** Opens a stored draft as a tab (or activates it when already open). */
  openDraft(id: string): Doc | null {
    const path = draftPathOf(id);
    const existing = this.docs.find((doc) => doc.path === path);
    if (existing) {
      this.activate(path);
      return existing;
    }
    const stored = this.storedDrafts.find((draft) => draft.id === id);
    if (!stored) return null;
    const doc: Doc = {
      path,
      name: stored.title,
      content: stored.content,
      savedContent: stored.content,
    };
    this.docs = [...this.docs, doc];
    this.activePath = path;
    this.rememberNote(path);
    this.emit('docs', 'active');
    return doc;
  }

  /** Creates an untitled note immediately — the notepad behaviour, no folder needed. */
  async createDraftDoc(): Promise<Doc> {
    const taken = [...this.docs.map((doc) => doc.name), ...this.draftList.map((draft) => draft.title)];
    const id = newDraftId();
    const doc: Doc = {
      path: draftPathOf(id),
      name: nextDraftTitle(taken),
      content: '',
      savedContent: '',
    };
    this.storedDrafts = [
      { id, title: doc.name, content: '', updatedAt: Date.now() },
      ...this.storedDrafts,
    ];
    this.docs = [...this.docs, doc];
    this.activePath = doc.path;
    this.persistDraftDocs();
    this.emit('docs', 'active');
    return doc;
  }

  /**
   * Writes open draft content into the stored list and persists it. Drafts that
   * are closed stay in the list, so a tab can be closed without losing the note.
   */
  private persistDraftDocs(): boolean {
    const byId = new Map(this.storedDrafts.map((draft) => [draft.id, draft]));
    for (const doc of this.draftDocs) {
      const id = draftIdOf(doc.path);
      byId.set(id, { id, title: doc.name, content: doc.content, updatedAt: Date.now() });
    }
    this.storedDrafts = [...byId.values()];
    const saved = persistDrafts(this.storedDrafts);
    this.emit('drafts');
    return saved;
  }

  renameDraft(path: string, rawTitle: string): boolean {
    const doc = this.docs.find((item) => item.path === path);
    const title = rawTitle.trim();
    if (!doc || !isDraftPath(path) || !title) return false;
    doc.name = title;
    this.persistDraftDocs();
    this.emit('docs', 'active');
    this.setStatus(`Переименовано · ${title}`);
    return true;
  }

  async deleteDraftDoc(path: string): Promise<void> {
    if (!isDraftPath(path)) return;
    const id = draftIdOf(path);
    this.storedDrafts = this.storedDrafts.filter((draft) => draft.id !== id);
    await this.closeDoc(path, true);
    persistDrafts(this.storedDrafts);
    this.emit('drafts');
    this.setStatus('Черновик удалён');
  }

  /** Turns a draft into a real file in `dir`. Returns the new path. */
  async saveDraftAsFile(draftPath: string, dir: string, rawName: string): Promise<string | null> {
    const doc = this.docs.find((item) => item.path === draftPath);
    if (!doc || !isDraftPath(draftPath)) return null;
    const name = ensureMarkdownName(rawName);
    if (!name) {
      this.onError('Имя файла не может быть пустым');
      return null;
    }
    const target = joinPath(dir, name);
    const snapshot = doc.content;
    try {
      if (await this.storage.exists(target)) {
        this.onError(`Файл «${name}» уже существует`);
        return null;
      }
      await this.storage.writeText(target, snapshot);
    } catch (error) {
      this.report(error, `Не удалось сохранить ${name}`);
      return null;
    }

    doc.path = target;
    doc.name = name;
    doc.savedContent = snapshot;
    this.textCache.set(target, snapshot);
    if (this.activePath === draftPath) this.activePath = target;
    this.storedDrafts = this.storedDrafts.filter((draft) => draft.id !== draftIdOf(draftPath));
    this.persistDraftDocs();
    await this.refreshTree();
    this.emit('docs', 'active');
    // Text typed while the write was in flight is still unsaved under the new name.
    if (doc.content !== snapshot) this.scheduleSave(target);
    this.setStatus(`Сохранено · ${name}`);
    return target;
  }

  /** Saves one draft into a folder under a free name; returns the new path. */
  async saveDraftToFolder(draftPath: string, dir: string): Promise<string | null> {
    let doc = this.docs.find((item) => item.path === draftPath) ?? null;
    if (!doc && isDraftPath(draftPath)) doc = this.openDraft(draftIdOf(draftPath));
    if (!doc) return null;
    const name = await this.uniqueDraftFileName(dir, doc.name);
    return this.saveDraftAsFile(doc.path, dir, name);
  }

  /** Restores the saved tab order after reopening a session. */
  reorderDocs(paths: string[]): void {
    const rank = new Map(paths.map((path, index) => [path, index]));
    this.docs = [...this.docs].sort(
      (a, b) => (rank.get(a.path) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.path) ?? Number.MAX_SAFE_INTEGER),
    );
    this.emit('docs');
  }

  private async uniqueDraftFileName(dir: string, title: string): Promise<string> {
    const base = title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Заметка';
    for (let index = 1; index < 1000; index += 1) {
      const name = index === 1 ? `${base}.md` : `${base} ${index}.md`;
      if (!(await this.storage.exists(joinPath(dir, name)))) return name;
    }
    return `${base} ${Date.now()}.md`;
  }

  get activeDoc(): Doc | null {
    if (!this.activePath) return null;
    return this.docs.find((doc) => doc.path === this.activePath) ?? null;
  }

  isDirty(doc: Doc): boolean {
    return doc.content !== doc.savedContent;
  }

  get dirtyCount(): number {
    return this.docs.filter((doc) => this.isDirty(doc)).length;
  }

  async openNote(path: string, options: { focus?: boolean } = {}): Promise<Doc | null> {
    const existing = this.docs.find((doc) => doc.path === path);
    if (existing) {
      this.activate(path);
      return existing;
    }
    if (!isTextFile(path)) {
      this.onError(`KOCPAD открывает только текстовые заметки (.md, .txt)`);
      return null;
    }
    try {
      const content = await this.readCached(path);
      const disk = await this.storage.stat(path).catch(() => null);
      const meta = this.meta.get(path);
      const doc: Doc = {
        path,
        name: basename(path),
        content,
        savedContent: content,
        disk,
        encoding: meta?.encoding,
        bom: meta?.bom,
        eol: meta?.eol,
      };
      this.docs = [...this.docs, doc];
      this.activePath = path;
      // A newly opened note is also a "recent note"; activate() would return
      // early here because activePath is already set.
      this.rememberNote(path);
      this.emit('docs', 'active');
      if (options.focus === false) this.emit('active');
      return doc;
    } catch (error) {
      this.report(error, `Не удалось открыть ${basename(path)}`);
      return null;
    }
  }

  activate(path: string): void {
    if (this.activePath === path) return;
    this.activePath = path;
    this.rememberNote(path);
    this.emit('active');
  }

  /** Keeps the palette's «недавние заметки» list fresh. */
  private rememberNote(path: string): void {
    const list = [path, ...this.settings.recentNotes.filter((item) => item !== path)].slice(0, 8);
    if (list.length === this.settings.recentNotes.length && list.every((item, index) => item === this.settings.recentNotes[index])) {
      return;
    }
    this.settings.recentNotes = list;
    saveSettings(this.settings);
  }

  /** Called by the editor on every change. Schedules the autosave. */
  updateContent(path: string, content: string): void {
    const doc = this.docs.find((item) => item.path === path);
    if (!doc || doc.content === content) return;
    doc.content = content;
    // Only the text changed: tabs, tree and link panels listen to 'dirty'
    // (debounced), so typing never rebuilds the whole sidebar.
    this.emit('dirty');
    this.scheduleSave(path);
    this.scheduleJournal(path);
  }

  private journalTimers = new Map<string, number>();

  /** While a document is dirty, keep a recovery snapshot roughly once a second. */
  private scheduleJournal(path: string): void {
    const doc = this.docs.find((item) => item.path === path);
    if (!doc || isDraftPath(path)) return;
    const existing = this.journalTimers.get(path);
    if (existing !== undefined) window.clearTimeout(existing);
    this.journalTimers.set(
      path,
      window.setTimeout(() => {
        this.journalTimers.delete(path);
        void this.writeJournal(path);
      }, 500),
    );
  }

  private async writeJournal(path: string): Promise<void> {
    const doc = this.docs.find((item) => item.path === path);
    const key = journalKeyFor(path);
    if (!doc || isDraftPath(path) || !this.isDirty(doc)) {
      await journal.remove(key);
      return;
    }
    await journal.write({ key, path, text: doc.content, savedAt: Date.now() });
  }

  private forgetJournal(path: string): void {
    const timer = this.journalTimers.get(path);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.journalTimers.delete(path);
    }
    void journal.remove(journalKeyFor(path));
  }

  /** Journal entries whose text no longer matches the file on disk. */
  async recoverPending(): Promise<JournalEntry[]> {
    const entries = await journal.list();
    const pending: JournalEntry[] = [];
    for (const entry of entries) {
      if (isDraftPath(entry.path) || !entry.text.trim()) {
        await journal.remove(entry.key);
        continue;
      }
      let current = '';
      try {
        current = await this.storage.readText(entry.path);
      } catch {
        current = '';
      }
      if (current === entry.text) {
        await journal.remove(entry.key);
        continue;
      }
      pending.push(entry);
    }
    return pending;
  }

  /** Opens a recovered document with the journal text as unsaved edits. */
  async restoreJournalEntry(entry: JournalEntry): Promise<boolean> {
    if (!isTextFile(entry.path)) return false;
    let saved = '';
    try {
      saved = await this.storage.readText(entry.path);
    } catch {
      saved = '';
    }
    const disk = await this.storage.stat(entry.path).catch(() => null);
    const existing = this.docs.find((doc) => doc.path === entry.path);
    if (existing) {
      existing.content = entry.text;
      existing.savedContent = saved;
      existing.disk = disk;
      this.activePath = entry.path;
      this.emit('docs', 'active');
      return true;
    }
    const doc: Doc = {
      path: entry.path,
      name: basename(entry.path),
      content: entry.text,
      savedContent: saved,
      disk,
    };
    this.docs = [...this.docs, doc];
    this.activePath = entry.path;
    this.rememberNote(entry.path);
    this.emit('docs', 'active');
    return true;
  }

  private scheduleSave(path: string): void {
    const timer = this.saveTimers.get(path);
    if (timer !== undefined) window.clearTimeout(timer);
    this.saveTimers.set(
      path,
      window.setTimeout(() => {
        this.saveTimers.delete(path);
        void this.saveDoc(path);
      }, this.settings.autosaveDelay),
    );
  }

  /** Writes one document to disk. Serialized per path so writes cannot interleave. */
  async saveDoc(path: string): Promise<boolean> {
    const doc = this.docs.find((item) => item.path === path);
    if (!doc) return true;

    const pendingTimer = this.saveTimers.get(path);
    if (pendingTimer !== undefined) {
      window.clearTimeout(pendingTimer);
      this.saveTimers.delete(path);
    }

    // A draft never reaches the disk: it is persisted locally instead.
    if (isDraftPath(path)) {
      const stored = this.persistDraftDocs();
      if (!stored) {
        // Keep the document dirty: a close must not silently lose the text.
        this.report(
          new Error('Локальное хранилище переполнено'),
          'Не удалось сохранить черновик',
        );
        return false;
      }
      doc.savedContent = doc.content;
      this.emit('dirty');
      return true;
    }

    if (!this.isDirty(doc)) return true;

    const previous = this.writes.get(path) ?? Promise.resolve();
    const write = previous.then(async () => {
      const snapshot = doc.content;
      // Somebody else may have written the file since we read it. Overwriting
      // that version would lose it, so stop and let the UI ask what to do.
      const current = await this.storage.stat(path).catch(() => null);
      if (current && doc.disk && (current.mtimeMs !== doc.disk.mtimeMs || current.size !== doc.disk.size)) {
        this.flagConflict(path, current);
        throw new SaveConflict();
      }
      try {
        // Write in the encoding and line endings the file came with.
        const meta = this.meta.get(path) ?? {
          encoding: doc.encoding ?? 'utf-8',
          bom: doc.bom ?? false,
          eol: doc.eol ?? '\n',
        };
        const bytes = encodeText(snapshot, meta.encoding, meta.bom, meta.eol);
        await this.storage.writeBinary(path, bytes);
      } catch (error) {
        this.report(error, `Не удалось сохранить ${doc.name}`);
        throw error;
      }
      // Edits that arrived while writing keep the document dirty.
      doc.savedContent = snapshot;
      doc.disk = await this.storage.stat(path).catch(() => null);
      this.conflicts.delete(path);
      this.forgetJournal(path);
      this.textCache.set(path, snapshot);
      // Keep an older revision available for rollback; the history module
      // throttles this so autosave cannot create a snapshot per keystroke.
      if (!isDraftPath(path)) void recordHistorySnapshot(path, snapshot);
      if (doc.content === snapshot) this.setStatus(`Сохранено · ${doc.name}`);
      this.emit('dirty');
    });
    this.writes.set(
      path,
      write.catch(() => undefined),
    );
    try {
      await write;
      return true;
    } catch (error) {
      return !(error instanceof SaveConflict);
    }
  }

  /** Marks a path as externally modified; the UI asks once per conflict. */
  private flagConflict(path: string, stamp: FileStat): void {
    const first = !this.conflicts.has(path);
    this.conflicts.set(path, stamp);
    if (first) this.onConflict(path);
  }

  isConflicted(path: string): boolean {
    return this.conflicts.has(path);
  }

  get conflictCount(): number {
    return this.conflicts.size;
  }

  /**
   * Compares open files with their stamps. Clean notes are reloaded silently;
   * dirty ones are only flagged, so the user's text is never dropped without an
   * explicit choice.
   */
  async checkExternalChanges(): Promise<void> {
    let reloaded: string | null = null;
    for (const doc of [...this.docs]) {
      if (isDraftPath(doc.path)) continue;
      const stamp = await this.storage.stat(doc.path).catch(() => null);
      if (!stamp) continue;
      if (!doc.disk) {
        doc.disk = stamp;
        continue;
      }
      if (stamp.mtimeMs === doc.disk.mtimeMs && stamp.size === doc.disk.size) continue;
      if (this.isDirty(doc)) {
        this.flagConflict(doc.path, stamp);
        continue;
      }
      await this.reloadDoc(doc.path);
      reloaded = doc.path;
      this.onExternalReload(doc.path);
    }
    if (reloaded) this.emit('active');
  }

  /** Applies the user's choice for a conflicted file. */
  async resolveConflict(path: string, choice: 'reload' | 'mine' | 'copy'): Promise<boolean> {
    const doc = this.docs.find((item) => item.path === path);
    this.conflicts.delete(path);
    if (!doc) return false;
    if (choice === 'reload') {
      await this.reloadDoc(path);
      return true;
    }
    if (choice === 'copy') {
      const copyPath = await this.uniqueConflictPath(path);
      try {
        await this.storage.writeText(copyPath, doc.content);
      } catch (error) {
        this.report(error, 'Не удалось сохранить копию');
        return false;
      }
      this.textCache.set(copyPath, doc.content);
      this.setStatus(`Моя версия сохранена как «${basename(copyPath)}»`);
      await this.reloadDoc(path);
      await this.refreshTree();
      return true;
    }
    // Keep mine: accept the current disk stamp, then write the local text.
    doc.disk = await this.storage.stat(path).catch(() => null);
    return this.saveDoc(path);
  }

  private async uniqueConflictPath(path: string): Promise<string> {
    const dir = dirname(path);
    const name = basename(path);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const now = new Date();
    const two = (value: number): string => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`;
    for (let index = 1; index < 1000; index += 1) {
      const suffix = index === 1 ? '' : ` ${index}`;
      const candidate = joinPath(dir, `${stem} (конфликт ${stamp}${suffix})${ext}`);
      if (!(await this.storage.exists(candidate))) return candidate;
    }
    return joinPath(dir, `${stem} (конфликт)${ext}`);
  }

  /** Saves every dirty document; returns the number that failed. */
  async saveAll(): Promise<number> {
    const dirty = this.docs.filter((doc) => this.isDirty(doc));
    const results = await Promise.all(dirty.map((doc) => this.saveDoc(doc.path)));
    return results.filter((saved) => !saved).length;
  }

  async closeDoc(path: string, force = false): Promise<boolean> {
    const doc = this.docs.find((item) => item.path === path);
    if (!doc) return true;
    if (this.isDirty(doc) && !force) {
      const saved = await this.saveDoc(path);
      if (!saved) return false;
    }
    const timer = this.saveTimers.get(path);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.saveTimers.delete(path);
    }
    this.conflicts.delete(path);
    this.forgetJournal(path);
    const index = this.docs.findIndex((item) => item.path === path);
    this.docs = this.docs.filter((item) => item.path !== path);
    if (this.activePath === path) {
      const next = this.docs[Math.min(index, this.docs.length - 1)];
      this.activePath = next ? next.path : null;
    }
    // Cached editor state for the old path must not survive the close: reopening
    // the note would otherwise show the text from the previous session.
    this.onDocClosed(path);
    this.emit('docs', 'active');
    return true;
  }

  /** Reloads content from disk; used after an external change or on demand. */
  async reloadDoc(path: string): Promise<void> {
    const doc = this.docs.find((item) => item.path === path);
    if (!doc) return;
    try {
      this.textCache.delete(path);
      this.meta.delete(path);
      const content = await this.readCached(path);
      const meta = this.meta.get(path);
      doc.content = content;
      doc.savedContent = content;
      doc.encoding = meta?.encoding;
      doc.bom = meta?.bom;
      doc.eol = meta?.eol;
      doc.disk = await this.storage.stat(path).catch(() => null);
      this.conflicts.delete(path);
      this.forgetJournal(path);
      this.emit('docs', 'active');
    } catch (error) {
      this.report(error, `Не удалось перечитать ${doc.name}`);
    }
  }

  // ------------------------------------------------------------------- CRUD

  /**
   * Writes must never happen without a workspace. Without this guard a relative
   * path would be resolved against the process working directory, which puts a
   * note somewhere the user never chose.
   */
  private requireWorkspace(): boolean {
    if (this.storage.root) return true;
    this.onError('Сначала подключите папку с заметками — «Открыть папку»');
    return false;
  }

  /**
   * Picks the next free name in a folder: «Новая заметка», «Новая заметка 2», …
   * Creating a note should not interrupt the person with a dialog.
   */
  private async nextNoteName(dir: string): Promise<string> {
    const base = 'Новая заметка';
    for (let index = 0; index < 200; index += 1) {
      const name = index === 0 ? `${base}.md` : `${base} ${index + 1}.md`;
      if (!(await this.storage.exists(joinPath(dir, name)))) return name;
    }
    return `${base} ${Date.now()}.md`;
  }

  /** Creates a note with an automatic name, then opens it. One keypress, no prompt. */
  async createNoteAuto(parentDir: string): Promise<string | null> {
    if (!this.requireWorkspace()) return null;
    return this.createNote(parentDir, await this.nextNoteName(parentDir));
  }

  /** Detaches the current workspace; notes stay on disk. */
  async closeWorkspace(): Promise<void> {
    await this.saveAll();

    for (const timer of this.saveTimers.values()) window.clearTimeout(timer);
    this.saveTimers.clear();
    this.writes.clear();

    await this.storage.closeRoot();
    this.textCache.clear();

    // Drafts are not tied to a folder: they stay open when the folder is detached.
    const drafts = this.docs.filter((doc) => isDraftPath(doc.path));
    this.docs = drafts;
    this.activePath = drafts[0]?.path ?? null;
    this.tree = [];
    this.patchSettings({ lastRoot: null });
    this.emit('docs', 'active');

    if (this.storage.kind === 'demo') {
      // The demo has no folder to detach from; reset it to the seed notes instead.
      await this.refreshTree();
      this.setStatus('Демо-заметки сброшены');
    } else {
      this.emit('tree', 'root');
      this.setStatus('Папка закрыта');
    }
  }

  async createNote(parentDir: string, rawName: string): Promise<string | null> {
    if (!this.requireWorkspace()) return null;
    const name = ensureMarkdownName(rawName);
    if (!name) {
      this.onError('Имя заметки не может быть пустым');
      return null;
    }
    const path = joinPath(parentDir, name);
    try {
      if (await this.storage.exists(path)) {
        this.onError(`Заметка «${name}» уже существует`);
        return null;
      }
      const title = titleFromPath(name);
      await this.storage.createFile(path, `# ${title}\n\n`);
      await this.refreshTree();
      await this.openNote(path);
      this.setStatus(`Создано · ${name}`);
      return path;
    } catch (error) {
      this.report(error, `Не удалось создать ${name}`);
      return null;
    }
  }

  async createFolder(parentDir: string, rawName: string): Promise<boolean> {
    if (!this.requireWorkspace()) return false;
    const name = rawName.trim().replace(/[\\/:*?"<>|]/g, '').trim();
    if (!name) {
      this.onError('Имя папки не может быть пустым');
      return false;
    }
    const path = joinPath(parentDir, name);
    try {
      await this.storage.createDir(path);
      await this.refreshTree();
      this.setStatus(`Папка создана · ${name}`);
      return true;
    } catch (error) {
      this.report(error, `Не удалось создать папку ${name}`);
      return false;
    }
  }

  /**
   * Folder used for imported files: next to the active note, otherwise the
   * workspace root (an absolute path in the native build).
   */
  get importDir(): string {
    const doc = this.activeDoc;
    if (doc && !isDraftPath(doc.path)) return dirname(doc.path);
    return this.workspaceRootDir;
  }

  /** Absolute workspace root in the native build, '' for relative backends. */
  get workspaceRootDir(): string {
    return this.storage.kind === 'tauri' ? this.storage.root ?? '' : '';
  }

  /** Folders of the workspace, used by the "move to…" picker. */
  listFolders(): { path: string; label: string; depth: number }[] {
    const out: { path: string; label: string; depth: number }[] = [
      { path: this.workspaceRootDir, label: this.rootName, depth: 0 },
    ];
    const walk = (nodes: NoteNode[], depth: number): void => {
      for (const node of nodes) {
        if (node.kind !== 'dir') continue;
        out.push({ path: node.path, label: node.name, depth });
        walk(node.children ?? [], depth + 1);
      }
    };
    walk(this.tree, 1);
    return out;
  }

  /** Copies text content into the workspace and opens it. */
  async importTextFile(dir: string, rawName: string, content: string): Promise<string | null> {
    if (!this.requireWorkspace()) return null;
    const name = ensureMarkdownName(rawName);
    if (!name) return null;
    const target = joinPath(dir, name);
    try {
      if (await this.storage.exists(target)) {
        await this.openNote(target);
        this.setStatus(`Уже в папке · ${name}`);
        return target;
      }
      await this.storage.writeText(target, content);
      this.textCache.set(target, content);
      await this.refreshTree();
      await this.openNote(target);
      this.setStatus(`Добавлено · ${name}`);
      return target;
    } catch (error) {
      this.report(error, `Не удалось добавить ${name}`);
      return null;
    }
  }

  async renameEntry(node: NoteNode, rawName: string): Promise<boolean> {    const trimmed = rawName.trim();
    if (!trimmed || trimmed === node.name) return false;
    const base = dirname(node.path);
    const nextName = node.kind === 'file' ? ensureMarkdownName(trimmed) : trimmed.replace(/[\\/:*?"<>|]/g, '');
    if (!nextName) return false;
    const target = joinPath(base, nextName);
    try {
      await this.storage.rename(node.path, target);
    } catch (error) {
      this.report(error, `Не удалось переименовать ${node.name}`);
      return false;
    }

    // Cached text follows the file.
    for (const cachedPath of [...this.textCache.keys()]) {
      if (cachedPath === node.path) {
        const text = this.textCache.get(cachedPath)!;
        this.textCache.delete(cachedPath);
        this.textCache.set(target, text);
      } else if (isInside(cachedPath, node.path)) {
        const text = this.textCache.get(cachedPath)!;
        this.textCache.delete(cachedPath);
        this.textCache.set(target + cachedPath.slice(node.path.length), text);
      }
    }

    // Keep tabs pointing at the new paths.
    this.docs = this.docs.map((doc) => {
      if (doc.path === node.path) {
        return { ...doc, path: target, name: nextName };
      }
      if (isInside(doc.path, node.path)) {
        const suffix = doc.path.slice(node.path.length);
        const movedPath = target + suffix;
        return { ...doc, path: movedPath, name: basename(movedPath) };
      }
      return doc;
    });
    if (this.activePath && isInside(this.activePath, node.path)) {
      this.activePath = this.activePath === node.path
        ? target
        : target + this.activePath.slice(node.path.length);
    }
    this.onDocRenamed(node.path, target);
    if (node.kind === 'file') {
      await this.rewriteLinksToRenamedNote(titleFromPath(node.name), titleFromPath(nextName));
    }
    await this.refreshTree();
    this.emit('docs', 'active');
    this.setStatus(`Переименовано · ${nextName}`);
    return true;
  }

  /**
   * Renaming a note rewrites `[[old title]]` references in every note and draft.
   * Links are matched by the title part, so `[[folder/Old]]` and `[[Old|label]]`
   * both survive the rename with their label and folder prefix intact.
   */
  private async rewriteLinksToRenamedNote(oldTitle: string, newTitle: string): Promise<void> {
    if (!oldTitle || !newTitle || oldTitle === newTitle) return;
    const escaped = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(\\[\\[[^\\]|]*?)${escaped}(\\s*(?:\\|[^\\]]*)?\\]\\])`, 'gi');
    const paths = new Set([
      ...this.flatFiles().map((file) => file.path),
      ...this.docs.filter((doc) => isDraftPath(doc.path)).map((doc) => doc.path),
    ]);
    for (const path of paths) {
      const doc = this.docs.find((item) => item.path === path);
      let content = '';
      try {
        content = doc ? doc.content : await this.readCached(path);
      } catch {
        continue;
      }
      const updated = content.replace(
        pattern,
        (_match, before: string, after: string) => `${before}${newTitle}${after}`,
      );
      if (updated === content) continue;
      if (doc) {
        // Keep the edit in the normal save pipeline so encoding/EOL survive.
        doc.content = updated;
        this.scheduleSave(path);
        this.onDocContentSynced(path);
        this.emit('dirty');
      } else {
        const meta = this.meta.get(path) ?? {
          encoding: 'utf-8' as const,
          bom: false,
          eol: '\n' as const,
        };
        try {
          await this.storage.writeBinary(
            path,
            encodeText(updated, meta.encoding, meta.bom, meta.eol),
          );
          this.textCache.set(path, updated);
        } catch {
          // A note that cannot be rewritten keeps the old link; nothing is lost.
        }
      }
    }
  }

  async deleteEntry(node: NoteNode): Promise<boolean> {    // Deletions go through the internal trash: a misclick must be recoverable.
    const stored = await trash.put(this.storage, node.path);
    if (!stored) {
      this.report(new Error('Не удалось переместить в корзину'), `Не удалось удалить ${node.name}`);
      return false;
    }
    this.textCache.delete(node.path);
    this.meta.delete(node.path);
    for (const cachedPath of [...this.textCache.keys()]) {
      if (isInside(cachedPath, node.path)) {
        this.textCache.delete(cachedPath);
        this.meta.delete(cachedPath);
      }
    }
    for (const doc of [...this.docs]) {
      if (isInside(doc.path, node.path)) {
        await this.closeDoc(doc.path, true);
      }
    }
    await this.refreshTree();
    this.setStatus(`В корзине KOCPAD · ${node.name}`);
    return true;
  }

  // ------------------------------------------------------------ wiki links

  /** Note titles for `[[…]]` autocomplete: drafts first, then files. */
  linkSuggestions(): { title: string; path: string }[] {
    return [
      ...this.draftList.map((draft) => ({ title: draft.title, path: draftPathOf(draft.id) })),
      ...this.flatFiles().map((file) => ({ title: titleFromPath(file.name), path: file.path })),
    ];
  }

  /** Resolves a `[[target]]` to an openable note, or null when it does not exist. */
  resolveLink(rawTarget: string): { name: string; path: string } | null {
    const wanted = normalizeLinkTarget(rawTarget);
    if (!wanted) return null;
    const lower = wanted.toLocaleLowerCase('ru');
    const titleOf = (name: string): string => titleFromPath(name).toLocaleLowerCase('ru');

    for (const file of this.flatFiles()) {
      if (titleOf(file.name) === lower) return { name: file.name, path: file.path };
    }

    const targetPath = normalizePath(wanted);
    for (const file of this.flatFiles()) {
      const path = normalizePath(file.path);
      if (path === targetPath || path.endsWith(`/${targetPath}`)) return { name: file.name, path: file.path };
    }

    for (const draft of this.draftList) {
      if (titleOf(draft.title) === lower || draft.title.toLocaleLowerCase('ru') === lower) {
        return { name: draft.title, path: draftPathOf(draft.id) };
      }
    }

    return null;
  }

  /** `[[links]]` of every note and draft, used to compute backlinks. */
  async indexLinks(): Promise<{ path: string; name: string; targets: string[] }[]> {
    const out: { path: string; name: string; targets: string[] }[] = [];
    for (const draft of this.draftList) {
      out.push({ path: draftPathOf(draft.id), name: draft.title, targets: extractWikiTargets(draft.content) });
    }
    for (const file of this.flatFiles()) {
      try {
        out.push({ path: file.path, name: file.name, targets: extractWikiTargets(await this.readCached(file.path)) });
      } catch {
        // An unreadable file has no links to contribute.
      }
    }
    return out;
  }

  /** Notes whose `[[…]]` point at `targetPath`. */
  async backlinksFor(targetPath: string): Promise<{ path: string; name: string }[]> {
    const index = await this.indexLinks();
    const result: { path: string; name: string }[] = [];
    for (const entry of index) {
      if (entry.path === targetPath) continue;
      const pointsHere = entry.targets.some((target) => this.resolveLink(target)?.path === targetPath);
      if (pointsHere) result.push({ path: entry.path, name: entry.name });
    }
    return result;
  }

  /** Note titles for the palette and quick switcher. */
  recentNoteEntries(): { title: string; path: string; missing: boolean }[] {
    return this.settings.recentNotes.map((path) => {
      const doc = this.docs.find((item) => item.path === path);
      const draft = isDraftPath(path)
        ? this.draftList.find((item) => draftPathOf(item.id) === path)
        : undefined;
      const file = this.flatFiles().find((item) => item.path === path);
      const name = doc?.name ?? draft?.title ?? file?.name ?? basename(path);
      return {
        title: titleFromPath(name),
        path,
        missing: !doc && !draft && !file,
      };
    });
  }

  // ---------------------------------------------------------------- search

  /** Collects `#tags` across drafts and files, with counts, most used first. */
  async indexTags(): Promise<TagSummary[]> {
    const map = new Map<string, TagSummary>();
    const addText = (path: string, text: string): void => {
      const { data, body } = splitFrontMatter(text);
      const found = [...extractTags(body), ...frontMatterTags(data)];
      for (const tag of found) {
        const key = tagKey(tag);
        let summary = map.get(key);
        if (!summary) {
          summary = { tag, key, count: 0, paths: [] };
          map.set(key, summary);
        }
        summary.count += 1;
        if (!summary.paths.includes(path)) summary.paths.push(path);
      }
    };

    for (const draft of this.draftList) addText(draftPathOf(draft.id), draft.content);
    for (const file of this.flatFiles()) {
      try {
        addText(file.path, await this.readCached(file.path));
      } catch {
        // An unreadable file simply contributes no tags.
      }
    }

    return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ru'));
  }

  // ------------------------------------------------------------ bulk actions

  /** Deletes several files at once and refreshes the tree once. */
  async deleteMany(paths: string[]): Promise<{ deleted: number; failed: string[] }> {
    const failed: string[] = [];
    const deletedPaths: string[] = [];
    let deleted = 0;
    for (const path of paths) {
      const stored = await trash.put(this.storage, path);
      if (!stored) {
        failed.push(basename(path));
        continue;
      }
      this.textCache.delete(path);
      this.meta.delete(path);
      deletedPaths.push(path);
      deleted += 1;
    }
    // Close only tabs whose file really disappeared; a failed delete must not
    // discard the user's unsaved buffer.
    for (const doc of [...this.docs]) {
      if (deletedPaths.some((path) => isInside(doc.path, path))) await this.closeDoc(doc.path, true);
    }
    await this.refreshTree();
    this.setStatus(
      `В корзине KOCPAD: ${deleted}${failed.length ? `, не удалось: ${failed.length}` : ''}`,
    );
    return { deleted, failed };
  }

  /** Moves notes into another workspace folder; collisions are skipped. */
  async moveMany(paths: string[], targetDir: string): Promise<{ moved: number; skipped: string[] }> {
    const dir = targetDir || this.workspaceRootDir;
    const skipped: string[] = [];
    const moved: { from: string; to: string }[] = [];

    for (const path of paths) {
      const name = basename(path);
      const target = joinPath(dir, name);
      if (normalizePath(target) === normalizePath(path)) {
        skipped.push(name);
        continue;
      }
      try {
        if (await this.storage.exists(target)) {
          skipped.push(name);
          continue;
        }
        await this.storage.rename(path, target);
        moved.push({ from: path, to: target });
        const cachedText = this.textCache.get(path);
        if (cachedText !== undefined) {
          this.textCache.delete(path);
          this.textCache.set(target, cachedText);
        }
        this.docs = this.docs.map((doc) => (doc.path === path ? { ...doc, path: target, name } : doc));
        if (this.activePath === path) this.activePath = target;
        this.onDocRenamed(path, target);
      } catch {
        skipped.push(name);
      }
    }

    await this.refreshTree();
    // Folder-qualified `[[folder/Note]]` links break when the folder changes;
    // rewrite them with the notes already moved, before the UI re-renders.
    if (moved.length) await this.rewriteLinksForMoves(moved);
    this.emit('docs', 'active');
    this.setStatus(`Перемещено: ${moved.length}${skipped.length ? `, пропущено: ${skipped.length}` : ''}`);
    return { moved: moved.length, skipped };
  }

  /**
   * Rewrites folder-qualified wiki links after a move. Plain `[[Title]]` links
   * still resolve because the title is unchanged; only targets that contain the
   * old folder prefix need editing.
   */
  private async rewriteLinksForMoves(moves: { from: string; to: string }[]): Promise<void> {
    const root = this.workspaceRootDir;
    if (!root) return;
    const relative = (path: string): string =>
      normalizePath(path)
        .replace(/\\/g, '/')
        .slice(normalizePath(root).length)
        .replace(/^\/+/, '')
        .replace(/\.(md|markdown|mdown|txt)$/i, '');

    const pairs = moves
      .map((move) => ({ oldRel: relative(move.from), newRel: relative(move.to) }))
      .filter((pair) => pair.oldRel && pair.newRel && pair.oldRel !== pair.newRel);
    if (!pairs.length) return;

    const paths = new Set([
      ...this.flatFiles().map((file) => file.path),
      ...this.docs.filter((doc) => isDraftPath(doc.path)).map((doc) => doc.path),
    ]);

    for (const path of paths) {
      const doc = this.docs.find((item) => item.path === path);
      let content = '';
      try {
        content = doc ? doc.content : await this.readCached(path);
      } catch {
        continue;
      }
      let updated = content;
      for (const pair of pairs) {
        const escaped = pair.oldRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(
          `(\\[\\[)${escaped}(?:\\.(?:md|markdown|mdown|txt))?(\\s*(?:\\|[^\\]]*)?\\]\\])`,
          'gi',
        );
        updated = updated.replace(pattern, `$1${pair.newRel}$2`);
      }
      if (updated === content) continue;
      if (doc) {
        doc.content = updated;
        this.scheduleSave(path);
        this.onDocContentSynced(path);
        this.emit('dirty');
      } else {
        const meta = this.meta.get(path) ?? {
          encoding: 'utf-8' as const,
          bom: false,
          eol: '\n' as const,
        };
        try {
          await this.storage.writeBinary(
            path,
            encodeText(updated, meta.encoding, meta.bom, meta.eol),
          );
          this.textCache.set(path, updated);
        } catch {
          // A note that cannot be rewritten keeps the old link; nothing is lost.
        }
      }
    }
  }

  /**
   * Walks the workspace and returns every `[[…]]` that does not resolve.
   * Used by the "broken links" panel; capped so a huge workspace stays usable.
   */
  async findBrokenLinks(limit = 300): Promise<BrokenLink[]> {
    const results: BrokenLink[] = [];
    const pattern = /\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/g;
    for (const file of this.flatFiles()) {
      let text = '';
      try {
        text = await this.readCached(file.path);
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      let fence: string | null = null;
      for (let index = 0; index < lines.length; index += 1) {
        const raw = lines[index];
        const fenceMatch = raw.match(/^\s*(`{3,}|~{3,})/);
        if (fenceMatch) {
          const marker = fenceMatch[1][0];
          if (fence === null) fence = marker;
          else if (fence === marker) fence = null;
          continue;
        }
        if (fence !== null) continue;
        const line = raw.replace(/`[^`]*`/g, '');
        for (const match of line.matchAll(pattern)) {
          const target = normalizeLinkTarget(match[1]);
          if (!target || this.resolveLink(target)) continue;
          results.push({
            sourcePath: file.path,
            sourceName: file.name,
            target,
            line: index + 1,
            column: (match.index ?? 0) + 1,
          });
          if (results.length >= limit) return results;
        }
      }
    }
    return results;
  }

  /**
   * Case-insensitive search across every note in the workspace plus open drafts.
   * Reads files lazily and stops at `limit` hits to stay responsive.
   */  async searchAll(
    query: string,
    limit = 300,
    options: { regex?: boolean } = {},
  ): Promise<SearchHit[]> {
    const needle = query.trim();
    if (needle.length < 2) return [];
    let pattern: RegExp;
    try {
      pattern = options.regex
        ? new RegExp(needle, 'iu')
        : new RegExp(escapeRegExp(needle), 'iu');
    } catch {
      return [];
    }
    const hits: SearchHit[] = [];

    for (const draft of this.draftList) {
      collectHits(draftPathOf(draft.id), draft.title, draft.content, pattern, hits, limit);
      if (hits.length >= limit) break;
    }

    for (const file of this.flatFiles()) {
      if (hits.length >= limit) break;
      let text: string;
      try {
        text = await this.readCached(file.path);
      } catch {
        continue;
      }
      collectHits(file.path, file.name, text, pattern, hits, limit);
    }
    return hits;
  }

  /**
   * Replaces in every note of the workspace. Each affected note is snapshotted
   * into history first, so a bad replacement can be rolled back per file.
   * Returns the number of notes and matches changed.
   */
  async replaceAll(
    query: string,
    replacement: string,
    options: { regex?: boolean } = {},
  ): Promise<{ files: number; matches: number }> {
    const needle = query.trim();
    if (needle.length < 2) return { files: 0, matches: 0 };
    let source: string;
    let flags: string;
    try {
      const base = options.regex ? new RegExp(needle, 'iu') : new RegExp(escapeRegExp(needle), 'iu');
      source = base.source;
      flags = base.flags.includes('g') ? base.flags : `${base.flags}g`;
    } catch {
      return { files: 0, matches: 0 };
    }

    let files = 0;
    let matches = 0;
    for (const file of this.flatFiles()) {
      let text = '';
      try {
        text = await this.readCached(file.path);
      } catch {
        continue;
      }
      const found = text.match(new RegExp(source, flags));
      if (!found) continue;
      const updated = options.regex
        ? text.replace(new RegExp(source, flags), replacement)
        : text.replace(new RegExp(source, flags), () => replacement);
      if (updated === text) continue;
      await recordHistorySnapshot(file.path, text, { force: true });

      const doc = this.docs.find((item) => item.path === file.path);
      if (doc) {
        doc.content = updated;
        this.scheduleSave(file.path);
        this.onDocContentSynced(file.path);
        this.emit('dirty');
      } else {
        const meta = this.meta.get(file.path) ?? {
          encoding: 'utf-8' as const,
          bom: false,
          eol: '\n' as const,
        };
        try {
          await this.storage.writeBinary(
            file.path,
            encodeText(updated, meta.encoding, meta.bom, meta.eol),
          );
          this.textCache.set(file.path, updated);
        } catch {
          continue;
        }
      }
      files += 1;
      matches += found.length;
    }
    return { files, matches };
  }

  // ---------------------------------------------------------------- errors

  private report(error: unknown, fallback: string): void {
    const message = error instanceof Error ? error.message : String(error);
    const text = message ? `${fallback}: ${message}` : fallback;
    this.setStatus(text, 'error');
    this.onError(text);
  }
}

function ensureMarkdownName(raw: string): string {
  const name = raw.trim().replace(/[\\/:*?"<>|]/g, '');
  if (!name) return '';
  return isTextFile(name) ? name : `${name}.md`;
}

/** Appends snippet hits for one document, shared by files and drafts. */
function collectHits(
  path: string,
  name: string,
  text: string,
  pattern: RegExp,
  hits: SearchHit[],
  limit: number,
): void {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (hits.length >= limit) return;
    const line = lines[index];
    const match = pattern.exec(line);
    if (!match) continue;

    const padding = 40;
    let sliceStart = Math.max(0, match.index - padding);
    let snippet = line.slice(sliceStart, Math.min(line.length, match.index + match[0].length + 80));
    // Drop leading markdown markers so list and heading lines read naturally.
    const lead = snippet.match(/^(?:[>#\s]|[-*+]\s|\d+\.\s)+/);
    if (lead) {
      sliceStart += lead[0].length;
      snippet = snippet.slice(lead[0].length);
    }
    snippet = snippet.trimEnd();

    hits.push({
      path,
      name,
      line: index + 1,
      column: match.index + 1,
      text: snippet,
      matchStart: Math.max(0, match.index - sliceStart),
      matchLength: match[0].length,
    });
  }
}

/**
 * Hides the `assets/` folder that pasted images create, unless it also holds
 * notes. Keeping image files out of the notes tree removes a confusing entry
 * that would always look empty.
 */
function pruneAssetFolders(nodes: NoteNode[]): NoteNode[] {
  const result: NoteNode[] = [];
  for (const node of nodes) {
    if (node.kind !== 'dir') {
      result.push(node);
      continue;
    }
    const children = pruneAssetFolders(node.children ?? []);
    const isAssetsFolder = node.name.toLowerCase() === 'assets';
    if (isAssetsFolder && !containsFile(children)) continue;
    result.push({ ...node, children });
  }
  return result;
}

function containsFile(nodes: NoteNode[]): boolean {
  return nodes.some((node) => node.kind === 'file' || containsFile(node.children ?? []));
}

/** Internal signal: the write was skipped because the file changed on disk. */
class SaveConflict extends Error {}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Corrupt or hand-edited localStorage must not crash note opening later.
    merged.recentFolders = Array.isArray(merged.recentFolders)
      ? merged.recentFolders.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [];
    merged.recentNotes = Array.isArray(merged.recentNotes)
      ? merged.recentNotes.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [];
    merged.editorTabSize = [2, 4, 8].includes(merged.editorTabSize) ? merged.editorTabSize : 4;
    merged.autosaveDelay = Number.isFinite(merged.autosaveDelay)
      ? Math.min(Math.max(merged.autosaveDelay, 200), 5000)
      : DEFAULT_SETTINGS.autosaveDelay;
    merged.disabledLintRules = Array.isArray(merged.disabledLintRules)
      ? merged.disabledLintRules.filter((item): item is string => typeof item === 'string')
      : [];
    merged.assistant = merged.assistant !== false;
    merged.updateChannel = merged.updateChannel === 'beta' ? 'beta' : 'stable';
    merged.updateAutoCheck = merged.updateAutoCheck !== false;
    merged.skippedUpdateVersion =
      typeof merged.skippedUpdateVersion === 'string' ? merged.skippedUpdateVersion : null;
    // Schema 2: Notepad-like line breaks and subtle line numbers on by default.
    if ((parsed.schema ?? 1) < 2) {
      merged.softBreaks = true;
      merged.showLineNumbers = true;
      merged.schema = 2;
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be full or blocked; settings simply stop persisting.
  }
}

/** Narrow helper used by the tree UI to test whether a path is open. */