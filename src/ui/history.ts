import type { Store } from '../store';
import { isDraftPath } from '../drafts';
import { h } from '../util';
import { openModal, showToast } from './dialog';
import {
  clearHistory,
  listSnapshots,
  readSnapshot,
  recordHistorySnapshot,
  type HistoryEntry,
} from '../history';
import { icon } from './icons';

function formatTime(savedAt: number): string {
  return new Date(savedAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} Б`;
  return `${Math.round(size / 1024)} КБ`;
}

/**
 * Version history for the active note. Snapshots are written by the store on
 * save; this panel only lists them and restores one on request.
 */
export function openHistoryPanel(store: Store, restore: (text: string) => void): void {
  const doc = store.activeDoc;
  if (!doc) {
    showToast('Откройте заметку, чтобы посмотреть историю', 'info');
    return;
  }
  if (isDraftPath(doc.path)) {
    showToast('История доступна для сохранённых заметок', 'info');
    return;
  }
  const path = doc.path;
  const noteName = doc.name;

  openModal((close) => {
    let pendingRestore: string | null = null;
    let pendingClear = false;
    const body = h('div', { class: 'history__body' });

    const render = async (): Promise<void> => {
      body.replaceChildren(h('p', { class: 'history__empty' }, 'Загружаю историю…'));
      const entries = await listSnapshots(path);
      body.replaceChildren();

      if (!entries.length) {
        body.appendChild(
          h(
            'p',
            { class: 'history__empty' },
            'Пока нет версий. Они появляются при сохранении заметки, но не чаще раза в пять минут.',
          ),
        );
        return;
      }

      for (const entry of entries) {
        const row = h('div', { class: 'history__row' });
        row.appendChild(
          h(
            'span',
            { class: 'history__main' },
            h('span', { class: 'history__time' }, formatTime(entry.savedAt)),
            h('span', { class: 'history__meta' }, formatSize(entry.size)),
          ),
        );

        const actions = h('span', { class: 'history__actions' });
        const preview = h('pre', { class: 'history__preview' });
        preview.hidden = true;
        let previewLoaded = false;

        const showButton = h(
          'button',
          { class: 'btn btn--sm', type: 'button' },
          'Показать',
        ) as HTMLButtonElement;
        showButton.addEventListener('click', () => {
          void (async () => {
            if (!previewLoaded) {
              const text = await readSnapshot(path, entry.id);
              previewLoaded = true;
              preview.textContent = text ?? 'Не удалось прочитать версию';
            }
            preview.hidden = !preview.hidden;
            showButton.textContent = preview.hidden ? 'Показать' : 'Скрыть';
          })();
        });

        const restoreButton = h(
          'button',
          { class: 'btn btn--sm', type: 'button' },
          pendingRestore === entry.id ? 'Точно?' : 'Восстановить',
        ) as HTMLButtonElement;
        restoreButton.addEventListener('click', () => {
          void (async () => {
            if (pendingRestore !== entry.id) {
              pendingRestore = entry.id;
              restoreButton.textContent = 'Точно?';
              return;
            }
            const text = await readSnapshot(path, entry.id);
            if (text === null) {
              showToast('Не удалось прочитать версию', 'error');
              return;
            }
            await recordHistorySnapshot(path, doc.content, { force: true });
            restore(text);
            close();
            showToast(`Версия от ${formatTime(entry.savedAt)} восстановлена`, 'success');
          })();
        });

        actions.append(showButton, restoreButton);
        row.appendChild(actions);
        body.appendChild(row);
        body.appendChild(preview);
      }
    };

    const clearButton = h(
      'button',
      { class: 'btn btn--sm', type: 'button' },
      'Очистить историю',
    ) as HTMLButtonElement;
    clearButton.addEventListener('click', () => {
      if (!pendingClear) {
        pendingClear = true;
        clearButton.textContent = 'Точно очистить?';
        return;
      }
      void (async () => {
        await clearHistory(path);
        pendingClear = false;
        clearButton.textContent = 'Очистить историю';
        await render();
      })();
    });

    const header = h(
      'header',
      { class: 'history__head' },
      h('h2', { class: 'history__title' }, 'История версий'),
      h('span', { class: 'history__subtitle' }, noteName),
      h(
        'button',
        {
          class: 'history__close',
          type: 'button',
          title: 'Закрыть (Esc)',
          'aria-label': 'Закрыть историю',
          onclick: () => close(),
        },
        icon('close', 14),
      ),
    );

    void render();

    return h(
      'div',
      { class: 'history', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'История версий' },
      header,
      body,
      h('footer', { class: 'history__foot' }, clearButton, h('button', {
        class: 'btn btn--primary',
        type: 'button',
        onclick: () => close(),
      }, 'Готово')),
    );
  });
}

/** Exposed for the e2e helper: list entries without opening the modal. */
export async function historyEntriesFor(path: string): Promise<HistoryEntry[]> {
  return listSnapshots(path);
}
