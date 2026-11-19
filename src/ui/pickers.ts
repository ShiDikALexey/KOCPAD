import { h } from '../util';
import { icon } from './icons';
import { openModal } from './dialog';

export interface FolderOption {
  path: string;
  label: string;
  depth: number;
}

/**
 * Folder chooser for bulk operations. Lists the workspace folders with
 * indentation, because moving notes should not require typing a path.
 */
export function folderPicker(options: { title: string; message?: string; folders: FolderOption[] }): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null, close: () => void): void => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };

    const modal = openModal((close) => {
      const list = h(
        'div',
        { class: 'folder-picker', role: 'listbox' },
        ...options.folders.map((folder) =>
          h(
            'button',
            {
              class: 'folder-picker__item',
              type: 'button',
              role: 'option',
              style: `--folder-depth: ${folder.depth}`,
              title: folder.path || folder.label,
              onclick: () => finish(folder.path, close),
            },
            icon(folder.depth === 0 ? 'folder' : 'folderOpen', 14),
            h('span', { class: 'folder-picker__label' }, folder.label),
          ),
        ),
      );
      return h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title },
        h('h2', { class: 'dialog__title' }, options.title),
        h('p', { class: 'dialog__message' }, options.message ?? 'Выберите папку внутри рабочей папки.'),
        list,
        h(
          'div',
          { class: 'dialog__actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => finish(null, close) }, 'Отмена'),
        ),
      );
    }, () => finish(null, modal.close));

    void modal;
  });
}
