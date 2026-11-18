import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';

/**
 * Markdown syntax colours. They are expressed as CSS variables so a single
 * highlight style serves both the light and the dark theme.
 */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: 'var(--md-heading)', fontWeight: '700', fontSize: '1.3em' },
  { tag: tags.heading2, color: 'var(--md-heading)', fontWeight: '700', fontSize: '1.16em' },
  { tag: tags.heading3, color: 'var(--md-heading)', fontWeight: '600', fontSize: '1.07em' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: 'var(--md-heading)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--md-strong)', fontWeight: '700' },
  { tag: tags.emphasis, color: 'var(--md-emphasis)', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: 'var(--md-strike)', textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--md-link)', textDecoration: 'underline' },
  { tag: [tags.monospace], color: 'var(--md-code)', fontFamily: 'var(--font-mono)' },
  { tag: tags.quote, color: 'var(--md-quote)', fontStyle: 'italic' },
  { tag: [tags.list, tags.contentSeparator], color: 'var(--md-marker)' },
  { tag: [tags.processingInstruction, tags.meta], color: 'var(--md-marker)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

/** Editor chrome: everything visual, wired to the same CSS variables as the app. */
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--ink)',
    backgroundColor: 'var(--bg)',
    fontSize: 'var(--editor-font-size)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-editor, var(--font-mono))',
    lineHeight: '1.65',
    overflow: 'auto',
    padding: '14px 0 40vh',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    padding: '0 14px',
    maxWidth: 'var(--editor-measure)',
  },
  '.cm-line': { padding: '0 2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--ink-faint)',
    border: 'none',
    fontFamily: 'var(--font-editor, var(--font-mono))',
    fontSize: '0.85em',
    paddingLeft: '6px',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-muted)' },
  '.cm-placeholder': { color: 'var(--ink-faint)' },
  '.cm-panels': {
    backgroundColor: 'var(--bg-raised)',
    color: 'var(--ink)',
    borderBottom: '1px solid var(--line)',
  },
  '.cm-panel.cm-search': {
    padding: '8px 10px',
    fontFamily: 'var(--font-ui)',
    fontSize: '13px',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
    fontFamily: 'var(--font-ui)',
    fontSize: '12.5px',
  },
  '.cm-panel.cm-search input[type=text]': {
    backgroundColor: 'var(--bg)',
    color: 'var(--ink)',
    border: '1px solid var(--line-strong)',
    borderRadius: '5px',
    padding: '4px 7px',
    minWidth: '160px',
    outline: 'none',
  },
  '.cm-panel.cm-search input[type=text]:focus': {
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 2px var(--accent-soft)',
  },
  '.cm-panel.cm-search button': {
    backgroundColor: 'var(--bg)',
    color: 'var(--ink)',
    border: '1px solid var(--line-strong)',
    borderRadius: '5px',
    padding: '4px 9px',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search button:hover': { backgroundColor: 'var(--bg-hover)' },
  '.cm-panel.cm-search button[name=close]': {
    border: 'none',
    background: 'transparent',
    fontSize: '16px',
    lineHeight: '1',
    padding: '2px 6px',
    marginLeft: 'auto',
  },
  '.cm-panel.cm-search label': { color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: '3px' },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--sel-match)' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': { outline: '1px solid var(--accent)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-raised)',
    border: '1px solid var(--line)',
    borderRadius: '6px',
    boxShadow: 'var(--shadow-pop)',
  },
});

export interface EditorCallbacks {
  onChange: (text: string) => void;
  onScrollRatio: (ratio: number) => void;
  onCursor: (line: number, column: number, selectionLength: number) => void;
}

/**
 * Thin wrapper around CodeMirror 6.
 *
 * Each open document keeps its own `EditorState`, so undo history and cursor
 * survive tab switches — the main thing a plain textarea cannot do.
 */
export class MarkdownEditor {
  private view: EditorView;
  private states = new Map<string, EditorState>();
  private path: string | null = null;
  private callbacks: EditorCallbacks;
  private gutterCompartment = new Compartment();
  private suppressChange = false;

  constructor(parent: HTMLElement, callbacks: EditorCallbacks, options: { showLineNumbers: boolean }) {
    this.callbacks = callbacks;
    this.view = new EditorView({
      parent,
      state: this.createState('', options),
    });
    this.view.scrollDOM.addEventListener('scroll', this.handleScroll, { passive: true });
  }

