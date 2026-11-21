# Inline writing assistant (planned)

A small, local assistant that watches what you type and quietly highlights places
where the markdown is likely wrong or could be sharper. It is **not** a chat and
it never rewrites anything on its own: a highlight is only an invitation to look.

Status: **planned, no code yet.** The implementation will land on the
`Experimental` branch, cut from `beta`, and will not be merged or released until
the owner accepts it.

## Decisions

| Question | Decision |
|---|---|
| Trigger | Inline, ambient. The user does not ask for anything; the editor notices. |
| Visual | Background tint only (lavender, ~15–18% opacity), 150 ms fade-in, no underline. Subtle but visible; honours "reduce motion". |
| Fix action | Only by click on the highlight. No autofix, no hotkey in v1. |
| Scope of v1 rules | All 16 markup rules below. Style advice is a later phase. |
| Learning | Local only. The panel lives in **Settings**, shows accepted/ignored counts, per-rule confidence and learned habits, with a reset. |
| Network | None. No model download in v1; no LLM, no telemetry. |
| Branch | `Experimental` (from `beta`), CI builds it, no release tags. |

## Non-goals for v1

- No chat, no "ask AI" panel, no free-form generation.
- No style/grammar advice (long sentences, wordiness) — phase 3.
- No automatic edits.
- No model fine-tuning or per-user trained weights.
- No changes to the note format or the file layer.

## User experience

1. The user types `##Hello world`.
2. After a 300–400 ms pause the engine reports a diagnostic for `##Hello `.
3. The range gets a lavender background; nothing moves, no popup appears.
4. Clicking the tinted range opens a small anchored popover:
   - **what**: "После `##` нужен пробел, иначе Markdown не распознает заголовок";
   - **how it should look**: `## Hello world` (monospace, diff-like);
   - **buttons**: «Исправить» (applies the edit and closes), «Игнорировать» (this
     instance, remembered for the session), «Больше не предлагать» (disables the
     rule, asks nothing else).
5. At most **five** highlights are visible at once; the rest wait until the
   visible ones are resolved or the caret moves.
6. High-confidence rules appear slightly stronger; rules the user keeps ignoring
   fade out of the list (see Learning).

Keyboard: `Esc` closes the popover; the highlight is reachable with the caret and
`Enter` opens it (the fix itself stays click/Enter on the button — no hidden
shortcut).

## Rules (16, markup only)

| ID | Rule | Example | Fix |
|---|---|---|---|
| `heading-space` | Space required after `#` | `##Hello` | `## Hello` |
| `heading-too-many` | More than six `#` | `####### x` | demote to `###### x` (or plain text) |
| `heading-skip` | Skipped heading level after a previous heading (`##` → `####`) | `#### x` after `## y` | suggest `### x` |
| `link-bare-url` | A bare URL on its own | `vk.com` | `[vk.com](https://vk.com)` |
| `link-unclosed` | Link syntax not closed | `[текст](url` | close with `)` |
| `link-no-protocol` | Destination without a scheme | `](vk.com)` | `](https://vk.com)` |
| `list-space` | No space after the list marker | `-пункт` | `- пункт` |
| `list-mixed-markers` | `-` and `*` mixed in one list | `- a` / `* b` | unify to the first marker |
| `code-fence-unclosed` | Fenced block never closed | ` ```js …` | insert closing fence at the end |
| `code-inline-unclosed` | Inline code not closed | `` `код `` | add closing backtick |
| `wikilink-unclosed` | `[[` without `]]` | `[[Заметка` | add `]]` |
| `tag-in-word` | `#tag` glued to a word | `дом#работа` | `дом #работа` |
| `structure-blank-before` | No blank line before heading/list/quote/table | text directly before `##` | insert blank line |
| `structure-double-blank` | Two or more blank lines | `a\n\n\nb` | collapse to one |
| `trailing-space` | Whitespace at end of line | `текст   ` | remove |
| `double-space` | Two spaces between words (not after punctuation) | `слово  слово` | one space |

All rules are deterministic, operate on the document text plus a little context
(previous/next line, inside code fence or not), and never fire inside fenced code
blocks (except the fence rules themselves).

## Architecture (planned modules)

