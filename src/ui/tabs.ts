import type { Store } from '../store';
import { clear, h } from '../util';
import { icon } from './icons';
import type { AppActions } from './actions';

/** Tab strip above the editor. Middle click or × closes, each tab keeps state. */
export class TabsView {
  constructor(
    private container: HTMLElement,
    private store: Store,
    private actions: AppActions,
  ) {}

  mount(): void {
    this.store.on('docs', () => this.render());
    this.store.on('active', () => this.render());
    this.container.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      const tab = (event.target as HTMLElement).closest<HTMLElement>('.tab');
      if (!tab?.dataset.path) return;
      event.preventDefault();
      void this.close(tab.dataset.path);
    });
    this.render();
  }

  render(): void {
    clear(this.container);
    this.container.classList.toggle('tabs--empty', this.store.docs.length === 0);

    for (const doc of this.store.docs) {
      const isActive = this.store.activePath === doc.path;
      const isDirty = this.store.isDirty(doc);
      const tab = h(
        'div',
        {
          class: `tab${isActive ? ' tab--active' : ''}${isDirty ? ' tab--dirty' : ''}`,
          role: 'tab',
          'aria-selected': isActive ? 'true' : 'false',
          tabindex: isActive ? '0' : '-1',
          title: doc.path,
          dataset: { path: doc.path },
          onclick: () => this.store.activate(doc.path),
          onkeydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              this.store.activate(doc.path);
            }
          },
        },
        h('span', { class: 'tab__name' }, doc.name),
        h('span', { class: 'tab__state', 'aria-hidden': 'true' }, isDirty ? '•' : ''),
        h(
          'button',
          {
            class: 'tab__close',
            type: 'button',
            'aria-label': `Закрыть ${doc.name}`,
            title: 'Закрыть (Ctrl+W)',
            onclick: (event: MouseEvent) => {
              event.stopPropagation();
              void this.close(doc.path);
            },
          },
          icon('close', 12),
        ),
      );
      this.container.appendChild(tab);
    }

    this.container.appendChild(
      h(
        'button',
        {
          class: 'tabs__add',
          type: 'button',
          title: 'Новая заметка (Ctrl+N)',
          'aria-label': 'Новая заметка',
          onclick: () => this.actions.createNote(),
        },
        icon('plus', 14),
      ),
    );
  }

  private async close(path: string): Promise<void> {
    await this.store.closeDoc(path);
  }
}
