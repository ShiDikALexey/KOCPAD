import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { renderFrontMatterCard, splitFrontMatter } from './frontmatter';
import type { ExportTheme } from './types';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Single newlines render as line breaks when enabled (the Notepad behaviour);
 * with `false`, markdown joins them into one paragraph.
 */
export function setSoftBreaks(enabled: boolean): void {
  marked.setOptions({ gfm: true, breaks: enabled });
}

const SANITIZE_CONFIG = {
  ADD_TAGS: ['input', 'mark', 'del', 'ins', 'details', 'summary', 'kbd', 'figure', 'figcaption', 's'],
  ADD_ATTR: ['checked', 'disabled', 'type', 'align', 'target', 'rel', 'colspan', 'rowspan', 'start', 'id'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
};

/** Renders markdown to sanitized HTML, with front matter as a metadata card. */
export function renderMarkdown(source: string): string {
  const { data, body } = splitFrontMatter(source);
  const card = renderFrontMatterCard(data);
  const raw = marked.parse(body) as string;
  const clean = DOMPurify.sanitize(card + raw, SANITIZE_CONFIG);
  return clean;
}

/**
 * Post-processes rendered HTML: syntax highlighting, external link markers and
 * task list classes. Runs after every render, on the live DOM.
 */
export function decoratePreview(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('pre code').forEach((block) => {
    try {
      hljs.highlightElement(block);
    } catch {
      // Unknown languages render unhighlighted; not worth surfacing.
    }
  });

  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const href = link.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.classList.add('external-link');
    } else if (href.startsWith('#')) {
      link.classList.add('anchor-link');
    }
  });

  container.querySelectorAll<HTMLInputElement>('li > input[type=checkbox]').forEach((box) => {
    box.classList.add('task-checkbox');
    box.disabled = false;
    box.removeAttribute('disabled');
    box.parentElement?.parentElement?.classList.add('task-list');
    box.closest('li')?.classList.add('task-item');
  });

  container.querySelectorAll('table').forEach((table) => {
    if (!table.parentElement?.classList.contains('table-wrap')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrap';
      table.replaceWith(wrapper);
      wrapper.appendChild(table);
    }
  });
}

/** Toggles the Nth task checkbox in the markdown source. */
export function toggleTaskAtIndex(source: string, index: number): string {
  let seen = 0;
  return source.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/gm, (match, head: string, mark: string, tail: string) => {
    if (seen === index) {
      seen += 1;
      return `${head}${mark.toLowerCase() === 'x' ? ' ' : 'x'}${tail}`;
    }
    seen += 1;
    return match;
  });
}

