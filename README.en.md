<div align="center">
  <img src="docs/icon.png" alt="KOCPAD icon" width="80" height="80">
  <h1>KOCPAD · Experimental</h1>
  <p><b>The ideas branch. Right now it holds the inline markup assistant.</b></p>

  [![build](https://github.com/ShiDikALexey/KOCPAD/actions/workflows/build.yml/badge.svg?branch=Experimental)](https://github.com/ShiDikALexey/KOCPAD/actions/workflows/build.yml)
  [![experimental](https://img.shields.io/badge/experimental-inline%20assistant-purple)](https://github.com/ShiDikALexey/KOCPAD/tree/Experimental)
  [![beta](https://img.shields.io/badge/beta-1.5.0--beta.4-orange)](https://github.com/ShiDikALexey/KOCPAD/tree/beta)

  <sub><a href="README.md">Русский</a> · English · <a href="https://github.com/ShiDikALexey/KOCPAD/blob/main/README.en.md">full description (main)</a></sub>
</div>

---

The **`Experimental`** branch is cut from `beta` (`1.5.0-beta.4`). Ideas that are
not ready for beta live here. Nothing from this branch reaches `main` or `beta`
until you accept it.

**Already here:** [inline markup assistant](#inline-markup-assistant).
**Being tested:** highlighting, the popover and «fix / ignore»; checklist below.
**Planned:** [learning panel and style hints](#what-comes-next).

## Inline markup assistant

It is not a chat and not an "ask AI" panel. The notepad notices places where the
markdown is likely broken and quietly tints them. Clicking a tint opens a short
explanation and three buttons: **«Исправить»** (fix), **«Игнорировать»** (ignore),
**«Больше не предлагать»** (never suggest again).

![Inline assistant: `##Встречи` is tinted, the popover explains the missing space and offers a fix](docs/screenshots/assistant.png)

- **16 markup rules:** space after `#`, more than six `#`, skipped heading level,
  bare URL, unclosed link, link without a protocol, missing space after a list
  marker, mixed list markers, unclosed code fence, unclosed inline code, unclosed
  `[[link]]`, tag glued to a word, missing blank line before a block, double blank
  line, trailing space, double space.
- Rules stay silent inside fenced code blocks.
- **Background tint only** (lavender), 150 ms fade-in, at most 5 suggestions,
  respects "reduce motion".
- Fixes apply only on click, as one transaction; `Ctrl+Z` reverts.
- "Never suggest again" is persisted in settings.
- **No network, no model download.**

Enable or disable it in settings: **«Помощник» → «Подсказки по разметке»**.

## What is being tested

- [ ] `##Привет` gets a lavender tint; the click explains and fixes it;
- [ ] `-пункт` / `1)пункт` get the list-marker hint;
- [ ] a bare `vk.com` line is offered as a markdown link;
- [ ] unclosed `` `code ``, `[[Note`, `` ``` `` are found;
- [ ] nothing is tinted inside fenced code;
- [ ] «Игнорировать» hides the hint for the session;
- [ ] «Больше не предлагать» keeps the rule off after a restart;
- [ ] disabling the assistant removes every tint immediately;
- [ ] typing in a 5,000-line note stays smooth.

Automated for this branch: **50 e2e scenarios** (4 cover the assistant),
typecheck, build, Windows installers and the native smoke in CI.

## What comes next

**M2 — learning panel (next):**
- accepted / ignored counters per rule;
- rule confidence and how it changes suggestion frequency;
- learned habits: how you format links, lists, quotes;
- "reset learning";
- a weekly "before / after" summary.

**M3 — style hints (later, opt-in):** long sentences, repeats, wordiness; off by
default.

**M4 — tiny local LLM (only if M1–M3 prove useful):** better explanations and
phrase rewrites, local and on demand.

Full plan, rules and decisions: [docs/ASSISTANT.md](docs/ASSISTANT.md).

## Getting a build

Actions → the latest `Experimental` run → the **`kocpad-windows`** artifact
(portable `kocpad.exe` + NSIS installer). Or locally:

```powershell
git checkout Experimental
npm ci
npm run tauri:dev
```

This branch is not merged into `beta`/`main` and is not released until you say the
feature is ready.

## Other branches

- **`main`** — stable `1.4.0`, full description: [README](https://github.com/ShiDikALexey/KOCPAD/blob/main/README.en.md).
- **`beta`** — `1.5.0-beta.4`: changes and checklist: [README](https://github.com/ShiDikALexey/KOCPAD/blob/beta/README.en.md).
