import type { Store } from '../store';
import { clear, h } from '../util';
import type { AppActions } from './actions';

export interface Heading {
  level: number;
  text: string;
  line: number;
}

/** Removes inline markdown so an outline entry reads like a title. */
function cleanInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts ATX headings (`# Title`) while ignoring fenced code blocks, so a
 * `# comment` inside a shell snippet never shows up as a section.
 */
export function parseHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  const lines = markdown.split(/\r?\n/);
  let fence: string | null = null;

  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      return;
    }
    if (fence !== null) return;

    const match = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!match) return;
    const text = cleanInline(match[2]);
    if (!text) return;
    headings.push({ level: match[1].length, text, line: index + 1 });
  });

  return headings;
}

/** Sidebar section that lists the headings of the active note. */
export class OutlineView {
  private cursorLine = 1;

  constructor(
    private container: HTMLElement,
    private store: Store,
    private actions: AppActions,
  ) {}

  mount(): void {
    this.store.on('docs', () => this.render());
    this.store.on('active', () => {
      this.cursorLine = 1;
      this.render();
    });
    this.render();
  }

  setCursor(line: number): void {
    if (line === this.cursorLine) return;
    this.cursorLine = line;
    const rows = this.container.querySelectorAll<HTMLElement>('.outline__item');
    if (!rows.length) return;
    let activeIndex = 0;
    rows.forEach((row, index) => {
      const rowLine = Number(row.dataset.line ?? 0);
      if (rowLine <= this.cursorLine) activeIndex = index;
    });
    rows.forEach((row, index) => row.classList.toggle('outline__item--active', index === activeIndex));
  }

  render(): void {
    clear(this.container);
    const doc = this.store.activeDoc;

    if (!doc) {
      this.container.appendChild(h('p', { class: 'outline__empty' }, 'Откройте заметку, чтобы увидеть её структуру.'));
      return;
    }

    const headings = parseHeadings(doc.content);
    if (!headings.length) {
      this.container.appendChild(
        h(
          'div',
          { class: 'outline__empty' },
          h('p', null, 'В заметке нет заголовков.'),
          h('p', { class: 'outline__hint' }, 'Начните строку с «# » — она появится здесь.'),
        ),
      );
      return;
    }

    const list = h('div', { class: 'outline__list', role: 'tree', 'aria-label': 'Структура заметки' });
    const minLevel = Math.min(...headings.map((heading) => heading.level));

    for (const heading of headings) {
      const depth = heading.level - minLevel;
      list.appendChild(
        h(
          'button',
          {
            class: `outline__item outline__item--h${heading.level}`,
            type: 'button',
            title: `${heading.text} — строка ${heading.line}`,
            dataset: { line: String(heading.line) },
            style: `--outline-depth: ${depth}`,
            onclick: () => this.actions.jumpToLine(heading.line),
          },
          h('span', { class: 'outline__text' }, heading.text),
          h('span', { class: 'outline__line' }, String(heading.line)),
        ),
      );
    }

    this.container.appendChild(list);
    this.setCursor(this.cursorLine);
  }
}
