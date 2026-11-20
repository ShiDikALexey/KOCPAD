import type { Store } from '../store';
import type { SearchHit } from '../types';
import { clear, h, plural } from '../util';
import { icon } from './icons';
import { closeOnBackdrop } from './dialog';
import type { AppActions } from './actions';

/**
 * Workspace-wide search (Ctrl+Shift+F).
 *
 * Results are grouped by note, keyboard navigable, and open the hit at the
 * exact line. Search runs debounced against every text file in the workspace.
 */
export class GlobalSearchPanel {
  private overlay: HTMLElement | null = null;
  private disposeBackdrop: (() => void) | null = null;
  private lastQuery = '';

  constructor(
    private store: Store,
    private actions: AppActions,
  ) {}

  open(): void {
    if (this.overlay) return;
    const host = document.getElementById('overlay');
    if (!host) return;

    const input = h('input', {
      class: 'gsearch__input',
      type: 'text',
      placeholder: 'Искать во всех заметках…',
      spellcheck: false,
      'aria-label': 'Поиск по всем заметкам',
      value: this.lastQuery,
    }) as HTMLInputElement;
    const results = h('div', { class: 'gsearch__results' });
    const counter = h('span', { class: 'gsearch__count' });
    const panel = h(
      'div',
      { class: 'gsearch', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Поиск по заметкам' },
      h(
        'div',
        { class: 'gsearch__head' },
        icon('search', 15),
        input,
        h(
          'button',
          {
            class: 'gsearch__close',
            type: 'button',
            'aria-label': 'Закрыть поиск',
            onclick: () => this.close(),
          },
          icon('close', 14),
        ),
      ),
      results,
      h(
        'div',
        { class: 'gsearch__foot' },
        counter,
        h('span', { class: 'gsearch__hint' }, 'Enter — перейти · Esc — закрыть'),
      ),
    );

    this.overlay = panel;
    host.classList.add('overlay--visible');
    clear(host);
    host.appendChild(panel);
    this.disposeBackdrop = closeOnBackdrop(host, () => this.close());
    input.focus();
    input.select();

    let hits: SearchHit[] = [];
    let selected = 0;

    const renderResults = (): void => {
      clear(results);
      if (!input.value.trim()) {
        results.appendChild(
          h('p', { class: 'gsearch__empty' }, 'Введите хотя бы два символа. Поиск идёт по всем .md и .txt в папке.'),
        );
        counter.textContent = '';
        return;
      }
      if (!hits.length) {
        results.appendChild(h('p', { class: 'gsearch__empty' }, 'Ничего не найдено.'));
        counter.textContent = '';
        return;
      }

      const groups = new Map<string, SearchHit[]>();
      for (const hit of hits) {
        const list = groups.get(hit.path) ?? [];
        list.push(hit);
        groups.set(hit.path, list);
      }

      let index = 0;
      groups.forEach((group) => {
        results.appendChild(
          h(
            'div',
            { class: 'gsearch__group' },
            icon('file', 13),
            h('span', { class: 'gsearch__file' }, group[0].name),
            h('span', { class: 'gsearch__folder' }, parentFolder(group[0].path)),
          ),
        );
        for (const hit of group) {
          const rowIndex = index;
          const before = hit.text.slice(0, hit.matchStart);
          const match = hit.text.slice(hit.matchStart, hit.matchStart + hit.matchLength);
          const after = hit.text.slice(hit.matchStart + hit.matchLength);
          results.appendChild(
            h(
              'button',
              {
                class: `gsearch__hit${rowIndex === selected ? ' gsearch__hit--active' : ''}`,
                type: 'button',
                onmouseenter: () => {
                  selected = rowIndex;
                  highlight();
                },
                onclick: () => {
                  selected = rowIndex;
                  open();
                },
              },
              h('span', { class: 'gsearch__line' }, `${hit.line}`),
              h('span', { class: 'gsearch__snippet' }, before, h('mark', null, match), after),
            ),
          );
          index += 1;
        }
      });
      counter.textContent = `${hits.length} ${plural(hits.length, 'совпадение', 'совпадения', 'совпадений')} в ${groups.size} ${plural(groups.size, 'заметке', 'заметках', 'заметках')}`;
      highlight();
    };

    const highlight = (): void => {
      const rows = results.querySelectorAll<HTMLElement>('.gsearch__hit');
      rows.forEach((row, rowIndex) => row.classList.toggle('gsearch__hit--active', rowIndex === selected));
      rows[selected]?.scrollIntoView({ block: 'nearest' });
    };

    const open = (): void => {
      const hit = hits[selected];
      if (!hit) return;
      this.close();
      this.actions.openNote(hit.path, { line: hit.line, column: hit.column });
    };

    const search = async (): Promise<void> => {
      const query = input.value.trim();
      this.lastQuery = query;
      if (query.length < 2) {
        hits = [];
        renderResults();
        return;
      }
      results.appendChild(h('p', { class: 'gsearch__empty' }, 'Ищу…'));
      hits = await this.store.searchAll(query);
      selected = 0;
      renderResults();
    };

    let timer: number | undefined;
    input.addEventListener('input', () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void search(), 180);
    });

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selected = Math.min(selected + 1, Math.max(hits.length - 1, 0));
        highlight();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selected = Math.max(selected - 1, 0);
        highlight();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        open();
      }
    });

    if (this.lastQuery.trim().length >= 2) void search();
    else renderResults();
  }

  close(): void {
    const host = document.getElementById('overlay');
    if (!host || !this.overlay) return;
    this.disposeBackdrop?.();
    this.disposeBackdrop = null;
    host.classList.remove('overlay--visible');
    clear(host);
    this.overlay = null;
  }
}

function parentFolder(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.join(' / ');
}
