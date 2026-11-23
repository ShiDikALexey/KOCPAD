import type { NoteNode } from '../types';
import type { Store } from '../store';
import { h, clear, debounce } from '../util';
import { basename, dirname } from '../path';
import { icon } from './icons';
import type { AppActions } from './actions';
import { showMenu } from './dialog';

/** Large folders render in chunks: 150 rows at a time. */
const DIR_PAGE_SIZE = 150;
/** Cap for the flat filter list. */
const FILTER_LIMIT = 300;

/**
 * Workspace tree in the sidebar.
 *
 * Renders folders and notes, keeps expansion state across refreshes, and offers
 * a context menu per node. A filter box turns the tree into a flat match list.
 * Big folders are drawn in pages, so a library of thousands of notes does not
 * stall the first paint.
 */
export class TreeView {
  private expanded = new Set<string>();
  private filter = '';
  private filterInput: HTMLInputElement | null = null;
  /** Dirty dots can lag behind typing; the tree is expensive to rebuild. */
  private renderDirty = debounce(() => this.render(), 400);
  /** How many chunks of a folder are currently shown, keyed by dir path. */
  private pages = new Map<string, number>();
  /** Selected note paths (files only): Ctrl+Click toggles, Shift+Click ranges. */
  private selection = new Set<string>();
  private anchor: string | null = null;

  constructor(
    private container: HTMLElement,
    private store: Store,
    private actions: AppActions,
  ) {}

  get hasSelection(): boolean {
    return this.selection.size > 0;
  }

  /** Selected note paths, for keyboard actions such as Delete. */
  get selectedPaths(): string[] {
    return [...this.selection];
  }

  clearSelection(render = true): void {
    if (!this.selection.size) return;
    this.selection.clear();
    this.anchor = null;
    if (render) this.render();
  }

  private toggleSelection(path: string): void {
    if (this.selection.has(path)) this.selection.delete(path);
    else this.selection.add(path);
    this.anchor = path;
    this.render();
  }

  /** Shift+Click selects the range between the anchor and the clicked note. */
  private selectRange(path: string): void {
    const order = Array.from(this.container.querySelectorAll<HTMLElement>('.node--file'))
      .map((element) => element.dataset.path)
      .filter((item): item is string => Boolean(item));
    const to = order.indexOf(path);
    const from = this.anchor ? order.indexOf(this.anchor) : -1;
    if (to < 0) return;
    if (from < 0) {
      this.selection.add(path);
    } else {
      const [start, end] = from <= to ? [from, to] : [to, from];
      for (let index = start; index <= end; index += 1) this.selection.add(order[index]);
    }
    this.render();
  }

