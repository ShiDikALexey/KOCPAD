/**
 * Inline tags: `#тег` anywhere in a note.
 *
 * A tag starts with `#` at the beginning of a line or after whitespace/an opening
 * bracket, then letters, digits, `_`, `-` and `/` (so `#работа/проект` works).
 * Fenced code blocks and inline code spans are ignored: `#fff` in a CSS example is
 * not a tag.
 */

const TAG_PATTERN = /(?:^|[\s(«"'])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

/** Lowercased comparison key; the first spelling seen is used for display. */
export function tagKey(tag: string): string {
  return tag.toLocaleLowerCase('ru');
}

function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, '');
}

/** Returns the tags of one document, without duplicates. */
export function extractTags(text: string): string[] {
  const found = new Set<string>();
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
    for (const match of line.matchAll(TAG_PATTERN)) {
      const tag = match[1].replace(/[./-]+$/, '');
      if (tag) found.add(tag);
    }
  }

  return [...found];
}

export interface TagSummary {
  /** Display form: the first spelling that was found. */
  tag: string;
  /** Lowercased key, used for filtering and comparisons. */
  key: string;
  count: number;
  paths: string[];
}
