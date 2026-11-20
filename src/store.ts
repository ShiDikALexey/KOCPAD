import type { Doc, NoteNode, SearchHit, Settings, ThemeMode, ViewMode } from './types';
import { DEFAULT_SETTINGS } from './types';
import type { Storage } from './storage';
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
  /** Drafts kept between sessions independently of the open tabs. */
  private storedDrafts: StoredDraft[] = [];
  onError: (message: string) => void = () => undefined;

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
    const text = await this.storage.readText(path);
    this.textCache.set(path, text);
    return text;
  }

  /** F5 / «Обновить»: forget cached text so external edits are picked up. */
  clearTextCache(): void {
    this.textCache.clear();
  }

  /** Notes that already have cached text, for diagnostics. */
  get cachedNotes(): number {
    return this.textCache.size;
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

  get hasDrafts(): boolean {
    return this.storedDrafts.length > 0;
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
    try {
      if (await this.storage.exists(target)) {
        this.onError(`Файл «${name}» уже существует`);
        return null;
      }
      await this.storage.writeText(target, doc.content);
    } catch (error) {
      this.report(error, `Не удалось сохранить ${name}`);
      return null;
    }

    doc.path = target;
    doc.name = name;
    doc.savedContent = doc.content;
    this.textCache.set(target, doc.content);
    if (this.activePath === draftPath) this.activePath = target;
    this.storedDrafts = this.storedDrafts.filter((draft) => draft.id !== draftIdOf(draftPath));
    this.persistDraftDocs();
    await this.refreshTree();
    this.emit('docs', 'active');
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

  /** Saves every non-empty draft into a folder with names derived from titles. */
  async saveAllDraftsAsFiles(dir: string): Promise<number> {
    let saved = 0;
    for (const draft of this.draftList) {
      if (!draft.content.trim()) continue;
      const doc = this.openDraft(draft.id);
      if (!doc) continue;
      const name = await this.uniqueDraftFileName(dir, doc.name);
      if (await this.saveDraftAsFile(doc.path, dir, name)) saved += 1;
    }
    return saved;
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
      const doc: Doc = { path, name: basename(path), content, savedContent: content };
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
      doc.savedContent = doc.content;
      this.emit('dirty');
      if (!stored) {
        this.report(
          new Error('Локальное хранилище переполнено'),
          'Не удалось сохранить черновик',
        );
        return false;
      }
      return true;
    }

    if (!this.isDirty(doc)) return true;

    const previous = this.writes.get(path) ?? Promise.resolve();
    const write = previous.then(async () => {
      const snapshot = doc.content;
      try {
        await this.storage.writeText(path, snapshot);
      } catch (error) {
        this.report(error, `Не удалось сохранить ${doc.name}`);
        throw error;
      }
      // Edits that arrived while writing keep the document dirty.
      doc.savedContent = snapshot;
      this.textCache.set(path, snapshot);
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
    } catch {
      return false;
    }
  }

  async saveAll(): Promise<void> {
    await Promise.all(this.docs.filter((doc) => this.isDirty(doc)).map((doc) => this.saveDoc(doc.path)));
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
    const index = this.docs.findIndex((item) => item.path === path);
    this.docs = this.docs.filter((item) => item.path !== path);
    if (this.activePath === path) {
      const next = this.docs[Math.min(index, this.docs.length - 1)];
      this.activePath = next ? next.path : null;
    }
    this.emit('docs', 'active');
    return true;
  }

  /** Reloads content from disk; used after an external change or on demand. */
  async reloadDoc(path: string): Promise<void> {
    const doc = this.docs.find((item) => item.path === path);
    if (!doc) return;
    try {
      this.textCache.delete(path);
      const content = await this.readCached(path);
      doc.content = content;
      doc.savedContent = content;
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
    await this.refreshTree();
    this.emit('docs', 'active');
    this.setStatus(`Переименовано · ${nextName}`);
    return true;
  }

  async deleteEntry(node: NoteNode): Promise<boolean> {
    try {
      await this.storage.remove(node.path);
    } catch (error) {
      this.report(error, `Не удалось удалить ${node.name}`);
      return false;
    }
    this.textCache.delete(node.path);
    for (const cachedPath of [...this.textCache.keys()]) {
      if (isInside(cachedPath, node.path)) this.textCache.delete(cachedPath);
    }
    for (const doc of [...this.docs]) {
      if (isInside(doc.path, node.path)) {
        await this.closeDoc(doc.path, true);
      }
    }
    await this.refreshTree();
    this.setStatus(`Удалено · ${node.name}`);
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
    let deleted = 0;
    for (const path of paths) {
      try {
        await this.storage.remove(path);
        this.textCache.delete(path);
        deleted += 1;
      } catch {
        failed.push(basename(path));
      }
    }
    for (const doc of [...this.docs]) {
      if (paths.some((path) => isInside(doc.path, path))) await this.closeDoc(doc.path, true);
    }
    await this.refreshTree();
    this.setStatus(`Удалено: ${deleted}${failed.length ? `, не удалось: ${failed.length}` : ''}`);
    return { deleted, failed };
  }

  /** Moves notes into another workspace folder; collisions are skipped. */
  async moveMany(paths: string[], targetDir: string): Promise<{ moved: number; skipped: string[] }> {
    const dir = targetDir || this.workspaceRootDir;
    const skipped: string[] = [];
    let moved = 0;

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
        moved += 1;
        const cachedText = this.textCache.get(path);
        if (cachedText !== undefined) {
          this.textCache.delete(path);
          this.textCache.set(target, cachedText);
        }
        this.docs = this.docs.map((doc) => (doc.path === path ? { ...doc, path: target, name } : doc));
        if (this.activePath === path) this.activePath = target;
      } catch {
        skipped.push(name);
      }
    }

    await this.refreshTree();
    this.emit('docs', 'active');
    this.setStatus(`Перемещено: ${moved}${skipped.length ? `, пропущено: ${skipped.length}` : ''}`);
    return { moved, skipped };
  }

  /**
   * Case-insensitive search across every note in the workspace plus open drafts.
   * Reads files lazily and stops at `limit` hits to stay responsive.
   */
  async searchAll(query: string, limit = 300): Promise<SearchHit[]> {
    const needle = query.trim();
    if (needle.length < 2) return [];
    const pattern = new RegExp(escapeRegExp(needle), 'iu');
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
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
export function isOpen(store: Store, path: string): boolean {
  return store.docs.some((doc) => normalizePath(doc.path) === normalizePath(path));
}
