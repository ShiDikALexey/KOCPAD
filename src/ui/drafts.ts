import type { Store } from '../store';
import { draftPathOf } from '../drafts';
import { h } from '../util';
import { openModal, showToast } from './dialog';
import { icon } from './icons';

/**
 * Drafts panel: every locally stored draft, open in a tab or not. From here a
 * draft can be opened, saved into the workspace folder, or deleted.
 */
export function openDraftsPanel(store: Store, focusEditor?: () => void): void {
  // Inline two-step delete keeps the panel alive: opening a nested confirm modal
  // would clear the shared overlay and destroy this panel.
  let pendingDelete: string | null = null;

  openModal((close) => {
    const body = h('div', { class: 'drafts__body' });
    const footer = h('div', { class: 'drafts__foot' });

    const render = (): void => {
      const drafts = store.draftList;
      body.replaceChildren();
      footer.replaceChildren();

      if (!drafts.length) {
        body.appendChild(
          h(
            'p',
            { class: 'drafts__empty' },
            'Черновиков пока нет. Черновик — заметка без файла: нажмите Ctrl+N, она сохранится локально, пока вы не решите, куда её положить.',
          ),
        );
      }

      for (const draft of drafts) {
        const path = draftPathOf(draft.id);
        const isOpen = store.docs.some((doc) => doc.path === path);
        const isActive = store.activePath === path;
        const updated = new Date(draft.updatedAt);
        const when = `${updated.toLocaleDateString('ru-RU')} ${updated.toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        })}`;
        body.appendChild(
          h(
            'div',
            { class: `drafts__row${isActive ? ' drafts__row--active' : ''}` },
            h('span', { class: 'drafts__mark', 'aria-hidden': 'true' }, icon('file', 14)),
            h(
              'span',
              { class: 'drafts__main' },
              h('span', { class: 'drafts__title' }, draft.title || 'Без названия'),
              h('span', { class: 'drafts__meta' }, `${when} · ${isActive ? 'открыт в редакторе' : isOpen ? 'открыт в вкладке' : 'закрыт'}`),
            ),
            h(
              'span',
              { class: 'drafts__actions' },
              isActive
                ? h('span', { class: 'drafts__current' }, 'В редакторе')
                : h(
                    'button',
                    {
                      class: 'btn btn--sm',
                      type: 'button',
                      onclick: () => {
                        store.openDraft(draft.id);
                        close();
                        focusEditor?.();
                      },
                    },
                    isOpen ? 'Перейти' : 'Открыть',
                  ),
              h(
                'button',
                {
                  class: 'btn btn--sm',
                  type: 'button',
                  title: 'Сохранить в папку с заметками',
                  onclick: () => {
                    void saveDraft(path, draft.id);
                  },
                },
                'В папку…',
              ),
              h(
                'button',
                {
                  class: `btn btn--sm${pendingDelete === path ? ' btn--danger' : ' btn--icon-sm'}`,
                  type: 'button',
                  title: pendingDelete === path ? 'Нажмите ещё раз, чтобы удалить' : 'Удалить черновик',
                  'aria-label': pendingDelete === path ? 'Подтвердить удаление' : 'Удалить черновик',
                  onclick: () => {
                    if (pendingDelete !== path) {
                      pendingDelete = path;
                      render();
                      return;
                    }
                    void deleteDraft(path);
                  },
                },
                pendingDelete === path ? 'Удалить?' : icon('trash', 13),
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
            onclick: () => {
              void store.createDraftDoc();
              close();
            },
          },
          'Новый черновик',
        ),
      );
      footer.appendChild(
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => close() }, 'Готово'),
      );
    };

    const saveDraft = async (path: string, id: string): Promise<void> => {
      if (!store.storage.root) {
        showToast('Сначала подключите папку с заметками', 'info');
        close();
        return;
      }
      const target = await store.saveDraftToFolder(path, store.importDir);
      if (target) showToast(`Сохранено · ${target.split(/[\\/]/).pop()}`, 'success');
      else store.openDraft(id);
      render();
    };

    const deleteDraft = async (path: string): Promise<void> => {
      pendingDelete = null;
      await store.deleteDraftDoc(path);
      showToast('Черновик удалён');
      render();
    };

    render();

    return h(
      'div',
      { class: 'drafts', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Черновики' },
      h(
        'header',
        { class: 'drafts__head' },
        h('h2', { class: 'drafts__heading' }, 'Черновики'),
        h('span', { class: 'drafts__count' }, String(store.draftsCount)),
        h(
          'button',
          {
            class: 'drafts__close',
            type: 'button',
            title: 'Закрыть (Esc)',
            'aria-label': 'Закрыть черновики',
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
