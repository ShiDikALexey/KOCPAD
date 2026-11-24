import type { Store } from '../store';
import type { SearchHit } from '../types';
import { clear, h, plural } from '../util';
import { icon } from './icons';
import { closeOnBackdrop, showToast } from './dialog';
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
  private previousFocus: HTMLElement | null = null;

  constructor(
    private store: Store,
    private actions: AppActions,
  ) {}

  open(): void {
    if (this.overlay) return;
    const host = document.getElementById('overlay');
    if (!host) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    this.previousFocus = previousFocus;
    const input = h('input', {
      class: 'gsearch__input',
      type: 'text',
      placeholder: 'Искать во всех заметках…',
      spellcheck: false,
      role: 'combobox',
      'aria-label': 'Поиск по всем заметкам',
      'aria-expanded': 'true',
      'aria-controls': 'gsearch-results',
      'aria-autocomplete': 'list',
      value: this.lastQuery,
    }) as HTMLInputElement;
    const results = h('div', { class: 'gsearch__results', id: 'gsearch-results' });
    const counter = h('span', { class: 'gsearch__count' });
    const regexButton = h(
      'button',
      {
        class: 'gsearch__regex',
        type: 'button',
        title: 'Регулярное выражение',
        'aria-label': 'Регулярное выражение',
        'aria-pressed': 'false',
      },
      '.*',
    ) as HTMLButtonElement;
    const replaceToggle = h(
      'button',
      {
        class: 'gsearch__replace-toggle',
        type: 'button',
        title: 'Заменить по всей папке',
        'aria-label': 'Заменить по всей папке',
        'aria-pressed': 'false',
      },
      'Заменить',
    ) as HTMLButtonElement;
    const replacementInput = h('input', {
      class: 'gsearch__replace-input',
      type: 'text',
      placeholder: 'Заменить на…',
      spellcheck: false,
      'aria-label': 'Чем заменить',
    }) as HTMLInputElement;
    const replaceButton = h(
      'button',
      { class: 'btn btn--sm', type: 'button' },
      'Заменить все',
    ) as HTMLButtonElement;
    const replaceRow = h(
      'div',
      { class: 'gsearch__replace' },
      replacementInput,
      replaceButton,
    );
    replaceRow.hidden = true;
    let regexMode = false;
    let replaceMode = false;
    let pendingReplace = false;
    const panel = h(
      'div',
      { class: 'gsearch', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Поиск по заметкам' },
      h(
        'div',
        { class: 'gsearch__head' },
        icon('search', 15),
        input,
        regexButton,
        replaceToggle,
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
      replaceRow,
      results,
      h(
        'div',
        { class: 'gsearch__foot' },
        counter,
        h('span', { class: 'gsearch__hint' }, 'Enter — перейти · .* — regex · Esc — закрыть'),
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
                id: `gsearch-hit-${rowIndex}`,
                tabindex: '-1',
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
      input.setAttribute('aria-activedescendant', `gsearch-hit-${selected}`);
    };

    const open = (): void => {
      const hit = hits[selected];
      if (!hit) return;
      this.close();
      this.actions.openNote(hit.path, { line: hit.line, column: hit.column });
    };

    // A slower earlier query must never overwrite the results of a newer one.
    let requestId = 0;

    const search = async (): Promise<void> => {
      const query = input.value.trim();
      const id = ++requestId;
      this.lastQuery = query;
      if (query.length < 2) {
        hits = [];
        renderResults();
        return;
      }
      if (regexMode) {
        try {
          new RegExp(query, 'iu');
        } catch {
          hits = [];
          clear(results);
          results.appendChild(h('p', { class: 'gsearch__empty' }, 'Некорректное регулярное выражение.'));
          counter.textContent = '';
          return;
        }
      }
      results.appendChild(h('p', { class: 'gsearch__empty' }, 'Ищу…'));
      const found = await this.store.searchAll(query, 300, { regex: regexMode });
      if (id !== requestId) return;
      hits = found;
      selected = 0;
      renderResults();
    };

    regexButton.addEventListener('click', () => {
      regexMode = !regexMode;
      regexButton.classList.toggle('is-active', regexMode);
      regexButton.setAttribute('aria-pressed', regexMode ? 'true' : 'false');
      void search();
    });

    replaceToggle.addEventListener('click', () => {
      replaceMode = !replaceMode;
      replaceRow.hidden = !replaceMode;
      replaceToggle.classList.toggle('is-active', replaceMode);
      replaceToggle.setAttribute('aria-pressed', replaceMode ? 'true' : 'false');
      if (replaceMode) {
        replacementInput.focus();
      } else {
        pendingReplace = false;
        replaceButton.textContent = 'Заменить все';
      }
    });

    replaceButton.addEventListener('click', () => {
      void (async () => {
        const query = input.value.trim();
        if (query.length < 2) {
          showToast('Введите запрос для замены', 'info');
          return;
        }
        if (!pendingReplace) {
          pendingReplace = true;
          replaceButton.textContent = 'Точно заменить?';
          return;
        }
        pendingReplace = false;
        replaceButton.textContent = 'Заменить все';
        const result = await this.store.replaceAll(query, replacementInput.value, {
          regex: regexMode,
        });
        showToast(
          result.matches
            ? `Заменено ${result.matches} ${plural(result.matches, 'совпадение', 'совпадения', 'совпадений')} в ${result.files} ${plural(result.files, 'заметке', 'заметках', 'заметках')} · версии в истории`
            : 'Совпадений для замены нет',
          result.matches ? 'success' : 'info',
        );
        await search();
      })();
    });

    let timer: number | undefined;
    input.addEventListener('input', () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void search(), 180);
    });

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        // Keep Tab inside the search dialog instead of walking the page behind.
        event.preventDefault();
        input.focus();
        return;
      }
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
    if (this.previousFocus && document.contains(this.previousFocus)) this.previousFocus.focus();
    this.previousFocus = null;
  }
}

function parentFolder(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.join(' / ');
}