  private handleFileClick(event: MouseEvent, path: string): void {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      this.toggleSelection(path);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      this.selectRange(path);
      return;
    }
    this.clearSelection(false);
    this.actions.openNote(path);
  }

  private renderSelectionBar(): HTMLElement {
    const count = this.selection.size;
    return h(
      'div',
      { class: 'selection-bar', role: 'toolbar', 'aria-label': 'Действия с выбранными заметками' },
      h('span', { class: 'selection-bar__count' }, `Выбрано: ${count}`),
      h(
        'button',
        {
          class: 'btn btn--sm',
          type: 'button',
          title: 'Переместить в другую папку',
          onclick: () => this.actions.moveSelected([...this.selection]),
        },
        'Переместить',
      ),
      h(
        'button',
        {
          class: 'btn btn--sm btn--danger',
          type: 'button',
          onclick: () => this.actions.deleteSelected([...this.selection]),
        },
        'Удалить',
      ),
      h(
        'button',
        {
          class: 'tb-btn tb-btn--icon tb-btn--sm',
          type: 'button',
          title: 'Снять выделение (Esc)',
          'aria-label': 'Снять выделение',
          onclick: () => this.clearSelection(),
        },
        icon('close', 14),
      ),
    );
  }

  mount(): void {
    this.filterInput = document.getElementById('tree-filter') as HTMLInputElement | null;
    this.filterInput?.addEventListener('input', () => {
      this.filter = this.filterInput?.value ?? '';
      this.render();
    });
    this.container.addEventListener('contextmenu', (event) => {
      if ((event.target as HTMLElement).closest('.node')) return;
      event.preventDefault();
      this.openEmptyMenu(event);
    });

    this.store.on('tree', () => this.render());
    this.store.on('docs', () => this.render());
    this.store.on('active', () => this.render());
    this.store.on('dirty', this.renderDirty);
    this.store.on('root', () => {
      this.pages.clear();
      this.selection.clear();
      this.render();
    });
    this.render();
  }

  /** Directory for new notes: the active note's folder, else the workspace root. */
  private targetDir(): string {
    const doc = this.store.activeDoc;
    if (doc) return dirname(doc.path);
    return '';
  }

  render(): void {
    this.applyFilterVisibility();
    clear(this.container);

    // Drop selections for notes that disappeared from the workspace.
    if (this.selection.size) {
      const available = new Set(this.store.flatFiles().map((file) => file.path));
      for (const path of [...this.selection]) {
        if (!available.has(path)) this.selection.delete(path);
      }
    }

    if (!this.store.storage.root) {
      this.container.appendChild(
        h(
          'div',
          { class: 'tree__empty' },
          h('p', { class: 'tree__empty-text' }, 'Папка с заметками не подключена.'),
        ),
      );
      return;
    }

    if (!this.store.tree.length) {
      this.container.appendChild(
        h(
          'div',
          { class: 'tree__empty' },
          h('p', { class: 'tree__empty-text' }, 'В этой папке пока нет markdown-заметок.'),
          h('button', { class: 'btn btn--sm', type: 'button', onclick: () => this.actions.createNote('') },
            'Создать заметку'),
        ),
      );
      return;
    }

    if (this.filter.trim()) {
      this.renderMatches();
      return;
    }

    const list = h('div', { class: 'tree__list', role: 'tree', 'aria-label': 'Заметки' });
    this.renderNodes(this.store.tree, list, 0, '');
    this.container.appendChild(list);
    if (this.selection.size) this.container.appendChild(this.renderSelectionBar());
  }

  private applyFilterVisibility(): void {
    const host = this.container.closest('.sidebar');
    host?.classList.toggle('sidebar--filtering', Boolean(this.filter.trim()));
  }

  private renderMatches(): void {
    const needle = this.filter.trim().toLowerCase();
    const matches: NoteNode[] = [];
    const walk = (nodes: NoteNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'dir') walk(node.children ?? []);
        else if (node.name.toLowerCase().includes(needle)) matches.push(node);
      }
    };
    walk(this.store.tree);

    if (!matches.length) {
      this.container.appendChild(h('p', { class: 'tree__empty-text' }, 'Ничего не найдено.'));
      return;
    }

    const shown = matches.slice(0, FILTER_LIMIT);
    const list = h('div', { class: 'tree__list' });
    for (const node of shown) {
      const folder = dirname(node.path);
      list.appendChild(
        h(
          'button',
          {
            class: 'node node--flat',
            type: 'button',
            title: node.path,
            onclick: () => this.actions.openNote(node.path),
          },
          icon('file', 14, 'node__glyph'),
          h('span', { class: 'node__name' }, node.name),
          folder ? h('span', { class: 'node__path' }, folder) : null,
        ),
      );
    }
    if (matches.length > shown.length) {
      list.appendChild(
        h('p', { class: 'tree__empty-text' }, `Показано ${shown.length} из ${matches.length} — уточните фильтр.`),
      );
    }
    this.container.appendChild(list);
  }

  private renderNodes(nodes: NoteNode[], parent: HTMLElement, depth: number, dirKey: string): void {
    const page = this.pages.get(dirKey) ?? 1;
    const limit = page * DIR_PAGE_SIZE;
    const visible = nodes.length > limit ? nodes.slice(0, limit) : nodes;

    for (const node of visible) {
      if (node.kind === 'dir') {
        const isOpen = this.expanded.has(node.path);
        const row = h(
          'div',
          {
            class: `node node--dir${isOpen ? ' node--open' : ''}`,
            role: 'treeitem',
            'aria-expanded': isOpen ? 'true' : 'false',
            'aria-level': depth + 1,
            tabindex: '0',
            title: node.path,
            dataset: { path: node.path },
            onclick: (event: MouseEvent) => {
              if ((event.target as HTMLElement).closest('.node__menu')) return;
              this.toggleDir(node.path);
            },
            onkeydown: (event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.toggleDir(node.path);
              }
            },
            oncontextmenu: (event: MouseEvent) => this.openNodeMenu(event, node),
          },
          h('span', { class: 'node__twisty' }, icon('chevron', 12)),
          h('span', { class: 'node__glyph node__glyph--folder' }, icon(isOpen ? 'folderOpen' : 'folder', 14)),
          h('span', { class: 'node__name' }, node.name),
          h('span', { class: 'node__count' }, String(node.children?.length ?? 0)),
        );
        parent.appendChild(row);
        if (isOpen) {
          const children = h('div', { class: 'node__children', role: 'group' });
          this.renderNodes(node.children ?? [], children, depth + 1, node.path);
          parent.appendChild(children);
        }
        continue;
      }

      const isActive = this.store.activePath === node.path;
      const isDirty = this.store.docs.some((doc) => doc.path === node.path && this.store.isDirty(doc));
      const isSelected = this.selection.has(node.path);
      parent.appendChild(
        h(
          'div',
          {
            class: `node node--file${isActive ? ' node--active' : ''}${isSelected ? ' node--selected' : ''}`,
            role: 'treeitem',
            tabindex: '0',
            title: isSelected ? `${node.path}\nCtrl+клик — снять, Shift+клик — диапазон` : node.path,
            dataset: { path: node.path },
            onclick: (event: MouseEvent) => this.handleFileClick(event, node.path),
            onkeydown: (event: KeyboardEvent) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                this.actions.openNote(node.path);
              }
            },
            oncontextmenu: (event: MouseEvent) => this.openNodeMenu(event, node),
          },
          h('span', { class: 'node__twisty node__twisty--empty' }),
          icon('file', 14, 'node__glyph'),
          h('span', { class: 'node__name' }, node.name),
          isDirty ? h('span', { class: 'node__dirty', title: 'Есть несохранённые изменения' }) : null,
        ),
      );
    }

    if (nodes.length > visible.length) {
      const remaining = nodes.length - visible.length;
      parent.appendChild(
        h(
          'button',
          {
            class: 'node tree__more',
            type: 'button',
            title: `Показать ещё ${Math.min(remaining, DIR_PAGE_SIZE)} из ${remaining}`,
            onclick: () => {
              this.pages.set(dirKey, page + 1);
              this.render();
            },
          },
          h('span', { class: 'node__twisty node__twisty--empty' }),
          h('span', { class: 'node__name' }, `Показать ещё · ${remaining}`),
        ),
      );
    }
  }

  private toggleDir(path: string): void {
    if (this.expanded.has(path)) {
      this.expanded.delete(path);
      // Re-opening a folder starts from the first page again.
      this.pages.delete(path);
    } else {
      this.expanded.add(path);
    }
    this.render();
  }

  private openNodeMenu(event: MouseEvent, node: NoteNode): void {
    event.preventDefault();
    event.stopPropagation();
    const items = node.kind === 'dir'
      ? [
          { label: 'Новая заметка', hint: 'Ctrl+N', onClick: () => this.actions.createNote(node.path) },
          { label: 'Новая папка', hint: 'Ctrl+Shift+N', onClick: () => this.actions.createFolder(node.path) },
          { label: 'Переименовать', hint: 'F2', onClick: () => this.actions.renameEntry(node) },
          { label: 'Удалить', hint: 'Del', danger: true, onClick: () => this.actions.deleteEntry(node) },
          { label: 'Копировать путь', onClick: () => this.actions.copyPath(node) },
        ]
      : [
          { label: 'Открыть', hint: 'Enter', onClick: () => this.actions.openNote(node.path) },
          { label: 'Переименовать', hint: 'F2', onClick: () => this.actions.renameEntry(node) },
          { label: 'Удалить', hint: 'Del', danger: true, onClick: () => this.actions.deleteEntry(node) },
          { label: 'Копировать путь', onClick: () => this.actions.copyPath(node) },
          { label: 'Показать в проводнике', onClick: () => this.actions.revealEntry(node) },
        ];
    showMenu({ x: event.clientX, y: event.clientY }, items);
  }

  private openEmptyMenu(event: MouseEvent): void {
    showMenu({ x: event.clientX, y: event.clientY }, [
      { label: 'Новая заметка', hint: 'Ctrl+N', onClick: () => this.actions.createNote(this.targetDir()) },
      { label: 'Новая папка', hint: 'Ctrl+Shift+N', onClick: () => this.actions.createFolder(this.targetDir()) },
      { label: 'Обновить дерево', hint: 'F5', onClick: () => this.actions.refreshWorkspace() },
    ]);
  }

  /** Name of the folder new notes land in, used by the sidebar hint. */
  targetDirLabel(): string {
    const dir = this.targetDir();
    return dir ? basename(dir) : this.store.rootName;
  }
}
