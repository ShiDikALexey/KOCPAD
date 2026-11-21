/**
 * Local learning log for the inline assistant.
 *
 * Nothing here is a model: we store which suggestions were applied, ignored or
 * disabled, derive a confidence per rule, and recognise the formatting habits of
 * the notes. Everything stays in localStorage on this machine.
 */

export type LintOutcome = 'applied' | 'ignored' | 'disabled';

export interface LintEvent {
  rule: string;
  outcome: LintOutcome;
  at: number;
}

export interface RuleStat {
  rule: string;
  label: string;
  applied: number;
  ignored: number;
  disabled: number;
  decisions: number;
  confidence: number;
}

export interface Habit {
  label: string;
  value: string;
  count: number;
}

const STORAGE_KEY = 'kocpad.lint.learning';
const MAX_EVENTS = 5000;

export const RULE_LABELS: Record<string, string> = {
  'heading-space': 'Пробел после #',
  'heading-too-many': 'Больше шести #',
  'heading-skip': 'Пропущен уровень заголовка',
  'link-bare-url': 'Голый URL',
  'link-unclosed': 'Незакрытая ссылка',
  'link-no-protocol': 'Ссылка без протокола',
  'list-space': 'Пробел после маркера списка',
  'list-mixed-markers': 'Смешанные маркеры списка',
  'code-fence-unclosed': 'Незакрытый блок кода',
  'code-inline-unclosed': 'Незакрытый инлайн-код',
  'wikilink-unclosed': 'Незакрытая [[ссылка]]',
  'tag-in-word': 'Тег внутри слова',
  'structure-blank-before': 'Нет пустой строки перед блоком',
  'structure-double-blank': 'Двойная пустая строка',
  'trailing-space': 'Пробел в конце строки',
  'double-space': 'Двойной пробел',
};

export function ruleLabel(rule: string): string {
  return RULE_LABELS[rule] ?? rule;
}

export function loadEvents(): LintEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LintEvent =>
        typeof item === 'object'
        && item !== null
        && typeof (item as LintEvent).rule === 'string'
        && (item as LintEvent).outcome !== undefined
        && typeof (item as LintEvent).at === 'number',
    );
  } catch {
    return [];
  }
}

function saveEvents(events: LintEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Best effort: learning data is never critical for the editor.
  }
}

export function recordLintEvent(rule: string, outcome: LintOutcome): void {
  if (!rule) return;
  const events = loadEvents();
  events.push({ rule, outcome, at: Date.now() });
  saveEvents(events);
}

export function resetLearning(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best effort.
  }
}

/** Per-rule counters and confidence; rules with no decisions are omitted. */
export function ruleStats(): RuleStat[] {
  const byRule = new Map<string, { applied: number; ignored: number; disabled: number }>();
  for (const event of loadEvents()) {
    const entry = byRule.get(event.rule) ?? { applied: 0, ignored: 0, disabled: 0 };
    entry[event.outcome] += 1;
    byRule.set(event.rule, entry);
  }
  return [...byRule.entries()]
    .map(([rule, counts]) => {
      const decisions = counts.applied + counts.ignored;
      return {
        rule,
        label: ruleLabel(rule),
        applied: counts.applied,
        ignored: counts.ignored,
        disabled: counts.disabled,
        decisions,
        confidence: (counts.applied + 1) / (decisions + 2),
      };
    })
    .sort((left, right) => right.decisions - left.decisions || right.confidence - left.confidence);
}

/** Weight used to order suggestions; neutral until there are enough decisions. */
export function ruleWeight(rule: string): number {
  const stat = ruleStats().find((item) => item.rule === rule);
  if (!stat || stat.decisions < 3) return 0.5;
  return stat.confidence;
}

/**
 * Formatting habits found in a note. Only habits with a few examples are shown,
 * so the panel does not claim to know something from one occurrence.
 */
export function detectHabits(text: string): Habit[] {
  const lines = text.split('\n');
  let inFence = false;
  let markdownLinks = 0;
  let autolinks = 0;
  let atxHeadings = 0;
  let dashes = 0;
  let stars = 0;
  let pluses = 0;
  let numbered = 0;
  let guillemets = 0;
  let straightQuotes = 0;

  const quotePair = /«[^»]+»/g;
  const straightPair = /"[^"\n]+"/g;

  for (const line of lines) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    markdownLinks += (line.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length;
    autolinks += (line.match(/<https?:\/\/[^>]+>/g) ?? []).length;
    if (/^#{1,6} /.test(line)) atxHeadings += 1;
    const list = /^(\s*)([-*+])\s+/.exec(line);
    if (list) {
      if (list[2] === '-') dashes += 1;
      else if (list[2] === '*') stars += 1;
      else pluses += 1;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) numbered += 1;
    guillemets += (line.match(quotePair) ?? []).length;
    straightQuotes += (line.match(straightPair) ?? []).length;
  }

  const habits: Habit[] = [];
  if (markdownLinks + autolinks >= 3) {
    if (markdownLinks >= autolinks * 2) {
      habits.push({ label: 'Ссылки', value: '[текст](url)', count: markdownLinks });
    } else if (autolinks >= markdownLinks * 2) {
      habits.push({ label: 'Ссылки', value: '<url>', count: autolinks });
    } else {
      habits.push({ label: 'Ссылки', value: 'смешаны: [текст](url) и <url>', count: markdownLinks + autolinks });
    }
  }
  const markers = [
    { marker: '-', count: dashes },
    { marker: '*', count: stars },
    { marker: '+', count: pluses },
    { marker: '1.', count: numbered },
  ].filter((item) => item.count >= 3).sort((left, right) => right.count - left.count);
  if (markers.length) {
    habits.push({ label: 'Списки', value: markers[0].marker, count: markers[0].count });
  }
  if (guillemets + straightQuotes >= 3) {
    habits.push(
      guillemets >= straightQuotes
        ? { label: 'Кавычки', value: '«ёлочки»', count: guillemets }
        : { label: 'Кавычки', value: 'обычные "…"', count: straightQuotes },
    );
  }
  if (atxHeadings >= 3) {
    habits.push({ label: 'Заголовки', value: '# в начале строки', count: atxHeadings });
  }
  return habits;
}
