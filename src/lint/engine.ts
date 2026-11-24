/**
 * Deterministic markdown suggestions for the inline assistant.
 *
 * Everything here is a pure function of the document text: no network, no
 * model, no state. The editor extension turns the diagnostics into lavender
 * background marks and offers a click-to-fix popover.
 */

export type LintSeverity = 'warning' | 'info';

export interface LintFix {
  from: number;
  to: number;
  insert: string;
}

export interface LintDiagnostic {
  /** Stable rule id, also used by the learning log. */
  rule: string;
  from: number;
  to: number;
  severity: LintSeverity;
  /** Plain-language explanation shown in the popover. */
  message: string;
  /** How the fixed fragment looks, for the popover preview. */
  preview?: string;
  fix?: LintFix;
}

interface RuleContext {
  lines: string[];
  index: number;
  /** Offset of the line start in the document. */
  from: number;
  /** Offset of the line end (excluding the newline) in the document. */
  to: number;
  line: string;
  inFence: boolean;
  /** Level of the previous heading above this line, if any. */
  previousHeadingLevel: number | null;
  /** Marker of the current list block, if the line is a list item. */
  listMarker: string | null;
}

type Rule = (context: RuleContext) => LintDiagnostic[];

const TLDS = new Set([
  'com', 'ru', 'org', 'net', 'io', 'dev', 'me', 'app', 'co', 'info', 'xyz',
  'su', 'рф', 'site', 'online', 'store', 'tech', 'pro', 'biz', 'edu', 'gov',
  'ai', 'gg', 'tv', 'blog', 'page',
]);

const NOISE_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'toml', 'ts', 'js', 'css',
  'html', 'png', 'jpg', 'jpeg', 'svg', 'rs', 'py', 'lock',
]);

const TEXT_FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** A tag token as understood by the tags panel: letters, digits, `_`, `-`, `/`. */
const TAG_TOKEN = /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u;

function startsWithTag(line: string): boolean {
  if (!line.startsWith('#')) return false;
  const rest = line.slice(1);
  const token = rest.split(/\s/, 1)[0] ?? '';
  return token.length > 0 && TAG_TOKEN.test(token);
}

