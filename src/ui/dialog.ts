import { clear, h } from '../util';

/** Small modal / toast primitives shared by the whole UI. */

function overlayRoot(): HTMLElement {
  const node = document.getElementById('overlay');
  if (!node) throw new Error('overlay container is missing');
  return node;
}

interface ModalHandle {
  close: () => void;
  root: HTMLElement;
}

/** Opens a modal overlay and lets the caller render its content. */
export function openModal(build: (close: () => void) => HTMLElement, onEscape?: () => void): ModalHandle {
  const root = overlayRoot();
  const previousFocus = document.activeElement as HTMLElement | null;
  let closed = false;
  let content: HTMLElement;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    root.removeEventListener('mousedown', onBackdrop);
    root.classList.remove('overlay--visible');
    clear(root);
    // Return focus where it was before the modal opened.
    if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
  };
  /** A click on the dimmed area outside the panel dismisses the modal. */
  const onBackdrop = (event: MouseEvent): void => {
    if (event.target !== root) return;
    onEscape?.();
    close();
  };
  const focusable = (): HTMLElement[] =>
    [...content.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null);
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape?.();
      close();
      return;
    }
    // Keep Tab inside the dialog: a modal must not let the caret escape behind it.
    if (event.key === 'Tab') {
      const items = focusable();
      const active = document.activeElement as HTMLElement | null;
      if (!items.length) {
        event.preventDefault();
        content.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !active || !content.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('mousedown', onBackdrop);
  root.classList.add('overlay--visible');
  clear(root);
  content = build(close);
  content.tabIndex = -1;
  root.appendChild(content);
  window.setTimeout(() => content.focus(), 0);
  return { close, root: content };
}

/**
 * Dismisses a custom overlay panel when the dimmed area around it is clicked.
 * Returns a disposer that the panel must call when it closes.
 */
export function closeOnBackdrop(host: HTMLElement, close: () => void): () => void {
  const onPointer = (event: MouseEvent): void => {
    if (event.target === host) close();
  };
  host.addEventListener('mousedown', onPointer);
  return () => host.removeEventListener('mousedown', onPointer);
}

export interface PromptOptions {  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Returns an error message, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
}

/** Single-line text dialog. Resolves to null when cancelled. */
export function promptText(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null, close: () => void): void => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };

    const modal = openModal((close) => {
      const error = h('p', { class: 'dialog__error', id: 'dialog-error', role: 'alert' });
      const input = h('input', {
        class: 'dialog__input',
        id: 'dialog-input',
        type: 'text',
        value: options.value ?? '',
        placeholder: options.placeholder ?? '',
        spellcheck: false,
        'aria-describedby': 'dialog-error',
      }) as HTMLInputElement;

      const submit = (): void => {
        const value = input.value.trim();
        const message = options.validate?.(value) ?? (value ? null : 'Введите значение');
        if (message) {
          error.textContent = message;
          input.classList.add('dialog__input--invalid');
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        finish(value, close);
      };

      input.addEventListener('input', () => {
        error.textContent = '';
        input.classList.remove('dialog__input--invalid');
        input.removeAttribute('aria-invalid');
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      });

      window.setTimeout(() => {
        input.focus();
        const dot = input.value.lastIndexOf('.');
        input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
      }, 20);

      return h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title },
        h('h2', { class: 'dialog__title' }, options.title),
        options.label ? h('label', { class: 'dialog__label', for: 'dialog-input' }, options.label) : null,
        input,
        error,
        h(
          'div',
          { class: 'dialog__actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => finish(null, close) }, 'Отмена'),
          h('button', { class: 'btn btn--primary', type: 'button', onclick: submit }, options.confirmLabel ?? 'Готово'),
        ),
      );
    }, () => finish(null, modal.close));

    void modal;
  });
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** Yes/no dialog. Resolves to false when cancelled or dismissed. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean, close: () => void): void => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };

    const modal = openModal((close) => {
      const confirmButton = h(
        'button',
        {
          class: `btn ${options.danger ? 'btn--danger' : 'btn--primary'}`,
          type: 'button',
          onclick: () => finish(true, close),
        },
        options.confirmLabel ?? 'Подтвердить',
      );
      window.setTimeout(() => confirmButton.focus(), 20);
      return h(
        'div',
        { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': options.title },
        h('h2', { class: 'dialog__title' }, options.title),
        h('p', { class: 'dialog__message' }, options.message),
        h(
          'div',
          { class: 'dialog__actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => finish(false, close) }, 'Отмена'),
          confirmButton,
        ),
      );
    }, () => finish(false, modal.close));

    void modal;
  });
}

export interface ChoiceOption {
  id: string;
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
}

export interface ChoiceOptions {
  title: string;
  message: string;
  options: ChoiceOption[];
  /** Optional lines under the message, e.g. what exactly will happen. */
  details?: string[];
}

/**
 * A dialog with more than two answers — used for the "save before closing"
 * question, which has three real options and a cancel.
 * Resolves to the chosen id, or null when dismissed.
 */