  private createState(content: string, options?: { showLineNumbers: boolean }): EditorState {
    const showGutter = options?.showLineNumbers ?? this.currentShowGutter;
    return EditorState.create({
      doc: content,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        bracketMatching(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, addKeymap: true }),
        syntaxHighlighting(markdownHighlight),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        placeholder('Пишите здесь. Markdown понимается как в GitHub.'),
        editorTheme,
        this.gutterCompartment.of(showGutter ? lineNumbers() : []),
        EditorView.updateListener.of((update) => this.handleUpdate(update)),
      ],
    });
  }

  private currentShowGutter = false;

  private handleUpdate(update: { docChanged: boolean; selectionSet: boolean; state: EditorState }): void {
    if (update.docChanged && !this.suppressChange && this.path) {
      this.callbacks.onChange(update.state.doc.toString());
    }
    if (update.selectionSet || update.docChanged) {
      const range = update.state.selection.main;
      const line = update.state.doc.lineAt(range.head);
      this.callbacks.onCursor(line.number, range.head - line.from + 1, Math.abs(range.to - range.from));
    }
  }

  private handleScroll = (): void => {
    const element = this.view.scrollDOM;
    const max = element.scrollHeight - element.clientHeight;
    this.callbacks.onScrollRatio(max > 0 ? element.scrollTop / max : 0);
  };

  get text(): string {
    return this.view.state.doc.toString();
  }

  get cursorLine(): number {
    return this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
  }

  /** Caret offset, used when the source text is rewritten from outside. */
  get caret(): number {
    return this.view.state.selection.main.head;
  }

  set caret(position: number) {
    const target = Math.min(Math.max(position, 0), this.view.state.doc.length);
    this.view.dispatch({ selection: { anchor: target } });
  }

  /** Switches to a document, restoring its own undo history and cursor. */
  open(path: string, content: string): void {
    if (this.path === path) return;
    if (this.path) {
      this.states.set(this.path, this.view.state);
    }
    this.path = path;
    const cached = this.states.get(path);
    if (cached) {
      this.replaceState(cached);
    } else {
      this.replaceState(this.createState(content));
    }
  }

  /** Replaces the buffer text while keeping the current document active. */
  applyText(text: string): void {
    if (this.text === text) return;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
  }

  /** Drops cached history for a document (external reload, file deleted). */
  forget(path: string): void {
    this.states.delete(path);
  }

  /** Replaces the buffer when the file changed outside the app. */
  setContent(content: string): void {
    this.replaceState(this.createState(content));
    if (this.path) this.states.delete(this.path);
  }

  private replaceState(state: EditorState): void {
    this.suppressChange = true;
    const scroll = this.view.scrollDOM.scrollTop;
    this.view.setState(state);
    this.view.requestMeasure();
    this.view.scrollDOM.scrollTop = Math.min(scroll, this.view.scrollDOM.scrollHeight);
    this.suppressChange = false;
  }

  setLineNumbers(show: boolean): void {
    this.currentShowGutter = show;
    this.view.dispatch({
      effects: this.gutterCompartment.reconfigure(show ? lineNumbers() : []),
    });
  }

  focus(): void {
    this.view.focus();
  }

  openSearch(): void {
    openSearchPanel(this.view);
  }

  scrollToLine(line: number, column = 1): void {
    const doc = this.view.state.doc;
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
    const position = Math.min(target.from + column - 1, target.to);
    this.view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: 'center' }),
    });
    this.view.focus();
  }

  scrollToRatio(ratio: number): void {
    const element = this.view.scrollDOM;
    const max = element.scrollHeight - element.clientHeight;
    if (max <= 0) return;
    element.scrollTop = max * Math.min(Math.max(ratio, 0), 1);
  }

  /** Wraps the selection, or inserts a placeholder between the markers. */
  wrapSelection(before: string, after = before, placeholderText = 'текст'): void {
    const state = this.view.state;
    const range = state.selection.main;
    const selected = state.sliceDoc(range.from, range.to) || placeholderText;
    const insert = before + selected + after;
    this.view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: {
        anchor: range.from + before.length,
        head: range.from + before.length + selected.length,
      },
    });
    this.view.focus();
  }

  /** Inserts a block on its own line(s), keeping surrounding lines intact. */
  insertBlock(block: string): void {
    const state = this.view.state;
    const range = state.selection.main;
    const line = state.doc.lineAt(range.from);
    const needsLeadingBreak = line.from !== range.from;
    const needsTrailingBreak = line.to !== range.to;
    const prefix = needsLeadingBreak ? '\n' : '';
    const suffix = needsTrailingBreak ? '\n' : '';
    const insert = prefix + block + suffix;
    this.view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + prefix.length + block.length },
    });
    this.view.focus();
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener('scroll', this.handleScroll);
    this.view.destroy();
  }
}

/** Kept as an explicit alias so module imports stay readable. */
export type EditorExtension = Extension;
