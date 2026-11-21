import { EditorView, Decoration, type DecorationSet, ViewPlugin } from '@codemirror/view';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { runRules, type LintDiagnostic } from './engine';
import { showLintPopover } from './popover';

export interface LintOptions {
  /** Feature toggle from settings. */
  enabled: () => boolean;
  /** Rules the user turned off ("Больше не предлагать"). */
  disabledRules: () => string[];
  /** Learning log hook; the popover reports applied / ignored / disabled. */
  onEvent?: (rule: string, outcome: 'applied' | 'ignored' | 'disabled') => void;
  /** Confidence from the learning log; higher rules are shown first. */
  weight?: (rule: string) => number;
}

const MAX_VISIBLE = 5;

function suggestionClass(): Decoration {
  return Decoration.mark({ class: 'cm-lint-suggestion' });
}

function toDecorations(diagnostics: LintDiagnostic[]): DecorationSet {
  const visible = diagnostics.filter((diagnostic) => diagnostic.to > diagnostic.from);
  if (!visible.length) return Decoration.none;
  return Decoration.set(
    visible.map((diagnostic) => suggestionClass().range(diagnostic.from, diagnostic.to)),
    true,
  );
}

function keyOf(diagnostic: LintDiagnostic): string {
  return `${diagnostic.rule}:${diagnostic.from}:${diagnostic.to}`;
}

/**
 * Inline assistant extension.
 *
 * A ViewPlugin runs the deterministic rules after a short pause, stores the
 * diagnostics in a StateField (per document, so tab switches keep them) and
 * renders them as a subtle background. A click opens a popover; the edit is
 * applied through a normal transaction, so Ctrl+Z reverts it.
 */
export function lintExtension(options: LintOptions): Extension {
  const setDiagnostics = StateEffect.define<LintDiagnostic[]>();
  const ignored = new Set<string>();

  const diagnosticsField = StateField.define<LintDiagnostic[]>({
    create: () => [],
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setDiagnostics)) return effect.value;
      }
      // Never keep diagnostics computed for an older document: their offsets
      // would be out of range for decorations. The plugin recomputes them after
      // the typing pause anyway.
      if (transaction.docChanged) return [];
      return value;
    },
    provide: (field) => EditorView.decorations.from(field, (diagnostics) => toDecorations(diagnostics)),
  });

  class LintView {
    private timer: number | null = null;
    private lastText = '';

    constructor(private readonly view: EditorView) {
      this.schedule(80);
    }

    update(update: { docChanged: boolean; transactions: readonly unknown[] }): void {
      if (update.docChanged) {
        this.lastText = '';
        this.schedule();
        return;
      }
      // `editor.refreshLint()` dispatches an empty transaction on purpose: it is
      // how the shell makes the extension react to a settings change.
      if (update.transactions.length) this.schedule(0);
    }

    destroy(): void {
      if (this.timer !== null) window.clearTimeout(this.timer);
    }

    private schedule(delay = 350): void {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.recompute(), delay);
    }

    private recompute(): void {
      this.timer = null;
      if (!options.enabled()) {
        this.lastText = '';
        if (this.view.state.field(diagnosticsField).length) {
          this.view.dispatch({ effects: setDiagnostics.of([]) });
        }
        return;
      }
      const text = this.view.state.doc.toString();
      if (text === this.lastText) return;
      this.lastText = text;
      const disabled = new Set(options.disabledRules());
      const diagnostics = runRules(text)
        .filter((diagnostic) => !disabled.has(diagnostic.rule) && !ignored.has(keyOf(diagnostic)))
        .sort(
          (left, right) =>
            (options.weight?.(right.rule) ?? 0.5) - (options.weight?.(left.rule) ?? 0.5)
            || left.from - right.from,
        )
        .slice(0, MAX_VISIBLE);
      if (!diagnostics.length && !this.view.state.field(diagnosticsField).length) return;
      this.view.dispatch({ effects: setDiagnostics.of(diagnostics) });
    }
  }

  const lintView = ViewPlugin.fromClass(LintView);

  const clickHandler = ViewPlugin.fromClass(
    class {},
    {
      eventHandlers: {
        mousedown(event: MouseEvent, view: EditorView): boolean {
          if (event.button !== 0) return false;
          // Only the tinted fragment itself is clickable. Without this check a
          // click on the empty part of the line (or beside a short tint) maps to
          // a document position inside a range and opens the popover anyway.
          const target = event.target as HTMLElement | null;
          if (!target?.closest('.cm-lint-suggestion')) return false;
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position === null) return false;
          const diagnostic = view.state
            .field(diagnosticsField)
            .filter((item) => position >= item.from && position <= item.to)
            .sort((left, right) => left.to - left.from - (right.to - right.from))[0];
          if (!diagnostic) return false;

          event.preventDefault();
          const coords = view.coordsAtPos(diagnostic.from);
          const anchor = coords
            ? { x: coords.left, y: coords.bottom + 6 }
            : { x: event.clientX, y: event.clientY + 10 };
          showLintPopover(anchor, diagnostic, {
            onFix: () => {
              if (!diagnostic.fix) return;
              options.onEvent?.(diagnostic.rule, 'applied');
              view.dispatch({
                changes: {
                  from: diagnostic.fix.from,
                  to: diagnostic.fix.to,
                  insert: diagnostic.fix.insert,
                },
                selection: { anchor: diagnostic.fix.from + diagnostic.fix.insert.length },
                userEvent: 'input.lint',
              });
            },
            onIgnore: () => {
              options.onEvent?.(diagnostic.rule, 'ignored');
              ignored.add(keyOf(diagnostic));
              view.dispatch({
                effects: setDiagnostics.of(
                  view.state.field(diagnosticsField).filter((item) => item !== diagnostic),
                ),
              });
            },
            onDisable: () => {
              options.onEvent?.(diagnostic.rule, 'disabled');
              view.dispatch({
                effects: setDiagnostics.of(
                  view.state.field(diagnosticsField).filter((item) => item.rule !== diagnostic.rule),
                ),
              });
            },
          });
          return true;
        },
      },
    },
  );

  return [diagnosticsField, lintView, clickHandler, EditorView.theme({
    '.cm-lint-suggestion': {
      backgroundColor: 'var(--assistant-tint)',
      borderRadius: '3px',
      animation: 'kocpad-lint-in 150ms ease-out',
    },
    '.cm-lint-suggestion:hover': {
      backgroundColor: 'var(--assistant-tint-strong)',
    },
  })];
}
