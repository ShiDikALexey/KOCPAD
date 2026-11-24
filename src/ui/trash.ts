import type { Store } from '../store';
import { trash, TRASH_RETENTION_DAYS, type TrashEntry } from '../trash';
import { h } from '../util';
import { openModal, showToast } from './dialog';
import { icon } from './icons';

/**
 * Trash panel: notes deleted by mistake stay here for 30 days and can be
 * restored from where they came. Same visual language as the drafts panel.
 */
export function openTrashPanel(store: Store): void {
  let pendingDelete: string | null = null;
  let clearArmed = false;

  openModal((close) => {
    const body = h('div', { class: 'drafts__body' });
    const footer = h('div', { class: 'drafts__foot' });

    const daysLeft = (entry: TrashEntry): number => {
      const age = Date.now() - entry.deletedAt;
      const left = TRASH_RETENTION_DAYS - Math.floor(age / (24 * 60 * 60 * 1000));
      return Math.max(0, left);
    };

    const restore = async (entry: TrashEntry): Promise<void> => {
      const target = await trash.restore(entry.id, store.storage);
      if (!target) {
        showToast('Не удалось восстановить заметку', 'error');
        return;
      }
      await store.refreshTree();
      const restored = await store.openNote(target).catch(() => null);
      if (restored) editorFocus();
      showToast(`Восстановлено · ${target.split(/[\\/]/).pop()}`);
      if (isOpen()) render();
    };

    const removeForever = async (entry: TrashEntry): Promise<void> => {
      pendingDelete = null;
      await trash.remove(entry.id);
      showToast('Удалено навсегда');
      render();
    };

    const isOpen = (): boolean => document.body.contains(body);

    const render = async (): Promise<void> => {
      const entries = await trash.list();
      body.replaceChildren();
      footer.replaceChildren();

      if (!entries.length) {
        body.appendChild(
          h(
            'p',
            { class: 'drafts__empty' },
            'Корзина пуста. Удалённые заметки хранятся здесь 30 дней — их можно восстановить, пока не истёк срок.',
          ),
        );
      }

      for (const entry of entries) {
        const when = new Date(entry.deletedAt);
        const date = `${when.toLocaleDateString('ru-RU')} ${when.toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        })}`;
        const left = daysLeft(entry);
        body.appendChild(
          h(
            'div',
            { class: 'drafts__row' },
            h('span', { class: 'drafts__mark', 'aria-hidden': 'true' }, icon('file', 14)),
            h(
              'span',
              { class: 'drafts__main' },
              h('span', { class: 'drafts__title' }, entry.name || 'Заметка'),
              h(
                'span',
                { class: 'drafts__meta' },
                `${entry.originalPath} · удалено ${date} · осталось ${left} дн.`,
              ),
            ),
            h(
              'span',
              { class: 'drafts__actions' },
              h(
                'button',
                {
                  class: 'btn btn--sm',
                  type: 'button',
                  onclick: () => {
                    void restore(entry);
                  },
                },
                'Восстановить',
              ),
              h(
                'button',
                {
                  class: `btn btn--sm${pendingDelete === entry.id ? ' btn--danger' : ' btn--icon-sm'}`,
                  type: 'button',
                  title: pendingDelete === entry.id ? 'Нажмите ещё раз, чтобы удалить навсегда' : 'Удалить навсегда',
                  'aria-label':
                    pendingDelete === entry.id ? 'Подтвердить удаление навсегда' : 'Удалить навсегда',
                  onclick: () => {
                    if (pendingDelete !== entry.id) {
                      pendingDelete = entry.id;
                      void render();
                      return;
                    }
                    void removeForever(entry);
                  },
                },
                pendingDelete === entry.id ? 'Удалить?' : icon('trash', 13),
              ),
            ),
          ),
        );
      }

      footer.appendChild(
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: async () => {
              const entries = await trash.list();
              if (!entries.length) return;
              if (!clearArmed) {
                clearArmed = true;
                void render();
                return;
              }
              clearArmed = false;
              for (const entry of entries) await trash.remove(entry.id);
              showToast('Корзина очищена');
              void render();
              await store.refreshTree();
            },
          },
          clearArmed ? 'Точно очистить?' : 'Очистить',
        ),
      );
      footer.appendChild(
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => close() }, 'Готово'),
      );
    };

    void render();

    return h(
      'div',
      { class: 'drafts', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Корзина' },
      h(
        'header',
        { class: 'drafts__head' },
        h('h2', { class: 'drafts__heading' }, 'Корзина'),
        h('span', { class: 'drafts__count' }, `хранится ${TRASH_RETENTION_DAYS} дн.`),
        h(
          'button',
          {
            class: 'drafts__close',
            type: 'button',
            title: 'Закрыть (Esc)',
            'aria-label': 'Закрыть корзину',
            onclick: () => close(),
          },
          icon('close', 14),
        ),
      ),
      body,
      footer,
    );
  });
}

/** Kept tiny so the panel does not import the whole editor module. */
function editorFocus(): void {
  document.querySelector<HTMLElement>('.cm-content')?.focus();
}
