import type { NoteNode } from '../types';
import type { Store } from '../store';
import { h, clear } from '../util';
import { basename, dirname } from '../path';
import { icon } from './icons';
import type { AppActions } from './actions';
import { showMenu } from './dialog';

/**
 * Workspace tree in the sidebar.
 *
 * Renders folders and notes, keeps expansion state across refreshes, and offers
 * a context menu per node. A filter box turns the tree into a flat match list.
 */
export class TreeView {
  private expanded = new Set<string>();
  private filter = '';
  private filterInput: HTMLInputElement | null = null;

  constructor(
    private container: HTMLElement,
    private store: Store,
    private actions: AppActions,
  ) {}

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
    this.store.on('root', () => this.render());
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

    if (!this.store.storage.root) {
      this.container.appendChild(
        h(
          'div',
          { class: 'tree__empty' },
          h('p', { class: 'tree__empty-text' }, 'Папка с заметками не подключена.'),
          h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => this.actions.openFolder() },
            'Открыть папку'),
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
    this.renderNodes(this.store.tree, list, 0);
    this.container.appendChild(list);
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

    const list = h('div', { class: 'tree__list' });
    for (const node of matches) {
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
    this.container.appendChild(list);
  }

  private renderNodes(nodes: NoteNode[], parent: HTMLElement, depth: number): void {
    for (const node of nodes) {
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
          this.renderNodes(node.children ?? [], children, depth + 1);
          parent.appendChild(children);
        }
        continue;
      }

      const isActive = this.store.activePath === node.path;
      const isDirty = this.store.docs.some((doc) => doc.path === node.path && this.store.isDirty(doc));
      parent.appendChild(
        h(
          'div',
          {
            class: `node node--file${isActive ? ' node--active' : ''}`,
            role: 'treeitem',
            tabindex: '0',
            title: node.path,
            dataset: { path: node.path },
            onclick: () => this.actions.openNote(node.path),
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
  }

  private toggleDir(path: string): void {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
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
      { label: 'Обновить дерево', hint: 'F5', onClick: () => void this.store.refreshTree() },
    ]);
  }

  /** Name of the folder new notes land in, used by the sidebar hint. */
  targetDirLabel(): string {
    const dir = this.targetDir();
    return dir ? basename(dir) : this.store.rootName;
  }
}
