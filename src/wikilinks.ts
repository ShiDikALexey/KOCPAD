/**
 * Wiki links: `[[Заметка]]` and `[[Заметка|текст ссылки]]`.
 *
 * The target is a note title (file name without extension) or a path inside the
 * workspace. Links are resolved case-insensitively; unresolved ones stay visible
 * but marked so the reader sees a typo instead of a dead link.
 */

const LINK_PATTERN = /\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/g;

export interface WikiTarget {
  /** What the markdown says, trimmed. */
  target: string;
  /** Optional display text after `|`. */
  alias: string | null;
}

/** Strips a `.md` suffix and extra spaces, keeps the original case. */
export function normalizeLinkTarget(raw: string): string {
  return raw.trim().replace(/\.(md|markdown|mdown|txt)$/i, '').replace(/\s+/g, ' ').trim();
}

function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, '');
}

/**
 * Extracts links from a document, ignoring fenced code blocks and inline code so
 * an example like `[[заметка]]` inside a snippet does not become a real link.
 */
export function extractWikiLinks(text: string): WikiTarget[] {
  const found: WikiTarget[] = [];
  const seen = new Set<string>();
  let fence: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const fenceMatch = rawLine.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const line = stripInlineCode(rawLine);
    for (const match of line.matchAll(LINK_PATTERN)) {
      const target = normalizeLinkTarget(match[1]);
      if (!target) continue;
      const key = target.toLocaleLowerCase('ru') + '|' + (match[2]?.trim() ?? '');
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ target, alias: match[2]?.trim() || null });
    }
  }

  return found;
}

export function extractWikiTargets(text: string): string[] {
  return extractWikiLinks(text).map((link) => link.target);
}

type Resolver = (target: string) => { name: string; path: string } | null;

/**
 * Rewrites `[[...]]` inside already-rendered HTML into anchors.
 * Only text nodes outside `pre`, `code` and existing links are touched.
 */
export function decorateWikiLinks(container: HTMLElement, resolve: Resolver): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('pre, code, a, script, style')) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue?.includes('[[')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  for (const node of nodes) {
    const text = node.nodeValue ?? '';
    LINK_PATTERN.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = LINK_PATTERN.exec(text)) !== null) {
      const [whole, rawTarget, rawAlias] = match;
      fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const target = normalizeLinkTarget(rawTarget);
      const resolved = target ? resolve(target) : null;
      const label = rawAlias?.trim() || target;
      const element = document.createElement(resolved ? 'a' : 'span');
      element.className = resolved ? 'wikilink' : 'wikilink wikilink--missing';
      element.textContent = label;
      element.setAttribute('data-target', target);
      if (resolved) {
        element.setAttribute('href', '#');
        element.setAttribute('title', resolved.path);
      } else {
        element.setAttribute('title', `Заметка не найдена: ${target}`);
      }
      fragment.appendChild(element);
      cursor = match.index + whole.length;
    }

    if (cursor === 0) continue;
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }
}
