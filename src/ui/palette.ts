import { clear, h } from '../util';
import { icon } from './icons';
import { closeOnBackdrop } from './dialog';

export interface Command {
  /** Optional stable identifier, useful when commands are generated. */
  id?: string;
  label: string;
  /** Optional hint shown on the right, usually a keybinding. */
  hint?: string;
  group?: string;
  run: () => void;
}

/** Subsequence match used by the palette: "вкл" matches "Вкл/выкл тему". */
function matches(label: string, query: string): boolean {
  if (!query) return true;
  const haystack = label.toLowerCase();
  let index = 0;
  for (const char of query.toLowerCase()) {
    index = haystack.indexOf(char, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

/**
 * Command palette (Ctrl+K).
 *
 * Keyboard-first: type to filter, arrows to move, Enter to run. It is the fast
 * path to every action for people who never reach for the mouse.
 */
export function openPalette(commands: Command[]): void {
  if (document.querySelector('.palette')) return;
  const overlay = document.getElementById('overlay');
  if (!overlay) return;

  let active = 0;
  let filtered = commands.slice();

  const input = h('input', {
    class: 'palette__input',
    type: 'text',
    placeholder: 'Команда или действие…',
    spellcheck: false,
    'aria-label': 'Палитра команд',
  }) as HTMLInputElement;
  const list = h('div', { class: 'palette__list', role: 'listbox' });
  const root = h(
    'div',
    { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Палитра команд' },
    h('div', { class: 'palette__search' }, icon('command', 15), input),
    list,
    h('div', { class: 'palette__foot' }, h('kbd', null, '↑↓'), ' выбрать', h('kbd', null, 'Enter'), ' выполнить',
      h('kbd', null, 'Esc'), ' закрыть'),
  );

  let disposeBackdrop: (() => void) | null = null;

  const close = (): void => {
    disposeBackdrop?.();
    disposeBackdrop = null;
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.remove('overlay--visible');
    clear(overlay);
  };

  const runActive = (): void => {
    const command = filtered[active];
    if (!command) return;
    close();
    command.run();
  };

  const render = (): void => {
    clear(list);
    if (!filtered.length) {
      list.appendChild(h('p', { class: 'palette__empty' }, 'Ничего не найдено'));
      return;
    }
    active = Math.min(active, filtered.length - 1);
    filtered.forEach((command, index) => {
      list.appendChild(
        h(
          'button',
          {
            class: `palette__item${index === active ? ' palette__item--active' : ''}`,
            type: 'button',
            role: 'option',
            'aria-selected': index === active ? 'true' : 'false',
            onmouseenter: () => {
              active = index;
              render();
            },
            onclick: () => {
              active = index;
              runActive();
            },
          },
          h('span', { class: 'palette__label' }, command.label),
          command.hint ? h('kbd', { class: 'palette__hint' }, command.hint) : null,
        ),
      );
    });
    const node = list.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = (active + 1) % Math.max(filtered.length, 1);
      render();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active - 1 + filtered.length) % Math.max(filtered.length, 1);
      render();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      runActive();
    }
  };

  input.addEventListener('input', () => {
    filtered = commands.filter((command) => matches(command.label, input.value.trim()));
    active = 0;
    render();
  });

  overlay.classList.add('overlay--visible');
  clear(overlay);
  overlay.appendChild(root);
  disposeBackdrop = closeOnBackdrop(overlay, close);
  render();
  input.focus();
  document.addEventListener('keydown', onKey, true);
}
