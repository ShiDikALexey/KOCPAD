import type { Doc, NoteNode, SearchHit, Settings, ThemeMode, ViewMode } from './types';
import { DEFAULT_SETTINGS } from './types';
import type { Storage } from './storage';
import { basename, dirname, isInside, isTextFile, joinPath, normalizePath } from './path';
import { titleFromPath } from './util';
import {
  draftIdOf,
  draftPathOf,
  isDraftPath,
  loadDrafts,
  newDraftId,
  nextDraftTitle,
  persistDrafts,
} from './drafts';

export type Topic =
  | 'tree'
  | 'docs'
  | 'active'
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
    this.docs = [];
    this.activePath = null;
    await this.refreshTree();
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
      this.emit('tree');
    } catch (error) {
      this.report(error, 'Не удалось прочитать папку');
    }
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

  get hasDrafts(): boolean {
    return this.draftDocs.length > 0;
  }

  /** Restores drafts saved in the previous session. */
  restoreDrafts(): void {
    const stored = loadDrafts();
    for (const draft of stored) {
      const path = draftPathOf(draft.id);
      if (this.docs.some((doc) => doc.path === path)) continue;
      this.docs.push({
        path,
        name: draft.title,
        content: draft.content,
        savedContent: draft.content,
      });
    }
    if (this.docs.length && !this.activePath) this.activePath = this.docs[0].path;
    if (stored.length) this.emit('docs', 'active');
  }

  /** Creates an untitled note immediately — the notepad behaviour, no folder needed. */
  async createDraftDoc(): Promise<Doc> {
    const taken = [...this.docs.map((doc) => doc.name), ...this.draftDocs.map((doc) => doc.name)];
    const doc: Doc = {
      path: draftPathOf(newDraftId()),
      name: nextDraftTitle(taken),
      content: '',
      savedContent: '',
    };
    this.docs = [...this.docs, doc];
    this.activePath = doc.path;
    this.persistDraftDocs();
    this.emit('docs', 'active');
    return doc;
  }

  private persistDraftDocs(): boolean {
    return persistDrafts(
      this.draftDocs.map((doc) => ({
        id: draftIdOf(doc.path),
        title: doc.name,
        content: doc.content,
        updatedAt: Date.now(),
      })),
    );
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
    await this.closeDoc(path, true);
    this.persistDraftDocs();
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
    if (this.activePath === draftPath) this.activePath = target;
    this.persistDraftDocs();
    await this.refreshTree();
    this.emit('docs', 'active');
    this.setStatus(`Сохранено · ${name}`);
    return target;
  }

  /** Saves every non-empty draft into a folder with names derived from titles. */
  async saveAllDraftsAsFiles(dir: string): Promise<number> {
    let saved = 0;
    for (const doc of [...this.draftDocs]) {
      if (!doc.content.trim()) continue;
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
      const content = await this.storage.readText(path);
      const doc: Doc = { path, name: basename(path), content, savedContent: content };
      this.docs = [...this.docs, doc];
      this.activePath = path;
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
    this.emit('active');
  }

  /** Called by the editor on every change. Schedules the autosave. */
  updateContent(path: string, content: string): void {
    const doc = this.docs.find((item) => item.path === path);
    if (!doc || doc.content === content) return;
    doc.content = content;
    this.emit('docs');
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
      this.emit('docs');
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
      if (doc.content === snapshot) this.setStatus(`Сохранено · ${doc.name}`);
      this.emit('docs');
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
      const content = await this.storage.readText(path);
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
    return this.storage.kind === 'tauri' ? this.storage.root ?? '' : '';
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
    for (const doc of [...this.docs]) {
      if (isInside(doc.path, node.path)) {
        await this.closeDoc(doc.path, true);
      }
    }
    await this.refreshTree();
    this.setStatus(`Удалено · ${node.name}`);
    return true;
  }

  // ---------------------------------------------------------------- search

  /**
   * Case-insensitive search across every note in the workspace plus open drafts.
   * Reads files lazily and stops at `limit` hits to stay responsive.
   */
  async searchAll(query: string, limit = 300): Promise<SearchHit[]> {
    const needle = query.trim();
    if (needle.length < 2) return [];
    const pattern = new RegExp(escapeRegExp(needle), 'iu');
    const hits: SearchHit[] = [];

    for (const doc of this.draftDocs) {
      collectHits(doc.path, doc.name, doc.content, pattern, hits, limit);
      if (hits.length >= limit) break;
    }

    for (const file of this.flatFiles()) {
      if (hits.length >= limit) break;
      let text: string;
      try {
        text = await this.storage.readText(file.path);
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
    return { ...DEFAULT_SETTINGS, ...parsed };
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
