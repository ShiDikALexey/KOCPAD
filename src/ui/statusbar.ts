import type { Store } from '../store';
import { countWords, debounce, formatBytes, plural } from '../util';
import { basename, dirname } from '../path';
import { isDraftPath } from '../drafts';

export interface CursorInfo {
  line: number;
  column: number;
  selectionLength: number;
}

/** Bottom bar: where you are, how much you wrote, whether it is saved. */
export class StatusBar {
  private message!: HTMLElement;
  private stats!: HTMLElement;
  private saved!: HTMLElement;
  private backend!: HTMLElement;
  private cursor: CursorInfo = { line: 1, column: 1, selectionLength: 0 };
  /** Word counts can lag a little; the bar should not re-render per keystroke. */
  private renderDirty = debounce(() => this.renderStats(), 200);

  constructor(private store: Store) {}

  mount(): void {
    this.message = document.getElementById('status-message') as HTMLElement;
    this.stats = document.getElementById('status-stats') as HTMLElement;
    this.saved = document.getElementById('status-saved') as HTMLElement;
    this.backend = document.getElementById('status-backend') as HTMLElement;

    this.store.on('status', () => this.renderMessage());
    this.store.on('docs', () => this.renderStats());
    this.store.on('dirty', this.renderDirty);
    this.store.on('active', () => {
      this.cursor = { line: 1, column: 1, selectionLength: 0 };
      this.renderStats();
      this.renderMessage();
    });
    this.store.on('root', () => {
      this.renderMessage();
      this.renderStats();
    });

    this.renderMessage();
    this.renderStats();
  }

  setCursor(info: CursorInfo): void {
    this.cursor = info;
    // Word counts over the whole document are not worth running for every
    // keystroke; the debounced render picks the latest cursor position.
    this.renderDirty();
  }

  private renderMessage(): void {
    const status = this.store.status;
    if (status.text && status.kind === 'error') {
      this.message.textContent = status.text;
      this.message.className = 'statusbar__message statusbar__message--error';
      this.message.title = status.text;
      return;
    }
    const doc = this.store.activeDoc;
    if (doc && isDraftPath(doc.path)) {
      this.message.textContent = 'Черновик · без файла';
      this.message.className = 'statusbar__message';
      this.message.title = 'Черновик хранится локально. «Сохранить в папку» — Ctrl+S';
      return;
    }
    const location = doc ? dirname(doc.path) : '';
    const text = doc
      ? `${this.store.rootName}${location ? ` / ${basename(location)}` : ''}`
      : this.store.storage.root
        ? this.store.rootName
        : 'Папка не подключена';
    this.message.textContent = text;
    this.message.className = 'statusbar__message';
    this.message.title = doc ? doc.path : text;
  }

  private renderStats(): void {
    const doc = this.store.activeDoc;
    const content = doc?.content ?? '';
    const words = countWords(content);
    const chars = content.length;
    const lines = content ? content.split('\n').length : 0;
    const parts: string[] = [];
    parts.push(`${words} ${plural(words, 'слово', 'слова', 'слов')}`);
    parts.push(`${chars} ${plural(chars, 'символ', 'символа', 'символов')}`);
    parts.push(`${lines} ${plural(lines, 'строка', 'строки', 'строк')}`);
    if (words >= 60) parts.push(`~${Math.max(1, Math.round(words / 180))} мин чтения`);
    if (this.cursor.selectionLength > 0) {
      parts.push(`выделено ${this.cursor.selectionLength}`);
    } else if (doc) {
      parts.push(`стр. ${this.cursor.line}, стлб. ${this.cursor.column}`);
    }
    this.stats.textContent = doc ? parts.join(' · ') : '';

    const dirty = doc ? this.store.isDirty(doc) : false;
    const saving = this.store.dirtyCount;
    const draft = doc ? isDraftPath(doc.path) : false;
    this.saved.textContent = !doc
      ? ''
      : draft
        ? dirty
          ? 'Черновик: сохраняю…'
          : 'Черновик сохранён локально'
        : dirty
          ? `Изменения не сохранены${saving > 1 ? ` (${saving})` : ''}`
          : 'Сохранено';
    this.saved.className = `statusbar__saved${draft ? ' statusbar__saved--draft' : ''}${dirty && !draft ? ' statusbar__saved--dirty' : ''}`;

    const kindLabel = this.store.storage.kind === 'tauri'
      ? 'Windows'
      : this.store.storage.kind === 'browser'
        ? 'Браузер'
        : 'Демо';
    this.backend.textContent = kindLabel;
    this.backend.title = this.store.storage.canPersist
      ? 'Заметки пишутся на диск'
      : 'Демо-режим: изменения не сохраняются на диск';

    const docNode = this.store.findNode(this.store.activePath ?? '');
    if (docNode?.size !== undefined) this.stats.title = formatBytes(docNode.size);
  }
}