export function choiceDialog(options: ChoiceOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null, close: () => void): void => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };

    const modal = openModal((close) => {
      const actions = h(
        'div',
        { class: 'dialog__actions dialog__actions--trio' },
        ...options.options.map((option) =>
          h(
            'button',
            {
              class: `btn ${option.kind === 'primary' ? 'btn--primary' : option.kind === 'danger' ? 'btn--danger' : ''}`,
              type: 'button',
              onclick: () => finish(option.id, close),
            },
            option.label,
          ),
        ),
      );
      window.setTimeout(() => actions.querySelector<HTMLButtonElement>('.btn--primary')?.focus(), 20);

      return h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title },
        h('h2', { class: 'dialog__title' }, options.title),
        h('p', { class: 'dialog__message' }, options.message),
        options.details?.length
          ? h('ul', { class: 'dialog__details' }, ...options.details.map((line) => h('li', null, line)))
          : null,
        actions,
      );
    }, () => finish(null, modal.close));

    void modal;
  });
}

export interface MenuItem {
  label?: string;
  hint?: string;
  danger?: boolean;
  /** Renders a thin line instead of an item. */
  separator?: boolean;
  /** Items in this group are laid out in two columns to keep the menu short. */
  group?: 'columns';
  onClick?: () => void;
}

interface ActiveMenu {
  key?: string;
  close: () => void;
}

let activeMenu: ActiveMenu | null = null;

/** Closes the open menu, if there is one. */
export function closeMenu(): void {
  const menu = activeMenu;
  activeMenu = null;
  menu?.close();
}

/**
 * Context menu anchored to an element. Closes on outside click or Escape.
 * Passing the same `key` twice toggles: the second call closes the menu.
 */
export function showMenu(
  anchor: { x: number; y: number },
  items: MenuItem[],
  options: { key?: string; anchorElement?: HTMLElement } = {},
): void {
  if (options.key && activeMenu?.key === options.key) {
    closeMenu();
    return;
  }
  closeMenu();

  const children: HTMLElement[] = [];
  let bucket: HTMLElement | null = null;

  const flush = (): void => {
    bucket = null;
  };

  const renderItem = (item: MenuItem): HTMLElement => {
    const title = [item.label, item.hint].filter(Boolean).join(' · ');
    return h(
      'button',
      {
        class: `menu__item${item.danger ? ' menu__item--danger' : ''}`,
        type: 'button',
        role: 'menuitem',
        title,
        'aria-label': item.label ?? '',
        onclick: () => {
          close();
          item.onClick?.();
        },
      },
      h('span', { class: 'menu__label' }, item.label ?? ''),
      item.hint ? h('span', { class: 'menu__hint' }, item.hint) : null,
    );
  };

  for (const item of items) {
    if (item.separator) {
      flush();
      children.push(h('div', { class: 'menu__sep', role: 'separator' }));
      continue;
    }
    if (item.group === 'columns') {
      if (!bucket) {
        bucket = h('div', { class: 'menu__group menu__group--columns', role: 'group' });
        children.push(bucket);
      }
      bucket.appendChild(renderItem(item));
      continue;
    }
    flush();
    children.push(renderItem(item));
  }

  const menu = h('div', { class: 'menu', role: 'menu' }, ...children);
  document.body.appendChild(menu);

  function cleanup(): void {
    document.removeEventListener('click', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function close(): void {
    cleanup();
    menu.remove();
    if (activeMenu?.close === close) activeMenu = null;
  }

  activeMenu = { key: options.key, close };

  // Keyboard: arrows move between items, Home/End jump, Enter activates, Esc closes.
  const menuItems = (): HTMLElement[] =>
    [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  menu.addEventListener('keydown', (event) => {
    const list = menuItems();
    if (!list.length) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? list.indexOf(active) : -1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        list[(index + 1 + list.length) % list.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        list[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        list[list.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      default:
        break;
    }
  });
  window.setTimeout(() => menuItems()[0]?.focus(), 0);

  const rect = menu.getBoundingClientRect();
  const x = Math.min(anchor.x, window.innerWidth - rect.width - 8);
  const y = Math.min(anchor.y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;

  // A click, not mousedown: the anchor button's own handler runs first, so
  // clicking the same button toggles the menu instead of reopening it.
  const onPointer = (event: MouseEvent): void => {
    const target = event.target as Node;
    // The button that opened the menu handles its own toggle.
    if (options.anchorElement?.contains(target)) return;
    if (!menu.contains(target)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  window.setTimeout(() => {
    document.addEventListener('click', onPointer, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
}

export type ToastKind = 'info' | 'success' | 'error';

/** Transient message in the bottom-right corner. */
export function showToast(message: string, kind: ToastKind = 'info'): void {
  const container = document.getElementById('toasts');
  if (!container) return;
  const toast = h(
    'div',
    { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast__text' }, message),
    h('button', {
      class: 'toast__close',
      type: 'button',
      'aria-label': 'Закрыть',
      onclick: () => toast.remove(),
    }, '×'),
  );
  container.appendChild(toast);
  window.setTimeout(() => toast.classList.add('toast--in'), 10);
  window.setTimeout(() => {
    toast.classList.remove('toast--in');
    window.setTimeout(() => toast.remove(), 220);
  }, kind === 'error' ? 6000 : 3200);
}
