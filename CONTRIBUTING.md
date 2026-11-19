# Contributing

Thanks for taking a look. KOCPAD is a small app with a short list of rules.

## Setup

```bash
npm install
npm run dev            # browser build on http://localhost:1420
npm run tauri:dev      # desktop window (needs Rust + MSVC Build Tools)
```

Before pushing, all of these must pass:

```bash
npm run typecheck
npm run build
npm run test:e2e       # Playwright smoke suite (starts the dev server itself)
```

## Conventions

- **UI strings and the README are Russian; code, comments, commits and `docs/` are English.**
  `README.md` is the Russian version and `README.en.md` mirrors it — keep both in
  sync when you change user-facing documentation.
- **No UI framework.** The frontend is plain TypeScript and direct DOM. If you
  think a framework is needed, open an issue with the case first.
- **Respect the storage seam.** Anything that touches files goes through
  `Storage` in `src/storage/types.ts`, never directly through `invoke` or the
  File System Access API from UI code.
- **One state owner.** Mutations go through `Store`; views subscribe to topics and
  re-render. Do not keep parallel copies of document content in UI modules.
- **Theme only through tokens.** Colours come from the CSS variables defined for
  the light and dark blocks in `src/style.css`. No hard-coded colours in components.
- **Accessibility floor.** Every interactive element is reachable by keyboard and
  shows a visible focus ring; dialogs close on `Esc`.

## Commits

Short imperative subject line, then a body that explains the *why* when it is not
obvious:

```
add workspace search panel with per-line snippets

Searching across notes used to require opening each file. The panel reuses
Storage.readText so both Tauri and browser backends work unchanged.
```

## Reporting a bug

Please include:

1. What you did, step by step.
2. What you expected and what happened.
3. The backend (`Демо`, `Браузер`, `Windows`) shown in the status bar.
4. Console output if there is an error.

## Pull requests

- Keep changes focused; one concern per pull request.
- Update `docs/KEYBINDINGS.md` when you add a shortcut and `docs/ROADMAP.md` when
  you finish a roadmap item.
- Mention how you tested it. Screenshots help for UI changes.

## License

By contributing you agree that your work is licensed under the [MIT License](LICENSE).
