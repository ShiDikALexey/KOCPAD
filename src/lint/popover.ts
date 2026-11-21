import type { LintDiagnostic } from './engine';

export interface LintPopoverHandlers {
  onFix: () => void;
  onIgnore: () => void;
  onDisable: () => void;
}

/**
 * Small anchored popover for one suggestion. It deliberately is not a modal:
 * the user keeps the text in view while deciding what to do.
 */
export function showLintPopover(
  anchor: { x: number; y: number },
  diagnostic: LintDiagnostic,
  handlers: LintPopoverHandlers,
): () => void {
  closeLintPopover();

  const element = document.createElement('div');
  element.className = 'lint-popover';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', 'Подсказка помощника');
  element.dataset.rule = diagnostic.rule;

  const title = document.createElement('div');
  title.className = 'lint-popover__message';
  title.textContent = diagnostic.message;

  element.appendChild(title);

  if (diagnostic.preview) {
    const preview = document.createElement('pre');
    preview.className = 'lint-popover__preview';
    preview.textContent = diagnostic.preview;
    element.appendChild(preview);
  }

  const actions = document.createElement('div');
  actions.className = 'lint-popover__actions';

  const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = label;
    node.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return node;
  };

  actions.appendChild(button('Исправить', 'btn btn--sm btn--primary', () => {
    close();
    handlers.onFix();
  }));
  actions.appendChild(button('Игнорировать', 'btn btn--sm', () => {
    close();
    handlers.onIgnore();
  }));
  actions.appendChild(button('Больше не предлагать', 'btn btn--sm', () => {
    close();
    handlers.onDisable();
  }));
  element.appendChild(actions);

  document.body.appendChild(element);

  const rect = element.getBoundingClientRect();
  const x = Math.min(Math.max(8, anchor.x), window.innerWidth - rect.width - 8);
  const y = Math.min(Math.max(8, anchor.y), window.innerHeight - rect.height - 8);
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;

  const onPointer = (event: MouseEvent): void => {
    if (!element.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  window.setTimeout(() => {
    document.addEventListener('mousedown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);

  function close(): void {
    document.removeEventListener('mousedown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    element.remove();
    if (activePopover === close) activePopover = null;
  }

  activePopover = close;
  return close;
}

let activePopover: (() => void) | null = null;

export function closeLintPopover(): void {
  const close = activePopover;
  activePopover = null;
  close?.();
}
