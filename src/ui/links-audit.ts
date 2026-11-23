import type { BrokenLink, Store } from '../store';
import type { AppActions } from './actions';
import { h } from '../util';
import { openModal, showToast } from './dialog';
import { icon } from './icons';

/**
 * Workspace-wide broken `[[…]]` links. The scan runs when the panel opens and
 * can be repeated with the refresh button; creating a note uses the same flow as
 * clicking a missing link in the preview.
 */
export function openBrokenLinksPanel(
  store: Store,
  actions: AppActions,
  createNote: (target: string) => Promise<unknown>,
): void {
  openModal((close) => {
    const body = h('div', { class: 'history__body' });
    const count = h('span', { class: 'history__subtitle' }, '');
    const refresh = h(
      'button',
      {
        class: 'btn btn--sm',
        type: 'button',
        onclick: () => void render(),
      },
      'Проверить снова',
    ) as HTMLButtonElement;

    const render = async (): Promise<void> => {
      refresh.disabled = true;
      body.replaceChildren(h('p', { class: 'history__empty' }, 'Сканирую заметки…'));
      const links = await store.findBrokenLinks();
      count.textContent = links.length ? `Найдено: ${links.length}` : 'Битых ссылок нет';
      body.replaceChildren();
      refresh.disabled = false;

      if (!links.length) {
        body.appendChild(
          h('p', { class: 'history__empty' }, 'Все ссылки [[…]] указывают на существующие заметки.'),
        );
        return;
      }

      for (const link of links) {
        body.appendChild(renderRow(link, close));
      }
    };

    const renderRow = (link: BrokenLink, closePanel: () => void): HTMLElement => {
      const row = h(
        'div',
        { class: 'history__row' },
        h(
          'span',
          { class: 'history__main' },
          h('span', { class: 'history__time' }, link.target),
          h('span', { class: 'history__meta' }, `${link.sourceName} · строка ${link.line}`),
        ),
      );

      const actionsRow = h('span', { class: 'history__actions' });
      actionsRow.appendChild(
        h(
          'button',
          {
            class: 'btn btn--sm',
            type: 'button',
            onclick: () => {
              closePanel();
              void actions.openNote(link.sourcePath);
            },
          },
          'Открыть',
        ),
      );
      actionsRow.appendChild(
        h(
          'button',
          {
            class: 'btn btn--sm',
            type: 'button',
            onclick: () => {
              void (async () => {
                await createNote(link.target);
                closePanel();
                showToast('Проверьте список: ссылка могла стать рабочей', 'info');
              })();
            },
          },
          'Создать',
        ),
      );
      row.appendChild(actionsRow);
      return row;
    };

    void render();

    return h(
      'div',
      { class: 'history', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Битые ссылки' },
      h(
        'header',
        { class: 'history__head' },
        h('h2', { class: 'history__title' }, 'Битые ссылки'),
        count,
        h(
          'button',
          {
            class: 'history__close',
            type: 'button',
            title: 'Закрыть (Esc)',
            'aria-label': 'Закрыть битые ссылки',
            onclick: () => close(),
          },
          icon('close', 14),
        ),
      ),
      body,
      h('footer', { class: 'history__foot' }, refresh, h('button', {
        class: 'btn btn--primary',
        type: 'button',
        onclick: () => close(),
      }, 'Готово')),
    );
  });
}