/** Document CSS shared by the HTML export and the print/PDF path. */
const DOCUMENT_CSS = `
:root {
  --ink: #15171c; --ink-muted: #555b66; --line: #ddd8ca; --accent: #b3801a;
  --code-bg: #f4f2ec; --quote-bar: #d9a62e;
  --c-keyword: #8a3ea8; --c-string: #2e7d4f; --c-comment: #7c8391;
  --c-number: #a3541c; --c-title: #1f5fa8; --c-type: #1f5fa8;
}
* { box-sizing: border-box; }
html { font-size: 17px; }
body {
  margin: 0 auto; padding: 56px 24px 96px; max-width: 46rem;
  background: #fdfcf9; color: var(--ink);
  font-family: "Sitka Text", "Charter", Georgia, "Times New Roman", serif;
  line-height: 1.65; text-rendering: optimizeLegibility;
}
h1, h2, h3, h4 { font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif;
  line-height: 1.25; letter-spacing: -0.011em; margin: 1.9em 0 0.55em; }
h1 { font-size: 1.9rem; margin-top: 0; }
h2 { font-size: 1.42rem; padding-bottom: 0.25em; border-bottom: 1px solid var(--line); }
h3 { font-size: 1.16rem; }
p, ul, ol, blockquote, pre, table { margin: 0 0 1.05em; }
ul, ol { padding-left: 1.35em; }
li + li { margin-top: 0.25em; }
a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
code, kbd { font-family: "Cascadia Mono", Consolas, monospace; font-size: 0.87em; }
:not(pre) > code { background: var(--code-bg); padding: 0.12em 0.36em; border-radius: 4px; }
pre { background: var(--code-bg); padding: 14px 16px; border-radius: 6px; overflow-x: auto; line-height: 1.5; }
pre code { font-size: 0.84em; }
blockquote { margin-left: 0; padding: 0.2em 0 0.2em 1.1em; border-left: 3px solid var(--quote-bar);
  color: var(--ink-muted); font-style: italic; }
hr { border: none; border-top: 1px solid var(--line); margin: 2.2em 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.94em;
  font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif; }
th, td { border: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; }
th { background: #f3f1ea; font-weight: 600; }
li.task-item { list-style: none; margin-left: -1.2em; }
li.task-item input { margin-right: 0.5em; accent-color: var(--accent); }
img { max-width: 100%; height: auto; }
del { color: var(--ink-muted); }
.wikilink { color: #8a6400; border-bottom: 1px dotted currentColor; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in { color: var(--c-keyword); }
.hljs-string, .hljs-attr, .hljs-symbol, .hljs-bullet { color: var(--c-string); }
.hljs-comment, .hljs-quote { color: var(--c-comment); font-style: italic; }
.hljs-number, .hljs-literal { color: var(--c-number); }
.hljs-title, .hljs-name, .hljs-section, .hljs-function .hljs-title { color: var(--c-title); }
.hljs-type, .hljs-class .hljs-title, .hljs-params { color: var(--c-type); }
@media print {
  html { font-size: 11.5pt; }
  body { padding: 0; background: #fff; max-width: none; }
  h1, h2, h3 { break-after: avoid; }
  pre, blockquote, table, img { break-inside: avoid; }
  a { text-decoration: none; }
  @page { margin: 20mm 18mm; }
}
`;

/** Extra palette for dark exports and printouts. */
const DARK_DOCUMENT_CSS = `
:root {
  --ink: #e8eaed; --ink-muted: #9aa2ad; --line: #2a313b; --accent: #f0c243;
  --code-bg: #1a1f26; --quote-bar: #f0c243;
  --c-keyword: #c98fe8; --c-string: #86c9a4; --c-comment: #6f7783;
  --c-number: #e2a06a; --c-title: #7fb4f2; --c-type: #7fb4f2;
}
body { background: #13161a; color: var(--ink); }
th { background: #1a1f26; }
a { color: #7fb4f2; }
.wikilink { color: #e2b54a; }
:not(pre) > code { background: var(--code-bg); color: #cda6ef; }
`;

/** Turns `[[target]]` / `[[target|label]]` into link-styled spans outside code. */
export function renderWikiLinks(html: string): string {
  const parts = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_match, target: string, label?: string) => {
          const display = (label ?? target).trim();
          return `<span class="wikilink" title="Заметка: ${escapeAttribute(target.trim())}">${escapeAttribute(display)}</span>`;
        },
      );
    })
    .join('');
}

function escapeAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Builds a standalone, self-contained HTML document for export or printing. */
export function buildExportHtml(
  title: string,
  bodyHtml: string,
  options: { subtitle?: string; theme?: ExportTheme } = {},
): string {
  const subtitle = options.subtitle
    ? `<p class="doc-meta">${escapeText(options.subtitle)}</p>`
    : '';
  const themeCss = options.theme === 'dark' ? DARK_DOCUMENT_CSS : '';
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
<style>${DOCUMENT_CSS}${themeCss}</style>
</head>
<body>
<article>
<h1 class="doc-title">${escapeText(title)}</h1>
${subtitle}
${bodyHtml}
</article>
</body>
</html>`;
}

/** Prints a ready HTML document, which is how KOCPAD produces a PDF. */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);

  const cleanup = (): void => {
    window.setTimeout(() => frame.remove(), 1500);
  };

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const run = (): void => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
    }
    cleanup();
  };

  if (doc.readyState === 'complete') window.setTimeout(run, 120);
  else frame.addEventListener('load', () => window.setTimeout(run, 120), { once: true });
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Turns a plain text note name into a readable document title. */
export function documentTitle(name: string): string {
  return name.replace(/\.(md|markdown|mdown|txt)$/i, '');
}
