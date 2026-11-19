import type { Store } from '../store';
import type { AppActions } from './actions';
import { isDraftPath } from '../drafts';
import { basename } from '../path';
import { extractWikiLinks } from '../wikilinks';
import { clear, debounce, h } from '../util';
import { icon } from './icons';

interface LinkRow {
  label: string;
  path: string | null;
  missing: boolean;
}

/**
 * Links panel: outgoing `[[…]]` of the active note and the notes that link back
 * to it. Backlinks require reading the workspace, so they are computed when the
 * panel is opened and refreshed on document/tree changes.
 */
export class LinksView {
  private backlinks: { path: string; name: string }[] = [];
  private loading = false;
  private requestId = 0;

  constructor(
    private container: HTMLElement,
    private store: Store,
    private actions: AppActions,
  ) {}

  /** Outgoing links change while typing; refresh after a pause, not per key. */
  private refreshDirty = debounce(() => {
    if (this.visible()) void this.refresh();
  }, 700);

  mount(): void {
    this.store.on('active', () => {
      if (this.visible()) void this.refresh();
    });
    this.store.on('tree', () => {
      if (this.visible()) void this.refresh();
    });
    this.store.on('dirty', this.refreshDirty);
    this.render();
  }

  activate(): void {
    void this.refresh();
  }

  private visible(): boolean {
    return !this.container.hidden;
  }

  async refresh(): Promise<void> {
    const request = ++this.requestId;
    this.loading = true;
    this.render();
    const doc = this.store.activeDoc;
    const backlinks = doc ? await this.store.backlinksFor(doc.path) : [];
    if (request !== this.requestId) return;
    this.backlinks = backlinks;
    this.loading = false;
    this.render();
  }

  private outgoing(): LinkRow[] {
    const doc = this.store.activeDoc;
    if (!doc) return [];
    return extractWikiLinks(doc.content).map(({ target, alias }) => {
      const resolved = this.store.resolveLink(target);
      return { label: alias ?? target, path: resolved?.path ?? null, missing: !resolved };
    });
  }

  private noteLabel(path: string): string {
    if (isDraftPath(path)) {
      return this.store.docs.find((doc) => doc.path === path)?.name ?? 'Черновик';
    }
    return basename(path);
  }

  private section(title: string, rows: LinkRow[], emptyText: string): HTMLElement {
    const list = h('div', { class: 'links__list' });
    if (!rows.length) {
      list.appendChild(h('p', { class: 'links__empty' }, emptyText));
    }
    for (const row of rows) {
      list.appendChild(
        h(
          'button',
          {
            class: `node node--flat links__row${row.missing ? ' links__row--missing' : ''}`,
            type: 'button',
            title: row.missing ? 'Заметка не найдена' : row.path ?? '',
            onclick: () => {
              if (row.path) this.actions.openNote(row.path);
            },
          },
          icon(row.missing ? 'close' : 'external', 13, 'node__glyph'),
          h('span', { class: 'node__name' }, row.label),
        ),
      );
    }
    return h('section', { class: 'links__section' }, h('h3', { class: 'links__title' }, title), list);
  }

  render(): void {
    clear(this.container);
    const doc = this.store.activeDoc;

    this.container.appendChild(
      h(
        'div',
        { class: 'tags__head' },
        h('span', { class: 'tags__title' }, 'Связи'),
        h(
          'button',
          {
            class: 'tb-btn tb-btn--icon tb-btn--sm',
            type: 'button',
            title: 'Обновить связи',
            'aria-label': 'Обновить связи',
            onclick: () => void this.refresh(),
          },
          icon('refresh', 14),
        ),
      ),
    );

    if (!doc) {
      this.container.appendChild(h('p', { class: 'links__empty' }, 'Откройте заметку, чтобы увидеть её связи.'));
      return;
    }

    this.container.appendChild(this.section('Исходящие ссылки', this.outgoing(), 'В заметке нет ссылок [[…]].'));
    if (this.loading) {
      this.container.appendChild(h('p', { class: 'links__empty' }, 'Ищу обратные ссылки…'));
    } else {
      this.container.appendChild(
        this.section(
          'Обратные ссылки',
          this.backlinks.map((item) => ({ label: this.noteLabel(item.path), path: item.path, missing: false })),
          'Пока никто не ссылается на эту заметку.',
        ),
      );
    }
  }
}