```
src/lint/
├─ types.ts        Diagnostic { id, from, to, severity, message, example, fix? }
├─ rules.ts        one pure function per rule: (context) => Diagnostic[]
├─ engine.ts       run all rules over the document, dedupe, cap at 5
├─ decorations.ts  CodeMirror StateField/ViewPlugin: lavender marks + click
├─ popover.ts      anchored popover (reuses the existing dialog helpers)
└─ learning.ts     local events, confidence, learned patterns, reset
```

- CodeMirror 6 decorations, **no new dependencies**: a `StateField` maps
  diagnostics to `Decoration.mark({ class: 'cm-lint-suggestion' })`; a
  `ViewPlugin` handles clicks and opens the popover.
- The engine runs debounced (300–400 ms) and only when the assistant is enabled;
  it skips unchanged content by hashing the document text.
- Edits are applied through the editor's normal `dispatch` (one undo step), so
  `Ctrl+Z` reverts a fix.
- Settings: a new "Помощник" section inside the existing settings modal; the
  store gets a `lint` settings slice (enabled, disabled rule ids, learning logs)
  persisted next to the other settings.

## Learning model (no LLM, fully local)

Every suggestion interaction is recorded locally:

```
{ rule, at, outcome: 'applied' | 'ignored' | 'disabled' | 'shown' }
```

- **Confidence** per rule: `(applied + 1) / (applied + ignored + 2)`. A rule needs
  at least 3 decisions before its confidence changes what is shown.
- **Ordering**: high-confidence rules are shown first and are slightly more
  visible; rules with a low ratio (>60% ignored over 5+ decisions) are shown less
  often and eventually hidden, but never deleted.
- **Learned habits** from accepted fixes and the note corpus: link style
  (`[text](url)` vs `<url>`), list marker, quote style, heading style, spacing
  around punctuation. Each habit lists how many examples it was inferred from.
- **Settings panel** (mock):

```
Помощник
  [x] Подсказывать по разметке
  [ ] Стилевые подсказки (позже)

  Принято: 42   Отклонено: 7
  Пробел после ##        ████████ 96%   (18 / 0)
  Голый URL              ██████   78%   (11 / 3)
  Двойные пустые строки  ██       22%   (2 / 7) — показываю реже

  Выучено из ваших правок:
    Ссылки:  [текст](url)    12 примеров
    Списки:  «-»             9 примеров
    Кавычки: «ёлочки»        6 примеров

  [Сбросить обучение]
```

- «Сбросить обучение» deletes the event log and habits, returns to neutral.
- A weekly local summary ("`##` без пробела: было 14, стало 2") is a later
  addition; it is computed from the same log.

## Privacy

- Everything stays on the device: events and habits live in `localStorage` next to
  the existing settings; the graph/model files are not involved.
- No network calls of any kind in v1. No note text leaves the app.
- The user can disable the assistant, disable individual rules, forget the
  learning data, and exclude work by turning the toggle off.
- The assistant never sees files outside the open workspace.

## Testing

- Playwright: typing `##Hello` produces a `.cm-lint-suggestion` mark; a click opens
  the popover with the expected text; «Исправить» rewrites the line and removes the
  mark; «Игнорировать» hides it this session; disabling the assistant removes all
  marks.
- Rule correctness: a dev-only hook (`window.__kocpad.lint.diagnostics(text)`)
  returns the diagnostics array; table-driven e2e assertions for the 16 examples.
- Performance guard: typing in a 5,000-line note must not add more than one
  debounced engine run per pause (measured with a counter).
- No false positives inside fenced code blocks (one test per fence type).

## Milestones

| # | Deliverable | Estimate |
|---|---|---|
| M1 | Rules engine + decorations + popover + «Исправить/Игнорировать» for the 16 rules | 1–2 sessions |
| M2 | Settings section, event log, confidence, learned habits, reset | 1 session |
| M3 | Style suggestions (long sentences, repeats, wordiness) — opt-in, off by default | later |
| M4 | Optional tiny local model for richer explanations/rewrites | only if M1–M3 prove useful |

## Risks

- **Noise.** 16 rules can feel like a minefield; mitigation: max 5 visible, no
  auto-open, easy disable, confidence ordering.
- **False positives.** Bare URLs, `#` inside words and lists are context
  sensitive; rules must be conservative, and each gets a dedicated test.
- **Performance.** Debounced, cached by text hash, no async work in v1.
- **Scope creep.** The assistant must stay outside the core release line until it
  is accepted; it lives on `Experimental` and never touches the file layer.
