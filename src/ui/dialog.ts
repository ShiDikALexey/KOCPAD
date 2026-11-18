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

function openModal(build: (close: () => void) => HTMLElement, onEscape?: () => void): ModalHandle {
  const root = overlayRoot();
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    root.classList.remove('overlay--visible');
    clear(root);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape?.();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  root.classList.add('overlay--visible');
  clear(root);
  const content = build(close);
  root.appendChild(content);
  return { close, root: content };
}

export interface PromptOptions {
  title: string;
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
      const error = h('p', { class: 'dialog__error', role: 'alert' });
      const input = h('input', {
        class: 'dialog__input',
        type: 'text',
        value: options.value ?? '',
        placeholder: options.placeholder ?? '',
        spellcheck: false,
      }) as HTMLInputElement;

      const submit = (): void => {
        const value = input.value.trim();
        const message = options.validate?.(value) ?? (value ? null : 'Введите значение');
        if (message) {
          error.textContent = message;
          input.classList.add('dialog__input--invalid');
          input.focus();
          return;
        }
        finish(value, close);
      };

      input.addEventListener('input', () => {
        error.textContent = '';
        input.classList.remove('dialog__input--invalid');
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

export interface MenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}

/** Context menu anchored to an element. Closes on outside click or Escape. */
export function showMenu(anchor: { x: number; y: number }, items: MenuItem[]): void {
  document.querySelector('.menu')?.remove();
  const menu = h(
    'div',
    { class: 'menu', role: 'menu' },
    ...items.map((item) =>
      h(
        'button',
        {
          class: `menu__item${item.danger ? ' menu__item--danger' : ''}`,
          type: 'button',
          role: 'menuitem',
          onclick: () => {
            menu.remove();
            cleanup();
            item.onClick();
          },
        },
        h('span', { class: 'menu__label' }, item.label),
        item.hint ? h('span', { class: 'menu__hint' }, item.hint) : null,
      ),
    ),
  );
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const x = Math.min(anchor.x, window.innerWidth - rect.width - 8);
  const y = Math.min(anchor.y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;

  const onPointer = (event: MouseEvent): void => {
    if (!menu.contains(event.target as Node)) {
      menu.remove();
      cleanup();
    }
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      menu.remove();
      cleanup();
    }
  };
  function cleanup(): void {
    document.removeEventListener('mousedown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
  }
  window.setTimeout(() => {
    document.addEventListener('mousedown', onPointer, true);
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
