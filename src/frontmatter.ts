/**
 * Minimal front matter support.
 *
 * A note may start with a YAML-ish block:
 *
 * ```
 * ---
 * title: План на неделю
 * date: 2026-11-19
 * tags: [работа, план]
 * ---
 * ```
 *
 * KOCPAD is not a YAML parser on purpose: only `key: value`, comma or bracket
 * lists and quoted strings are understood. Unknown keys are shown as plain
 * metadata, so nothing is silently dropped.
 */

export interface FrontMatter {
  /** Parsed keys, lowercased. */
  data: Record<string, string | string[]>;
  /** Markdown without the front matter block. */
  body: string;
  /** The raw block, empty when the note has none. */
  raw: string;
}

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function cleanValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

function parseList(value: string): string[] | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(cleanValue)
      .filter(Boolean);
  }
  if (trimmed.includes(',')) {
    return trimmed.split(',').map(cleanValue).filter(Boolean);
  }
  return null;
}

export function splitFrontMatter(markdown: string): FrontMatter {
  const match = markdown.match(BLOCK);
  if (!match) return { data: {}, body: markdown, raw: '' };

  const data: Record<string, string | string[]> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-zА-Яа-яЁё0-9_-]+)\s*:\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1].toLocaleLowerCase('ru');
    const rawValue = pair[2].trim();
    if (!rawValue) continue;
    data[key] = parseList(rawValue) ?? cleanValue(rawValue);
  }

  return { data, body: markdown.slice(match[0].length), raw: match[0] };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Tags from front matter (`tags: [a, b]` or `tags: a, b` or `tags: a`). */
export function frontMatterTags(data: Record<string, string | string[]>): string[] {
  const raw = data['tags'] ?? data['теги'];
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim().replace(/^#/, ''))
    .filter(Boolean);
}

/** Metadata card shown above the rendered note. */
export function renderFrontMatterCard(data: Record<string, string | string[]>): string {
  const entries = Object.entries(data).filter(([key]) => !['tags', 'теги'].includes(key));
  const tags = frontMatterTags(data);
  if (!entries.length && !tags.length) return '';

  const title = data['title'] ?? data['заголовок'];
  const date = data['date'] ?? data['дата'];

  const parts: string[] = [];
  if (title && typeof title === 'string') {
    parts.push(`<span class="frontmatter__title">${escapeHtml(title)}</span>`);
  }
  if (date && typeof date === 'string') {
    parts.push(`<span class="frontmatter__date">${escapeHtml(date)}</span>`);
  }
  for (const [key, value] of entries) {
    if (['title', 'заголовок', 'date', 'дата'].includes(key)) continue;
    const text = Array.isArray(value) ? value.join(', ') : value;
    parts.push(`<span class="frontmatter__item"><b>${escapeHtml(key)}:</b> ${escapeHtml(text)}</span>`);
  }
  if (tags.length) {
    parts.push(
      `<span class="frontmatter__tags">${tags.map((tag) => `<span class="frontmatter__tag">#${escapeHtml(tag)}</span>`).join(' ')}</span>`,
    );
  }

  return `<div class="frontmatter">${parts.join('')}</div>`;
}
