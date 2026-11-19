import type { Store } from '../store';
import type { TagSummary } from '../tags';
import { basename } from '../path';
import { isDraftPath } from '../drafts';
import { clear, debounce, h, plural } from '../util';
import { icon } from './icons';
import type { AppActions } from './actions';

/**
 * Tags panel: every `#tag` in the workspace with a note count, plus a filtered
 * list of notes for the selected tag. Files are read on demand, so the panel
 * refreshes when it is opened or when the tree changes.
 */
export class TagsView {
  private tags: TagSummary[] = [];
  private selected: string | null = null;
  private loading = false;
  private requestId = 0;

  constructor(
    private container: HTMLElement,
    private store: Store,
    private actions: AppActions,
  ) {}

  /** Tags change with the text; re-index only after a pause, and only if shown. */
  private refreshDirty = debounce(() => {
    if (this.visible()) void this.refresh();
  }, 1500);

  mount(): void {
    this.store.on('tree', () => {
      if (this.visible()) void this.refresh();
    });
    this.store.on('root', () => {
      this.selected = null;
      this.tags = [];
      if (this.visible()) void this.refresh();
    });
    this.store.on('dirty', this.refreshDirty);
    this.render();
  }

  /** The shell calls this when the sidebar switches to the tags tab. */
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
    let result: TagSummary[] = [];
    try {
      result = await this.store.indexTags();
    } finally {
      if (request === this.requestId) {
        this.tags = result;
        this.loading = false;
        this.render();
      }
    }
  }

  private noteLabel(path: string): string {
    if (isDraftPath(path)) {
      return this.store.docs.find((doc) => doc.path === path)?.name ?? 'Черновик';
    }
    return basename(path);
  }

  render(): void {
    clear(this.container);

    const head = h(
      'div',
      { class: 'tags__head' },
      h(
        'span',
        { class: 'tags__title' },
        this.selected ? 'Заметки с тегом' : 'Все теги',
      ),
      h(
        'button',
        {
          class: 'tb-btn tb-btn--icon tb-btn--sm',
          type: 'button',
          title: 'Обновить список тегов',
          'aria-label': 'Обновить список тегов',
          onclick: () => void this.refresh(),
        },
        icon('refresh', 14),
      ),
    );
    this.container.appendChild(head);

    if (this.loading) {
      this.container.appendChild(h('p', { class: 'tags__empty' }, 'Считаю теги…'));
      return;
    }

    if (this.selected) {
      this.renderTagNotes(this.tags.find((item) => item.key === this.selected) ?? null);
      return;
    }

    if (!this.tags.length) {
      this.container.appendChild(
        h(
          'div',
          { class: 'tags__empty' },
          h('p', null, 'В заметках пока нет тегов.'),
          h('p', { class: 'tags__hint' }, 'Добавьте в текст что-то вроде #идея или #работа/проект — тег появится здесь.'),
        ),
      );
      return;
    }

    const list = h('div', { class: 'tags__list' });
    for (const tag of this.tags) {
      list.appendChild(
        h(
          'button',
          {
            class: 'tag-row',
            type: 'button',
            title: `${tag.tag} — ${tag.paths.length} ${plural(tag.paths.length, 'заметка', 'заметки', 'заметок')}`,
            onclick: () => {
              this.selected = tag.key;
              this.render();
            },
          },
          h('span', { class: 'tag-row__name' }, `#${tag.tag}`),
          h('span', { class: 'tag-row__count' }, String(tag.paths.length)),
        ),
      );
    }
    this.container.appendChild(list);
  }

  private renderTagNotes(tag: TagSummary | null): void {
    const back = h(
      'button',
      {
        class: 'tags__back',
        type: 'button',
        onclick: () => {
          this.selected = null;
          this.render();
        },
      },
      '← все теги',
    );

    if (!tag) {
      this.container.appendChild(back);
      this.container.appendChild(h('p', { class: 'tags__empty' }, 'Тег больше не встречается в заметках.'));
      return;
    }

    this.container.appendChild(
      h(
        'div',
        { class: 'tags__selected' },
        back,
        h('span', { class: 'tags__chip' }, `#${tag.tag}`),
      ),
    );

    const list = h('div', { class: 'tags__notes' });
    for (const path of tag.paths) {
      const active = this.store.activePath === path;
      list.appendChild(
        h(
          'button',
          {
            class: `node node--flat${active ? ' node--active' : ''}`,
            type: 'button',
            title: path,
            onclick: () => this.actions.openNote(path),
          },
          icon('file', 14, 'node__glyph'),
          h('span', { class: 'node__name' }, this.noteLabel(path)),
        ),
      );
    }
    this.container.appendChild(list);
  }
}
