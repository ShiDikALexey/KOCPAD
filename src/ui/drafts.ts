import type { Store } from '../store';
import { draftPathOf } from '../drafts';
import { h } from '../util';
import { confirmAction, openModal, showToast } from './dialog';
import { icon } from './icons';
import type { AppActions } from './actions';

/**
 * Drafts panel: every locally stored draft, open in a tab or not. From here a
 * draft can be opened, saved into the workspace folder, or deleted.
 */
export function openDraftsPanel(store: Store, actions: AppActions): void {
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
        const updated = new Date(draft.updatedAt);
        const when = `${updated.toLocaleDateString('ru-RU')} ${updated.toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        })}`;
        body.appendChild(
          h(
            'div',
            { class: 'drafts__row' },
            h('span', { class: 'drafts__mark', 'aria-hidden': 'true' }, icon('file', 14)),
            h(
              'span',
              { class: 'drafts__main' },
              h('span', { class: 'drafts__title' }, draft.title || 'Без названия'),
              h('span', { class: 'drafts__meta' }, `${when} · ${isOpen ? 'открыт в вкладке' : 'закрыт'}`),
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
                    store.openDraft(draft.id);
                    close();
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
                  class: 'btn btn--sm btn--icon-sm',
                  type: 'button',
                  title: 'Удалить черновик',
                  'aria-label': 'Удалить черновик',
                  onclick: () => {
                    void deleteDraft(path);
                  },
                },
                icon('trash', 13),
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
              void actions.createNote();
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
      const draft = store.draftList.find((item) => draftPathOf(item.id) === path);
      const confirmed = await confirmAction({
        title: 'Удалить черновик?',
        message: `«${draft?.title ?? 'Черновик'}» хранится только локально. При удалении текст пропадёт.`,
        confirmLabel: 'Удалить',
        danger: true,
      });
      if (!confirmed) return;
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