function headingLevel(line: string): number | null {
  const match = /^(#{1,6})(?!#)(.*)$/.exec(line);
  if (!match) return null;
  return match[1].length;
}

function isFenceLine(line: string): boolean {
  return TEXT_FENCE.test(line);
}

function isListLine(line: string): RegExpExecArray | null {
  return /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(line);
}

function isBlockStart(line: string): boolean {
  return (
    headingLevel(line) !== null
    || isListLine(line) !== null
    || /^\s*>/.test(line)
    || /^\s*\|/.test(line)
    || isFenceLine(line)
  );
}

const rules: Rule[] = [
  (context) => {
    if (context.inFence) return [];
    const match = /^(#{1,6})(?!#)([^\s#])/.exec(context.line);
    if (!match) return [];
    // `#Ячейка 262:` is an inline tag, not a broken H1. A single `#` glued to a
    // tag token is left alone; `##`/`###` and `#Заголовок с пробелами` still get
    // the missing-space hint because those read as headings.
    if (match[1].length === 1 && startsWithTag(context.line)) return [];
    return [{
      rule: 'heading-space',
      from: context.from,
      to: context.from + match[1].length + 1,
      severity: 'warning',
      message: 'После «#» нужен пробел, иначе Markdown не распознает заголовок',
      preview: `${match[1]} ${context.line.slice(match[1].length)}`,
      fix: { from: context.from + match[1].length, to: context.from + match[1].length, insert: ' ' },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    const match = /^(#{7,})\s*/.exec(context.line);
    if (!match) return [];
    return [{
      rule: 'heading-too-many',
      from: context.from,
      to: context.from + match[1].length,
      severity: 'warning',
      message: 'В Markdown не больше шести уровней заголовков',
      preview: `###### ${context.line.replace(/^#{7,}\s*/, '')}`,
      fix: { from: context.from, to: context.from + match[1].length, insert: '###### ' },
    }];
  },
  (context) => {
    if (context.inFence || context.previousHeadingLevel === null) return [];
    const level = headingLevel(context.line);
    if (level === null || level <= context.previousHeadingLevel + 1) return [];
    const target = context.previousHeadingLevel + 1;
    return [{
      rule: 'heading-skip',
      from: context.from,
      to: context.from + level,
      severity: 'info',
      message: `Пропущен уровень заголовка: предыдущий был «${'#'.repeat(context.previousHeadingLevel)}», следующий по порядку — «${'#'.repeat(target)}»`,
      preview: `${'#'.repeat(target)}${context.line.slice(level)}`,
      fix: { from: context.from, to: context.from + level, insert: '#'.repeat(target) },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    const line = context.line.trim();
    if (!line || line.includes(' ') || line.includes('](') || line.includes('<')) return [];
    const scheme = /^(https?:\/\/([^/\s]+)(?:\/\S*)?)$/i.exec(line);
    const bare = /^((?:[a-z0-9-]+\.)+([a-zа-я]{2,}))(?::\d+)?(?:\/\S*)?$/i.exec(line);
    const www = /^(www\.[^\s]+)$/i.exec(line);
    const candidate = scheme ?? bare ?? www;
    if (!candidate) return [];
    const host = scheme ? scheme[2] : www ? www[1] : bare![1];
    const tld = host.split('.').pop()?.toLowerCase() ?? '';
    if (!TLDS.has(tld)) return [];
    if (NOISE_EXTENSIONS.has((host.split('.').pop() ?? '').toLowerCase())) return [];
    const href = scheme ? line : `https://${line}`;
    return [{
      rule: 'link-bare-url',
      from: context.from,
      to: context.to,
      severity: 'info',
      message: 'Похоже на ссылку. В Markdown её лучше оформить как [текст](адрес)',
      preview: `[${line}](${href})`,
      fix: { from: context.from, to: context.to, insert: `[${line}](${href})` },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    const open = context.line.indexOf('](');
    if (open < 0) return [];
    const rest = context.line.slice(open + 2);
    if (rest.includes(')')) return [];
    return [{
      rule: 'link-unclosed',
      from: context.from + open,
      to: context.to,
      severity: 'warning',
      message: 'У ссылки не закрыта скобка: нужен «)» в конце',
      preview: `${context.line})`,
      fix: { from: context.to, to: context.to, insert: ')' },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    const match = /\]\((?!https?:|mailto:|#|\/|\.{1,2}\/)([a-z0-9.-]+\.[a-zа-я]{2,})/i.exec(context.line);
    if (!match) return [];
    const start = context.from + match.index + 2;
    return [{
      rule: 'link-no-protocol',
      from: start,
      to: start + match[1].length,
      severity: 'info',
      message: 'В адресе ссылки нет протокола — добавьте https://',
      preview: `](https://${match[1]})`,
      fix: { from: start, to: start, insert: 'https://' },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    const match = /^(\s*)([-*+])(\S)/.exec(context.line);
    if (!match) return [];
    const markerIndex = match[1].length;
    const afterMarker = context.line[markerIndex + 1] ?? '';
    // `**24.11.2026г.**` is bold and `*курсив*` is italic; neither is a list
    // item missing its space after the marker.
    if (
      match[2] === '*'
      && (afterMarker === '*' || context.line.slice(markerIndex + 1).includes('*'))
    ) {
      return [];
    }
    const position = context.from + match[1].length + 1;
    return [{
      rule: 'list-space',
      from: context.from + match[1].length,
      to: position + 1,
      severity: 'warning',
      message: 'После маркера списка нужен пробел',
      preview: `${match[1]}${match[2]} ${context.line.slice(match[1].length + 1)}`,
      fix: { from: position, to: position, insert: ' ' },
    }];
  },
  (context) => {
    if (context.inFence || !context.listMarker) return [];
    const match = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(context.line);
    if (!match) return [];
    if (match[2] === context.listMarker) return [];
    const markerStart = context.from + match[1].length;
    return [{
      rule: 'list-mixed-markers',
      from: markerStart,
      to: markerStart + match[2].length,
      severity: 'info',
      message: `В этом списке маркеры смешаны: используйте «${context.listMarker}», как в первом пункте`,
      preview: `${match[1]}${context.listMarker}${context.line.slice(match[1].length + match[2].length)}`,
      fix: { from: markerStart, to: markerStart + match[2].length, insert: context.listMarker },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    const single = context.line.replace(/`{3,}/g, '');
    let count = 0;
    for (let index = 0; index < single.length; index += 1) {
      if (single[index] === '`' && single[index - 1] !== '\\') count += 1;
    }
    if (count % 2 === 0) return [];
    return [{
      rule: 'code-inline-unclosed',
      from: Math.max(context.from, context.to - 1),
      to: context.to,
      severity: 'warning',
      message: 'Не закрыт код в строке: добавьте обратную кавычку',
      preview: `${context.line}\``,
      fix: { from: context.to, to: context.to, insert: '`' },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    const opens = (context.line.match(/\[\[/g) ?? []).length;
    const closes = (context.line.match(/\]\]/g) ?? []).length;
    if (opens <= closes) return [];
    const lastOpen = context.line.lastIndexOf('[[');
    return [{
      rule: 'wikilink-unclosed',
      from: context.from + lastOpen,
      to: context.from + lastOpen + 2,
      severity: 'warning',
      message: 'Ссылка на заметку не закрыта: нужны «]]»',
      preview: `${context.line}]]`,
      fix: { from: context.to, to: context.to, insert: ']]' },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    const match = /([A-Za-zА-Яа-яЁё0-9])(#[A-Za-zА-Яа-яЁё][\wА-Яа-яЁё/-]*)/.exec(context.line);
    if (!match) return [];
    const position = context.from + match.index + 1;
    return [{
      rule: 'tag-in-word',
      from: position,
      to: position + 1,
      severity: 'warning',
      message: 'Тег приклеился к слову — перед «#» нужен пробел',
      preview: `${match[1]} ${match[2]}`,
      fix: { from: position, to: position, insert: ' ' },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    if (context.index === 0 || !isBlockStart(context.line)) return [];
    const previous = context.lines[context.index - 1] ?? '';
    if (!previous.trim()) return [];
    if (isBlockStart(previous)) return [];
    return [{
      rule: 'structure-blank-before',
      from: context.from,
      to: context.to,
      severity: 'info',
      message: 'Перед блоком нужна пустая строка, иначе разметка может склеиться',
      preview: `\n${context.line}`,
      fix: { from: context.from, to: context.from, insert: '\n' },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    if (context.line.trim() || context.index === 0) return [];
    const previous = context.lines[context.index - 1] ?? '';
    if (previous.trim()) return [];
    const before = context.lines[context.index - 2] ?? '';
    if (before.trim() && context.from > 0) {
      return [{
        rule: 'structure-double-blank',
        from: context.from - 1,
        to: context.from,
        severity: 'info',
        message: 'Две пустые строки подряд — достаточно одной',
        preview: '—',
        fix: { from: context.from - 1, to: context.from, insert: '' },
      }];
    }
    return [];
  },
  (context) => {
    if (context.inFence) return [];
    const match = /[ \t]+$/.exec(context.line);
    if (!match) return [];
    // A bare blockquote/list/heading marker (`> `, `- `, `1. `, `# `) is valid
    // markup; the trailing space is not noise there.
    const trimmed = context.line.trim();
    if (/^(?:[-*+]|\d+[.)]|>|#{1,6})$/.test(trimmed)) return [];
    return [{
      rule: 'trailing-space',
      from: context.from + match.index,
      to: context.to,
      severity: 'info',
      message: 'Пробел в конце строки — обычно лишний',
      preview: context.line.trimEnd(),
      fix: { from: context.from + match.index, to: context.to, insert: '' },
    }];
  },
  (context) => {
    if (context.inFence) return [];
    if (/^\s*\|/.test(context.line)) return [];
    if (/^\s/.test(context.line)) return [];
    const match = /(\S)[ \t]{2,}(\S)/.exec(context.line);
    if (!match) return [];
    const from = context.from + match.index + 1;
    const to = from + /[ \t]{2,}/.exec(context.line.slice(match.index + 1))![0].length;
    return [{
      rule: 'double-space',
      from,
      to,
      severity: 'info',
      message: 'Двойной пробел между словами',
      preview: `${match[1]} ${match[2]}`,
      fix: { from, to, insert: ' ' },
    }];
  },
];

const styleRules: Rule[] = [
  (context) => {
    if (context.inFence) return [];
    const line = context.line;
    if (!line.trim() || line.includes('`')) return [];
    if (/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/.test(line)) return [];
    const sentences = line.match(/[^.!?]+[.!?]+/g);
    if (!sentences) return [];
    const results: LintDiagnostic[] = [];
    let cursor = 0;
    for (const sentence of sentences) {
      const start = line.indexOf(sentence, cursor);
      if (start < 0) continue;
      cursor = start + sentence.length;
      const words = sentence.trim().split(/\s+/).filter(Boolean).length;
      if (words < 35) continue;
      results.push({
        rule: 'style-long-sentence',
        from: context.from + start,
        to: context.from + start + sentence.length,
        severity: 'info',
        message: `Длинное предложение (${words} слов) — можно разбить на два`,
      });
    }
    return results;
  },
  (context) => {
    if (context.inFence || context.line.includes('`')) return [];
    const match = /(?<![\p{L}\p{N}_])([\p{L}\p{N}_-]+)[ \t]+\1(?![\p{L}\p{N}_])/iu.exec(context.line);
    if (!match) return [];
    const from = context.from + match.index;
    return [{
      rule: 'style-repeated-word',
      from,
      to: from + match[0].length,
      severity: 'info',
      message: 'Слово повторяется — второе можно убрать',
      preview: match[1],
      fix: { from, to: from + match[0].length, insert: match[1] },
    }];
  },
  (context) => {
    if (context.inFence || context.line.includes('`')) return [];
    const phrases = [
      'в общем',
      'на самом деле',
      'как бы',
      'в принципе',
      'следует отметить',
      'стоит отметить',
      'по сути',
      'в целом',
    ];
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${phrases.join('|')})(?![\\p{L}\\p{N}_])`, 'iu');
    const match = pattern.exec(context.line);
    if (!match) return [];
    let end = match.index + match[0].length;
    if (context.line[end] === ',') end += 1;
    if (context.line[end] === ' ') end += 1;
    const from = context.from + match.index;
    return [{
      rule: 'style-wordiness',
      from,
      to: context.from + end,
      severity: 'info',
      message: 'Вводная фраза — без неё предложение короче',
      preview: context.line.slice(0, match.index) + context.line.slice(end),
      fix: { from, to: context.from + end, insert: '' },
    }];
  },
];

/** Runs every rule over the text. Fenced code is skipped except fence checks. */
export function runRules(text: string, options: { style?: boolean } = {}): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let fence: string | null = null;
  let lastHeading: number | null = null;
  let listMarker: string | null = null;
  let lastWasListItem = false;
  let openFence: { from: number; fence: string } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const from = offset;
    const to = offset + line.length;
    offset = to + 1;

    if (isFenceLine(line)) {
      const fenceMatch = TEXT_FENCE.exec(line)!;
      const marker = fenceMatch[1][0];
      if (!fence) {
        fence = marker;
        openFence = { from, fence: marker };
      } else if (fence === marker) {
        fence = null;
        openFence = null;
      }
      lastWasListItem = false;
      listMarker = null;
      continue;
    }

    const level = headingLevel(line);
    const previousHeading = lastHeading;
    if (level !== null) lastHeading = level;

    const list = isListLine(line);
    if (list) {
      if (lastWasListItem && listMarker) {
        // keep the block's marker for the mixed-marker rule
      } else {
        listMarker = list[2];
      }
      lastWasListItem = true;
    } else if (line.trim()) {
      lastWasListItem = false;
      listMarker = null;
    }

    const context: RuleContext = {
      lines,
      index,
      from,
      to,
      line,
      inFence: fence !== null,
      previousHeadingLevel: previousHeading,
      listMarker: list ? listMarker : null,
    };
    for (const rule of rules) diagnostics.push(...rule(context));
    if (options.style) {
      for (const rule of styleRules) diagnostics.push(...rule(context));
    }
  }

  // An unclosed fence is reported at the opening line.
  if (openFence) {
    diagnostics.push({
      rule: 'code-fence-unclosed',
      from: openFence.from,
      to: openFence.from + 3,
      severity: 'warning',
      message: 'Блок кода не закрыт — добавьте «```» в конец',
      preview: `${openFence.fence}${openFence.fence}${openFence.fence}`,
      fix: { from: text.length, to: text.length, insert: `\n${openFence.fence}${openFence.fence}${openFence.fence}` },
    });
  }

  diagnostics.sort((left, right) => left.from - right.from || left.to - right.to);
  return diagnostics;
}
