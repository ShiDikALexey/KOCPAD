import './style.css';

import { Store } from './store';
import { journal } from './journal';
import { decodeAs, decodeText, encodeText, type TextEncoding } from './encoding';
import { runRules } from './lint/engine';
import { createStorage } from './storage';
import { MarkdownEditor, BLOCK_LABELS, BLOCK_TYPES, type BlockType } from './editor';
import {
  buildExportHtml,
  decoratePreview,
  documentTitle,
  printHtml,
  renderMarkdown,
  renderWikiLinks,
  setSoftBreaks,
  toggleTaskAtIndex,
} from './markdown';
import { TreeView } from './ui/tree';
import { TabsView } from './ui/tabs';
import { StatusBar } from './ui/statusbar';
import { GlobalSearchPanel } from './ui/gsearch';
import { OutlineView } from './ui/outline';
import { TagsView } from './ui/tags';
import { LinksView } from './ui/links';
import { openDraftsPanel } from './ui/drafts';
import { openTrashPanel } from './ui/trash';
import { trash } from './trash';
import { decorateWikiLinks } from './wikilinks';
import { openPalette, type Command } from './ui/palette';
import { openSettings } from './ui/settings';
import { choiceDialog, confirmAction, promptText, showMenu, showToast, type MenuItem } from './ui/dialog';
import { folderPicker } from './ui/pickers';
import { icon, type IconName } from './ui/icons';
import type { AppActions } from './ui/actions';
import { ImageStore } from './images';
import { isDraftPath, draftIdOf } from './drafts';
import { isTauriRuntime } from './storage';
import { invoke } from '@tauri-apps/api/core';
import type { EditorKeymap, PreviewFont, SidebarTab, ViewMode } from './types';
import { basename, dirname, isTextFile, joinPath } from './path';
import { clamp, debounce, plural, bytesToBase64 } from './util';

const TABS_KEY = 'kocpad.tabs';

const store = new Store(createStorage());
const imageStore = new ImageStore(store.storage);

/** Typed element lookup, throws early when the shell markup drifts. */
function must<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Элемент #${id} не найден в разметке`);
  return node as T;
}

const dom = {
  app: must('app'),
  docTitle: must('doc-title'),
  workspaceName: must('workspace-name'),
  sidebar: must('sidebar'),
  sidebarResizer: must('sidebar-resizer'),
  sidebarCount: must('sidebar-count'),
  tree: must('tree'),
  treeFilter: must<HTMLInputElement>('tree-filter'),
  outline: must('outline'),
  tags: must('tags'),
  links: must('links'),
  tabs: must('tabs'),
  panes: must('panes'),
  editorHost: must('editor'),
  preview: must('preview'),
  emptyState: must('empty-state'),
  splitter: must('splitter'),
  statusMode: must('status-mode'),
  btnDrafts: must('btn-drafts'),
  draftsBadge: must('drafts-badge'),
  formatbar: must('formatbar'),
  blockType: must('block-type'),
  blockTypeLabel: must('block-type-label'),
  blockHint: must('block-hint'),
  overlay: must('overlay'),
} as const;

// --------------------------------------------------------------------- theme

const media = window.matchMedia('(prefers-color-scheme: dark)');

function resolvedTheme(): 'light' | 'dark' {
  const mode = store.settings.theme;
  if (mode === 'system') return media.matches ? 'dark' : 'light';
  return mode;
}

function applyTheme(): void {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  const button = document.getElementById('btn-theme');
  if (button) {
    const label = { light: 'светлая', dark: 'тёмная', system: 'как в Windows' }[store.settings.theme];
    button.replaceChildren(icon(store.settings.theme === 'system' ? 'monitor' : theme === 'dark' ? 'moon' : 'sun', 15));
    button.title = `Тема: ${label}. Нажмите, чтобы переключить светлую и тёмную`;
    button.setAttribute('aria-label', button.title);
  }
}

media.addEventListener('change', () => {
  if (store.settings.theme === 'system') applyTheme();
});

// -------------------------------------------------------------------- layout

/** Font stacks offered by the settings screen. */
const PREVIEW_FONT_STACK: Record<PreviewFont, string> = {
  serif: 'var(--font-read)',
  sans: 'var(--font-ui)',
  mono: 'var(--font-mono)',
};

function applyTypography(): void {
  const settings = store.settings;
  const root = document.documentElement;
  root.dataset.accent = settings.accent;
  root.style.setProperty('--editor-font-size', `${settings.editorFontSize}px`);
  root.style.setProperty('--font-editor', settings.editorFontFamily || 'var(--font-mono)');
  root.style.setProperty('--preview-font-size', `${settings.previewFontSize}px`);
  root.style.setProperty('--preview-font', PREVIEW_FONT_STACK[settings.previewFontFamily]);
}

let shownSidebarTab: SidebarTab | null = null;

function applySidebarTab(): void {
  const tab = store.settings.sidebarTab;
  document.querySelectorAll<HTMLButtonElement>('.sidebar__tab').forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle('sidebar__tab--active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  const notesVisible = tab === 'notes';
  dom.tree.hidden = !notesVisible;
  dom.treeFilter.hidden = !notesVisible;
  dom.outline.hidden = tab !== 'outline';
  dom.tags.hidden = tab !== 'tags';
  dom.links.hidden = tab !== 'links';
  const changed = shownSidebarTab !== tab;
  shownSidebarTab = tab;
  // Settings, theme and layout changes also land here; re-indexing the workspace
  // on every theme toggle would be wasteful, so only react to actual tab switches.
  if (tab === 'outline' && changed) outline.render();
  if (tab === 'tags' && changed) tagsView.activate();
  if (tab === 'links' && changed) linksView.activate();
}

/** Close-folder control only exists while a workspace is connected. */
function applyWorkspaceChrome(): void {
  const button = document.getElementById('btn-close-folder');
  if (!button) return;
  button.hidden = !store.storage.root;
  const demo = store.storage.kind === 'demo';
  button.title = demo ? 'Сбросить демо-заметки' : 'Закрыть папку';
  button.setAttribute('aria-label', button.title);
}

let appliedTabSize = 0;
let appliedKeymap: EditorKeymap = 'default';

/** Tab width and keymap live in the editor instance, not only in CSS. */
function applyEditorSettings(): void {
  const settings = store.settings;
  if (settings.editorTabSize !== appliedTabSize) {
    appliedTabSize = settings.editorTabSize;
    editor.setTabSize(settings.editorTabSize);
  }
  if (settings.editorKeymap !== appliedKeymap) {
    appliedKeymap = settings.editorKeymap;
    void editor.setKeymap(settings.editorKeymap);
  }
}

function applyLayout(): void {
  const settings = store.settings;
  dom.sidebar.classList.toggle('sidebar--collapsed', !settings.sidebarOpen);
  dom.sidebarResizer.hidden = !settings.sidebarOpen;
  // Distraction-free writing: CSS hides the sidebar and the preview.
  document.body.classList.toggle('focus-mode', settings.focusMode);
  document.documentElement.style.setProperty('--sidebar-width', `${clamp(settings.sidebarWidth, 180, 520)}px`);
  dom.panes.dataset.mode = settings.mode;
  document.documentElement.style.setProperty('--split-left', `${clamp(settings.splitRatio, 0.15, 0.85) * 100}%`);
  dom.statusMode.textContent = settings.editorKeymap === 'vim'
    ? `${{
        editor: 'Редактор',
        split: 'Разделить',
        preview: 'Просмотр',
      }[settings.mode]} · Vim`
    : {
        editor: 'Редактор',
        split: 'Разделить',
        preview: 'Просмотр',
      }[settings.mode];
  document.querySelectorAll<HTMLButtonElement>('.segmented__item').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === settings.mode));
  });
  applyTheme();
  applyTypography();
  applySidebarTab();
  applyWorkspaceChrome();
  applyEditorSettings();
  applySoftBreaks();
}

/** Soft line breaks change the rendered HTML, so the preview must be rebuilt. */
let appliedSoftBreaks: boolean | null = null;

function applySoftBreaks(): void {
  const value = store.settings.softBreaks;
  if (appliedSoftBreaks === value) return;
  appliedSoftBreaks = value;
  setSoftBreaks(value);
  if (store.activeDoc) {
    lastPreviewSource = '\u0000';
    schedulePreview();
  }
}

// -------------------------------------------------------------------- editor

let suppressPreviewRender = false;

// ---------------------------------------------------------------- format bar

/** Guards against early calls while the editor is still being constructed. */
let formatBarReady = false;

function blockHintFor(type: BlockType): string | undefined {
  if (type === 'h1') return 'Ctrl+Alt+1';
  if (type === 'h2') return 'Ctrl+Alt+2';
  if (type === 'h3') return 'Ctrl+Alt+3';
  if (type === 'paragraph') return 'Ctrl+Alt+0';
  return undefined;
}

/** Keeps the block-type button in sync with the caret line. */
function updateFormatBar(): void {
  if (!formatBarReady) return;
  const doc = store.activeDoc;
  dom.formatbar.hidden = !doc;
  if (doc) dom.blockTypeLabel.textContent = BLOCK_LABELS[editor.blockType];
}

function openBlockMenu(anchor: { x: number; y: number }): void {
  showMenu(
    anchor,
    BLOCK_TYPES.map((type) => ({
      label: BLOCK_LABELS[type],
      hint: blockHintFor(type),
      group: 'columns',
      onClick: () => {
        editor.setBlockType(type);
        updateFormatBar();
      },
    })),
    { key: 'block-type', anchorElement: dom.blockType },
  );
}

/** Editor context menu: clipboard, inline formatting and block conversion. */
function openEditorMenu(
  anchor: { x: number; y: number },
  withClipboard: boolean,
  key?: string,
  anchorElement?: HTMLElement,
): void {
  if (!store.activeDoc) return;
  const hasSelection = editor.hasSelection;
  const items: MenuItem[] = [];

  if (withClipboard && hasSelection) {
    items.push(
      {
        label: 'Вырезать',
        hint: 'Ctrl+X',
      group: 'columns',
        onClick: () => {
          void editor.cutSelection().then((ok) => {
            if (!ok) showToast('Буфер обмена недоступен', 'error');
            updateFormatBar();
          });
        },
      },
      {
        label: 'Копировать',
        hint: 'Ctrl+C',
      group: 'columns',
        onClick: () => {
          void editor.copySelection().then((ok) => {
            if (!ok) showToast('Буфер обмена недоступен', 'error');
          });
        },
      },
    );
  }

  items.push({
    label: 'Вставить',
    hint: 'Ctrl+V',
      group: 'columns',
    onClick: () => {
      void editor.pasteClipboard().then((ok) => {
        if (!ok) showToast('Не удалось прочитать буфер — нажмите Ctrl+V', 'error');
        else updateFormatBar();
      });
    },
  });

  items.push({ separator: true });
  items.push(
    {
      label: 'Жирный',
      hint: 'Ctrl+B',
      group: 'columns',
      onClick: () => {
        editor.formatBold();
        updateFormatBar();
      },
    },
    {
      label: 'Курсив',
      hint: 'Ctrl+I',
      group: 'columns',
      onClick: () => {
        editor.formatItalic();
        updateFormatBar();
      },
    },
    {
      label: 'Зачёркнутый',
      group: 'columns',
      onClick: () => {
        editor.formatStrike();
        updateFormatBar();
      },
    },
    {
      label: 'Код в строке',
      hint: 'Ctrl+`',
      group: 'columns',
      onClick: () => {
        editor.formatCode();
        updateFormatBar();
      },
    },
    {
      label: 'Ссылка',
      hint: 'Ctrl+Shift+K',
      group: 'columns',
      onClick: () => {
        editor.formatLink();
        updateFormatBar();
      },
    },
  );

  items.push({ separator: true });
  const blockItems: BlockType[] = ['h1', 'h2', 'h3', 'bullet', 'ordered', 'task', 'quote', 'code', 'hr'];
  for (const type of blockItems) {
    items.push({
      label: BLOCK_LABELS[type],
      hint: blockHintFor(type),
      group: 'columns',
      onClick: () => {
        editor.setBlockType(type);
        updateFormatBar();
      },
    });
  }

  if (hasSelection) {
    items.push(
      { separator: true },
      { label: 'Найти выделенное', hint: 'Ctrl+F', onClick: () => editor.findSelection() },
    );
  }

  items.push({ separator: true }, {
    label: 'Убрать форматирование',
    onClick: () => {
      editor.clearFormatting();
      updateFormatBar();
    },
  });

  showMenu(anchor, items, { ...(key ? { key } : {}), ...(anchorElement ? { anchorElement } : {}) });
}

function mountFormatBar(): void {
  dom.blockType.addEventListener('click', () => {
    const rect = dom.blockType.getBoundingClientRect();
    openBlockMenu({ x: rect.left, y: rect.bottom + 4 });
  });
  dom.blockHint.addEventListener('click', () => {
    const rect = dom.blockHint.getBoundingClientRect();
    openEditorMenu({ x: rect.left, y: rect.bottom + 4 }, false, 'editor-menu', dom.blockHint);
  });
  dom.formatbar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-format]');
    const kind = button?.dataset.format;
    if (!kind) return;
    const handlers: Record<string, () => void> = {
      bold: () => editor.formatBold(),
      italic: () => editor.formatItalic(),
      strike: () => editor.formatStrike(),
      code: () => editor.formatCode(),
      link: () => editor.formatLink(),
    };
    handlers[kind]?.();
    updateFormatBar();
  });
  dom.editorHost.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.cm-content') || !store.activeDoc) return;
    event.preventDefault();
    openEditorMenu({ x: event.clientX, y: event.clientY }, true);
  });
  formatBarReady = true;
}

const editor = new MarkdownEditor(
  dom.editorHost,
  {
    onChange: (text) => {
      const path = store.activePath;
      if (!path) return;
      store.updateContent(path, text);
    },
    onScrollRatio: (ratio) => syncFromEditor(ratio),
    onCursor: (line, column, selectionLength) => {
      statusBar.setCursor({ line, column, selectionLength });
      outline.setCursor(line);
      updateFormatBar();
    },
  },
  { showLineNumbers: store.settings.showLineNumbers, lint: {
    enabled: () => store.settings.assistant,
    disabledRules: () => store.settings.disabledLintRules,
    onEvent: (rule, outcome) => {
      if (outcome !== 'disabled') return;
      if (store.settings.disabledLintRules.includes(rule)) return;
      store.patchSettings({
        disabledLintRules: [...store.settings.disabledLintRules, rule],
      });
      showToast('Правило больше не будет предлагаться · вернуть можно в настройках', 'info');
    },
  } },
);

// ---------------------------------------------------------------- preview

let lastPreviewSource = '';
let previewScrollLock = false;
let editorScrollLock = false;

const renderPreviewNow = (): void => {
  const doc = store.activeDoc;
  const source = doc?.content ?? '';
  lastPreviewSource = source;
  const isSplit = store.settings.mode === 'split';
  const isPreview = store.settings.mode === 'preview';
  if (!doc || (!isSplit && !isPreview)) {
    dom.preview.innerHTML = '';
    dom.preview.classList.toggle('markdown--empty', true);
    return;
  }
  dom.preview.classList.remove('markdown--empty');
  dom.preview.innerHTML = renderMarkdown(source);
  decoratePreview(dom.preview);
  decorateWikiLinks(dom.preview, (target) => store.resolveLink(target));
  void imageStore.decorate(dom.preview, doc.path).catch(() => undefined);
};

const schedulePreview = debounce(() => {
  if (suppressPreviewRender) return;
  renderPreviewNow();
}, 90);

function syncFromEditor(ratio: number): void {
  if (!store.settings.syncScroll || store.settings.mode !== 'split') return;
  if (previewScrollLock || editorScrollLock) return;
  previewScrollLock = true;
  const max = dom.preview.scrollHeight - dom.preview.clientHeight;
  dom.preview.scrollTop = ratio * Math.max(max, 0);
  window.requestAnimationFrame(() => {
    previewScrollLock = false;
  });
}

dom.preview.addEventListener('scroll', () => {
  if (!store.settings.syncScroll || store.settings.mode !== 'split') return;
  if (previewScrollLock || editorScrollLock) return;
  editorScrollLock = true;
  const max = dom.preview.scrollHeight - dom.preview.clientHeight;
  editor.scrollToRatio(max > 0 ? dom.preview.scrollTop / max : 0);
  window.requestAnimationFrame(() => {
    editorScrollLock = false;
  });
}, { passive: true });

dom.preview.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  const wiki = target.closest<HTMLElement>('.wikilink');
  if (wiki) {
    event.preventDefault();
    const linkTarget = wiki.dataset.target ?? '';
    const resolved = store.resolveLink(linkTarget);
    if (resolved) {
      void store.openNote(resolved.path);
    } else {
      void createNoteFromLink(linkTarget);
    }
    return;
  }

  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (link) {
    const href = link.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      event.preventDefault();
      void store.storage.openExternal(href);
      return;
    }
    if (href.startsWith('#')) return;
    // Relative links to other notes: try to open them inside the workspace.
    const doc = store.activeDoc;
    if (doc && !/^[a-z]+:/i.test(href)) {
      event.preventDefault();
      const candidate = joinPath(dirname(doc.path), decodeURI(href.split('#')[0]));
      void store.openNote(candidate);
    }
    return;
  }

  const checkbox = target.closest<HTMLInputElement>('input.task-checkbox');
  if (checkbox && store.activeDoc) {
    event.preventDefault();
    const boxes = Array.from(dom.preview.querySelectorAll('input.task-checkbox'));
    const index = boxes.indexOf(checkbox);
    if (index < 0) return;
    const doc = store.activeDoc;
    const next = toggleTaskAtIndex(doc.content, index);
    const caret = editor.caret;
    editor.applyText(next);
    editor.caret = Math.min(caret, next.length);
  }
});

// ---------------------------------------------------------------- documents

function updateTitle(): void {
  const doc = store.activeDoc;
  const dirty = doc ? store.isDirty(doc) : false;
  dom.docTitle.textContent = doc ? `${doc.name}${dirty ? ' •' : ''}` : 'Без названия';
  dom.docTitle.title = doc ? doc.path : '';
  document.title = doc ? `${doc.name}${dirty ? ' •' : ''} — KOCPAD` : 'KOCPAD';
}

/** Keeps editor, preview and chrome in sync with the active document. */
function syncActive(): void {
  const doc = store.activeDoc;
  const hasDoc = Boolean(doc);
  document.body.classList.toggle('has-doc', hasDoc);
  dom.emptyState.hidden = hasDoc;
  dom.editorHost.hidden = !hasDoc;

  if (!doc) {
    dom.preview.innerHTML = '';
    updateFormatBar();
    updateTitle();
    return;
  }

  editor.open(doc.path, doc.content);
  editor.setLineNumbers(store.settings.showLineNumbers);
  updateFormatBar();
  if (doc.content !== lastPreviewSource) schedulePreview();
  updateTitle();
  statusBar.setCursor({ line: editor.cursorLine, column: 1, selectionLength: 0 });
}

function resetPreviewScroll(): void {
  dom.preview.scrollTop = 0;
}

// ----------------------------------------------------------------- tabs state

function persistTabs(): void {
  try {
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({ paths: store.docs.map((doc) => doc.path), active: store.activePath }),
    );
  } catch {
    // Persisting tabs is a nicety; ignore quota errors.
  }
}

/** Structural changes are rare; typing is not, so the tab record is debounced. */
const schedulePersistTabs = debounce(persistTabs, 300);

async function restoreTabs(): Promise<void> {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { paths?: string[]; active?: string | null };
    const available = new Set(store.flatFiles().map((node) => node.path));
    const saved = parsed.paths ?? [];

    // Drafts and files are both tab paths now; drafts open from local storage.
    for (const path of saved) {
      if (isDraftPath(path)) store.openDraft(draftIdOf(path));
      else if (available.has(path)) await store.openNote(path, { focus: false });
    }
    store.reorderDocs(saved);
    if (parsed.active && store.docs.some((doc) => doc.path === parsed.active)) {
      store.activate(parsed.active);
    }
  } catch {
    // A corrupt entry just means we start with no tabs.
  }
}

// ------------------------------------------------------------------- actions

/** Asks the release endpoint for a signed update and installs it on consent. */
async function checkForUpdates(): Promise<void> {
  if (!isTauriRuntime()) {
    showToast('Обновления проверяются только в приложении KOCPAD', 'info');
    return;
  }

  let current = '';
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    current = await getVersion();
  } catch {
    // The version is only used in the toast text.
  }

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      showToast(current ? `Обновлений нет · установлена ${current}` : 'Обновлений нет');
      return;
    }

    const confirmed = await confirmAction({
      title: `Доступно обновление ${update.version}`,
      message:
        update.body?.trim() ||
        'Скачать и установить новую версию? KOCPAD закроется, установит обновление, после чего его нужно будет запустить снова.',
      confirmLabel: 'Обновить',
    });
    if (!confirmed) return;

    showToast('Скачиваю обновление…');
    await update.downloadAndInstall();
    showToast('Обновление установлено. Запустите KOCPAD снова.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint =
      message.includes('Could not fetch') || message.includes('release JSON')
        ? ' — в последнем релизе ещё нет файла обновления'
        : '';
    showToast(`Не удалось проверить обновления: ${message}${hint}`, 'error');
  }
}

/** Re-reads the workspace and drops cached text so external edits are visible. */
function reloadWorkspace(): void {
  const active = store.activeDoc;
  const activePath = active && !isDraftPath(active.path) ? active.path : null;
  const dirty = active ? store.isDirty(active) : false;
  store.clearTextCache();
  void store.refreshTree().then(async () => {
    // F5 is also the manual escape hatch for external edits: re-read the open
    // note, but never throw away unsaved text.
    if (activePath && !dirty) {
      await store.reloadDoc(activePath);
      const fresh = store.docs.find((doc) => doc.path === activePath);
      if (fresh && store.activePath === activePath) editor.applyText(fresh.content);
    }
    showToast(
      `Дерево обновлено · ${store.flatFiles().length} заметок${dirty ? ' · несохранённые правки не тронуты' : ''}`,
    );
  });
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

function mimeFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME[extension] ?? 'application/octet-stream';
}

/** Embeds relative images from `assets/` into the exported document. */
async function inlineExportImages(html: string, baseDir: string): Promise<string> {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const image of [...parsed.querySelectorAll('img')]) {
    const source = image.getAttribute('src') ?? '';
    if (!source || /^(?:https?:|data:|blob:)/i.test(source)) continue;
    const target = joinPath(baseDir, decodeURIComponent(source));
    try {
      const bytes = await store.storage.readBinary(target);
      image.setAttribute('src', `data:${mimeFor(target)};base64,${bytesToBase64(bytes)}`);
    } catch {
      image.removeAttribute('src');
      const alt = image.getAttribute('alt') ?? '';
      image.setAttribute('alt', alt ? `${alt} (изображение не найдено)` : 'изображение не найдено');
    }
  }
  return `<!DOCTYPE html>\n${parsed.documentElement.outerHTML}`;
}

/** Full export/print document: rendered markdown, wikilinks and embedded images. */
async function buildExportDocument(doc: {
  path: string;
  name: string;
  content: string;
}): Promise<{ title: string; html: string }> {
  const title = documentTitle(doc.name);
  const body = renderWikiLinks(renderMarkdown(doc.content));
  const baseDir = isDraftPath(doc.path) ? '' : dirname(doc.path);
  const html = await inlineExportImages(
    buildExportHtml(title, body, { theme: store.settings.exportTheme }),
    baseDir,
  );
  return { title, html };
}

/** Creates a note for an unresolved `[[link]]` in the current folder. */
async function createNoteFromLink(target: string): Promise<string | null> {
  const clean = target.trim();
  if (!clean) return null;
  if (!store.storage.root) {
    showToast('Сначала подключите папку с заметками', 'info');
    return null;
  }
  const name = clean.replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '').slice(0, 120);
  if (!name) return null;
  const active = store.activeDoc;
  const directory = active && !isDraftPath(active.path) ? dirname(active.path) : '';
  const path = joinPath(directory, `${name}.md`);
  if (await store.storage.exists(path).catch(() => false)) {
    await store.openNote(path);
    return path;
  }
  const confirmed = await confirmAction({
    title: 'Создать заметку?',
    message: `Заметки «${clean}» пока нет. Создать её в текущей папке?`,
    confirmLabel: 'Создать',
  });
  if (!confirmed) return null;
  try {
    await store.storage.createFile(path, `# ${clean}\n\n`);
    await store.refreshTree();
    await store.openNote(path);
    showToast(`Создана · ${name}.md`, 'success');
    return path;
  } catch (error) {
    showToast(`Не удалось создать заметку: ${(error as Error).message}`, 'error');
    return null;
  }
}

/** Asks what to do when a file changed on disk while it had unsaved edits. */
async function showConflictDialog(path: string): Promise<void> {
  const doc = store.docs.find((item) => item.path === path);
  if (!doc) return;
  const choice = await choiceDialog({
    title: 'Файл изменён на диске',
    message: `«${doc.name}» изменён другой программой, пока вы его редактировали. KOCPAD не стал перезаписывать файл, чтобы не потерять чужую версию.`,
    options: [
      { id: 'reload', label: 'Перечитать с диска', kind: 'primary' },
      { id: 'mine', label: 'Оставить моё' },
      { id: 'copy', label: 'Сохранить копию' },
    ],
  });
  if (!choice) return;
  const resolved = await store.resolveConflict(path, choice as 'reload' | 'mine' | 'copy');
  if (!resolved) {
    showToast('Не удалось разрешить конфликт — попробуйте ещё раз', 'error');
    return;
  }
  if (choice !== 'mine') {
    const current = store.docs.find((item) => item.path === path);
    if (current && store.activePath === path) editor.applyText(current.content);
  }
  if (choice === 'mine') showToast('Записана ваша версия');
}

/** Re-reads the active note with a forced encoding ("Open as…"). */
async function reopenAs(encoding: TextEncoding): Promise<void> {
  const doc = store.activeDoc;
  if (!doc || isDraftPath(doc.path)) {
    showToast('Кодировка применяется к файлу заметки, а не к черновику', 'info');
    return;
  }
  const ok = await store.reopenWithEncoding(doc.path, encoding);
  if (!ok) return;
  editor.applyText(doc.content);
  showToast(`Открыто как ${encoding}`, 'success');
}

/** Offers text left behind by a kill or a power cut (written by the journal). */
async function offerRecovery(): Promise<void> {
  const pending = await store.recoverPending();
  for (const entry of pending) {
    const when = new Date(entry.savedAt);
    const time = `${when.toLocaleDateString('ru-RU')} ${when.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
    const choice = await choiceDialog({
      title: 'Найден несохранённый текст',
      message: `«${basename(entry.path)}» — снапшот от ${time}. KOCPAD не успел записать файл, но сохранил текст в журнале. Восстановить?`,
      options: [
        { id: 'restore', label: 'Восстановить', kind: 'primary' },
        { id: 'open', label: 'Открыть файл с диска' },
        { id: 'delete', label: 'Удалить снапшот', kind: 'danger' },
      ],
    });
    if (choice === 'restore') {
      const ok = await store.restoreJournalEntry(entry);
      if (ok) {
        const doc = store.docs.find((item) => item.path === entry.path);
        if (doc) editor.applyText(doc.content);
        showToast('Текст восстановлен — проверьте и сохраните');
      }
    } else if (choice === 'open') {
      await store.openNote(entry.path).catch(() => null);
      await journal.remove(entry.key);
    } else {
      await journal.remove(entry.key);
    }
  }
}

/** Focus/visibility checks: another program may have touched an open note. */
function mountExternalChangeWatch(): void {
  let lastCheck = 0;
  const check = (): void => {
    const now = Date.now();
    if (now - lastCheck < 2000) return;
    lastCheck = now;
    void store.checkExternalChanges();
  };
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

function targetDirectory(): string {
  const doc = store.activeDoc;
  return doc ? dirname(doc.path) : '';
}

/** Opens the folder picker and mounts the result. Shared by "Открыть папку" and friends. */
async function chooseWorkspace(): Promise<boolean> {
  try {
    const failed = await store.saveAll();
    if (failed > 0) {
      showToast(`Не удалось сохранить ${failed} заметок. Папка не переключена — проверьте диск`, 'error');
      return false;
    }
    const ok = await store.chooseRoot();
    if (!ok) return false;
    if (store.storage.root) localStorage.setItem('kocpad.root', store.storage.root);
    await restoreTabs();
    if (!store.activeDoc) {
      const first = store.flatFiles()[0];
      if (first) await store.openNote(first.path);
    }
    showToast(`Папка подключена · ${store.rootName}`, 'success');
    return true;
  } catch (error) {
    showToast(`Не удалось открыть папку: ${(error as Error).message}`, 'error');
    return false;
  }
}

/**
 * A new note appears immediately with an automatic name — no dialog in the way.
 * Without a folder it becomes an untitled draft stored locally, exactly like the
 * Windows notepad opens an empty buffer.
 */
async function createNoteNow(parentDir?: string): Promise<void> {
  if (!store.storage.root) {
    await store.createDraftDoc();
    window.setTimeout(() => editor.focus(), 60);
    return;
  }
  const dir = parentDir ?? targetDirectory();
  const path = await store.createNoteAuto(dir);
  if (path) window.setTimeout(() => editor.focus(), 60);
}

/** Closing a tab: drafts are thrown away (after a confirmation), files are saved. */
async function closeTabNow(path: string): Promise<void> {
  const doc = store.docs.find((item) => item.path === path);
  if (!doc) return;
  // Closing a draft tab only closes the tab: the draft stays in local storage
  // and remains available in the drafts panel.
  await store.closeDoc(path);
}

/** Turns the active draft into a real .md file: folder picker (if needed) + name. */
async function saveDraftToFolder(): Promise<void> {
  const doc = store.activeDoc;
  if (!doc || !isDraftPath(doc.path)) {
    showToast('Активная заметка уже сохранена в файл', 'info');
    return;
  }
  if (!store.storage.root && !(await chooseWorkspace())) return;
  const dir = store.importDir;
  const name = await promptText({
    title: 'Сохранить в папку',
    label: `Папка: ${store.rootName}${dir ? ` / ${basename(dir)}` : ''}`,
    value: `${doc.name}.md`,
    confirmLabel: 'Сохранить',
    validate: (value) => (value.trim() ? null : 'Введите имя файла'),
  });
  if (!name) return;
  const previousPath = doc.path;
  const saved = await store.saveDraftAsFile(doc.path, dir, name);
  if (saved) {
    editor.forget(previousPath);
    showToast(`Сохранено · ${basename(saved)}`, 'success');
  }
}

async function renameDraftNow(): Promise<void> {
  const doc = store.activeDoc;
  if (!doc || !isDraftPath(doc.path)) return;
  const title = await promptText({
    title: 'Переименовать черновик',
    label: 'Название',
    value: doc.name,
    confirmLabel: 'Переименовать',
  });
  if (title) store.renameDraft(doc.path, title);
}

/** Reopens a folder from the recent list — native builds only, browsers cannot. */
async function openRecentFolderNow(path: string): Promise<void> {
  const ok = await store.openWorkspaceByPath(path);
  if (!ok) {
    showToast('Папка недоступна по этому пути — выберите её через «Открыть папку»', 'error');
    return;
  }
  localStorage.setItem('kocpad.root', path);
  await restoreTabs();
  if (!store.activeDoc) {
    const first = store.flatFiles()[0];
    if (first) await store.openNote(first.path);
  }
  showToast(`Папка подключена · ${store.rootName}`, 'success');
}

/** One screen on the very first launch: start with a draft or pick a folder. */
async function runOnboarding(): Promise<void> {
  if (store.settings.onboarded) return;
  store.patchSettings({ onboarded: true });
  const choice = await choiceDialog({
    title: 'Добро пожаловать в KOCPAD',
    message: 'Блокнот для markdown-заметок. Начать можно сразу с чистого листа или подключить готовую папку с заметками.',
    options: [
      { id: 'draft', label: 'Начать с черновика', kind: 'primary' },
      { id: 'folder', label: 'Открыть папку заметок' },
    ],
  });
  if (choice === 'draft') await createNoteNow();
  else if (choice === 'folder') await chooseWorkspace();
}

async function closeCurrentWorkspace(): Promise<void> {  const demo = store.storage.kind === 'demo';
  const confirmed = demo
    ? await confirmAction({
        title: 'Сбросить демо-заметки?',
        message: 'Правки, сделанные в демо-режиме, будут потеряны. Файлы на диске это не затрагивает.',
        confirmLabel: 'Сбросить',
        danger: true,
      })
    : await confirmAction({
        title: 'Закрыть папку?',
        message: `Папка «${store.rootName}» будет отключена. Заметки останутся на диске — ничего не удаляется.`,
        confirmLabel: 'Закрыть папку',
      });
  if (!confirmed) return;
  await store.closeWorkspace();
  if (!demo) showToast('Папка закрыта, заметки на диске', 'success');
}

const actions: AppActions = {
  openFolder: () => {
    void chooseWorkspace();
  },

  openRecentFolder: (path) => {
    void openRecentFolderNow(path);
  },

  refreshWorkspace: () => reloadWorkspace(),

  toggleFocusMode: () => {
    const enabled = !store.settings.focusMode;
    store.patchSettings({ focusMode: enabled });
    showToast(enabled ? 'Режим сосредоточения: шапка и панели скрыты' : 'Обычный режим');
    editor.focus();
  },

  formatBold: () => editor.formatBold(),
  formatItalic: () => editor.formatItalic(),
  formatCode: () => editor.formatCode(),
  formatLink: () => editor.formatLink(),

  setBlockType: (type) => {
    editor.setBlockType(type);
    updateFormatBar();
  },

  clearFormatting: () => {
    editor.clearFormatting();
    updateFormatBar();
  },

  findSelection: () => editor.findSelection(),

  closeWorkspace: () => {
    void closeCurrentWorkspace();
  },

  createNote: (parentDir) => {
    void createNoteNow(parentDir);
  },

  createFolder: (parentDir) => {
    void (async () => {
      const dir = parentDir ?? targetDirectory();
      const name = await promptText({
        title: 'Новая папка',
        label: dir ? `Внутри: ${basename(dir) || store.rootName}` : `Внутри: ${store.rootName}`,
        value: 'Новая папка',
        confirmLabel: 'Создать',
        validate: (value) => (value.trim() ? null : 'Введите имя папки'),
      });
      if (name) await store.createFolder(dir, name);
    })();
  },

  renameEntry: (node) => {
    void (async () => {
      const name = await promptText({
        title: 'Переименовать',
        label: node.kind === 'dir' ? 'Имя папки' : 'Имя заметки',
        value: node.name,
        confirmLabel: 'Переименовать',
      });
      if (name) await store.renameEntry(node, name);
    })();
  },

  deleteEntry: (node) => {
    void (async () => {
      const what = node.kind === 'dir' ? 'папку' : 'заметку';
      const ok = await confirmAction({
        title: 'Удалить?',
        message: `Удалить ${what} «${node.name}»? Файлы удаляются с диска, отменить это внутри KOCPAD нельзя.`,
        confirmLabel: 'Удалить',
        danger: true,
      });
      if (ok) await store.deleteEntry(node);
    })();
  },

  deleteSelected: (paths) => {
    void (async () => {
      if (!paths.length) return;
      const ok = await confirmAction({
        title: 'Удалить заметки?',
        message: `Удалить ${paths.length} ${plural(paths.length, 'заметку', 'заметки', 'заметок')}? Файлы удаляются с диска, отменить это внутри KOCPAD нельзя.`,
        confirmLabel: 'Удалить',
        danger: true,
      });
      if (!ok) return;
      const result = await store.deleteMany(paths);
      tree.clearSelection();
      showToast(
        result.failed.length
          ? `Удалено: ${result.deleted}, не удалось: ${result.failed.length}`
          : `Удалено: ${result.deleted}`,
        result.failed.length ? 'error' : 'success',
      );
    })();
  },

  moveSelected: (paths) => {
    void (async () => {
      if (!paths.length) return;
      const folders = store.listFolders();
      if (folders.length <= 1) {
        showToast('В рабочей папке нет других папок — перемещать некуда', 'info');
        return;
      }
      const target = await folderPicker({
        title: `Переместить ${paths.length} ${plural(paths.length, 'заметку', 'заметки', 'заметок')}`,
        folders,
      });
      if (target === null) return;
      const result = await store.moveMany(paths, target);
      tree.clearSelection();
      const skipped = result.skipped.length ? `, пропущено: ${result.skipped.length}` : '';
      showToast(`Перемещено: ${result.moved}${skipped}`, result.skipped.length ? 'info' : 'success');
    })();
  },

  openNote: (path, options) => {
    void (async () => {
      const doc = await store.openNote(path);
      if (!doc) return;
      syncActive();
      if (options?.line) {
        window.setTimeout(() => editor.scrollToLine(options.line!, options.column ?? 1), 30);
      }
    })();
  },

  closeTab: (path) => {
    void closeTabNow(path);
  },

  saveDraftAsFile: () => {
    void saveDraftToFolder();
  },

  revealEntry: (node) => {
    void store.storage.reveal(node.path);
  },

  copyPath: (node) => {
    void navigator.clipboard
      .writeText(node.path)
      .then(() => showToast('Путь скопирован', 'success'))
      .catch(() => showToast('Не удалось скопировать путь', 'error'));
  },

  saveAll: () => {
    void store.saveAll().then(() => updateTitle());
  },

  reloadActive: () => {
    void (async () => {
      const doc = store.activeDoc;
      if (!doc) return;
      if (store.isDirty(doc)) {
        const ok = await confirmAction({
          title: 'Перечитать файл?',
          message: 'Несохранённые изменения будут потеряны. Продолжить?',
          confirmLabel: 'Перечитать',
          danger: true,
        });
        if (!ok) return;
      }
      await store.reloadDoc(doc.path);
      editor.setContent(store.activeDoc?.content ?? '');
      renderPreviewNow();
      showToast('Файл перечитан с диска', 'success');
    })();
  },

  exportHtml: () => {
    void (async () => {
      const doc = store.activeDoc;
      if (!doc) {
        showToast('Откройте заметку для экспорта', 'error');
        return;
      }
      const { title, html } = await buildExportDocument(doc);
      const saved = await store.storage.saveAs(`${title}.html`, html, 'text/html;charset=utf-8');
      if (saved) showToast(store.storage.kind === 'tauri' ? `Сохранено: ${saved}` : 'HTML-файл скачан', 'success');
    })();
  },

  printPdf: () => {
    void (async () => {
      const doc = store.activeDoc;
      if (!doc) {
        showToast('Откройте заметку для печати', 'error');
        return;
      }
      const { html } = await buildExportDocument(doc);
      printHtml(html);
      showToast('Выберите «Сохранить как PDF» в диалоге печати');
    })();
  },

  toggleTheme: () => {
    // Light/dark is a two-way switch; "follow Windows" lives in the menu.
    store.setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
    applyTheme();
  },

  setTheme: (theme) => {
    store.setTheme(theme);
    applyTheme();
  },

  cycleMode: () => {
    const modes: ViewMode[] = ['editor', 'split', 'preview'];
    const index = modes.indexOf(store.settings.mode);
    setMode(modes[(index + 1) % modes.length]);
  },

  setMode: (mode) => setMode(mode),

  toggleSidebar: () => {
    store.patchSettings({ sidebarOpen: !store.settings.sidebarOpen });
    applyLayout();
  },

  setSidebarTab: (tab: SidebarTab) => {
    store.patchSettings({ sidebarTab: tab });
    if (!store.settings.sidebarOpen) store.patchSettings({ sidebarOpen: true });
    applyLayout();
  },

  jumpToLine: (line: number) => {
    editor.scrollToLine(line);
  },

  openSettings: () => openSettings(store),

  openGlobalSearch: () => searchPanel.open(),
  openPalette: () => palette(),
  openFind: () => {
    if (store.activeDoc) editor.openSearch();
  },

  adjustFontSize: (delta) => {
    const size = clamp(store.settings.editorFontSize + delta, 11, 24);
    store.patchSettings({ editorFontSize: size });
    showToast(`Размер текста: ${size}px`);
  },

  toggleLineNumbers: () => {
    store.patchSettings({ showLineNumbers: !store.settings.showLineNumbers });
    editor.setLineNumbers(store.settings.showLineNumbers);
  },

  toggleSyncScroll: () => {
    store.patchSettings({ syncScroll: !store.settings.syncScroll });
    showToast(`Синхронная прокрутка: ${store.settings.syncScroll ? 'вкл' : 'выкл'}`);
  },
};

function setMode(mode: ViewMode): void {
  store.setMode(mode);
  applyLayout();
  renderPreviewNow();
}

// -------------------------------------------------------------------- views

const tree = new TreeView(must('tree'), store, actions);
const tabsView = new TabsView(dom.tabs, store, actions);
const statusBar = new StatusBar(store);
const searchPanel = new GlobalSearchPanel(store, actions);
const outline = new OutlineView(dom.outline, store, actions);
const tagsView = new TagsView(dom.tags, store, actions);
const linksView = new LinksView(dom.links, store, actions);

function palette(): void {
  const commands: Command[] = [
    { label: 'Открыть папку с заметками', hint: 'Ctrl+O', run: actions.openFolder },
    ...store.recentFolders.map((path) => ({
      label: `Недавняя папка: ${basename(path)}`,
      hint: path,
      run: () => actions.openRecentFolder(path),
    })),
    { label: 'Новая заметка', hint: 'Ctrl+N', run: () => actions.createNote() },
    { label: 'Черновики без файла…', run: () => openDraftsPanel(store) },
    { label: 'Корзина…', run: () => openTrashPanel(store) },
    { label: 'Кодировка: открыть как UTF-8', run: () => void reopenAs('utf-8') },
    { label: 'Кодировка: открыть как cp1251', run: () => void reopenAs('cp1251') },
    { label: 'Кодировка: открыть как UTF-16LE', run: () => void reopenAs('utf-16le') },
    { label: 'Новая папка', hint: 'Ctrl+Shift+N', run: () => actions.createFolder() },
    // Recently opened notes, newest first: the quick switcher most editors have.
    ...store
      .recentNoteEntries()
      .filter((entry) => entry.path !== store.activePath)
      .slice(0, 5)
      .map((entry) => ({
        label: `Недавняя заметка: ${entry.title}${entry.missing ? ' (нет файла)' : ''}`,
        hint: entry.path,
        run: () => actions.openNote(entry.path),
      })),
    { label: 'Формат: жирный', hint: 'Ctrl+B', run: actions.formatBold },
    { label: 'Формат: курсив', hint: 'Ctrl+I', run: actions.formatItalic },
    { label: 'Формат: код в строке', hint: 'Ctrl+`', run: actions.formatCode },
    { label: 'Формат: ссылка', hint: 'Ctrl+Shift+K', run: actions.formatLink },
    { label: 'Тип блока: текст', hint: 'Ctrl+Alt+0', run: () => actions.setBlockType('paragraph') },
    { label: 'Тип блока: заголовок 1', hint: 'Ctrl+Alt+1', run: () => actions.setBlockType('h1') },
    { label: 'Тип блока: заголовок 2', hint: 'Ctrl+Alt+2', run: () => actions.setBlockType('h2') },
    { label: 'Тип блока: заголовок 3', hint: 'Ctrl+Alt+3', run: () => actions.setBlockType('h3') },
    { label: 'Тип блока: чек-лист', run: () => actions.setBlockType('task') },
    { label: 'Тип блока: цитата', run: () => actions.setBlockType('quote') },
    { label: 'Тип блока: блок кода', run: () => actions.setBlockType('code') },
    { label: 'Тип блока: разделитель', run: () => actions.setBlockType('hr') },
    { label: 'Убрать форматирование', run: actions.clearFormatting },
    { label: 'Найти выделенное', hint: 'Ctrl+F', run: actions.findSelection },
    { label: 'Проверить обновления…', run: () => void checkForUpdates() },
    { label: 'Найти в заметке', hint: 'Ctrl+F', run: actions.openFind },
    { label: 'Найти во всех заметках', hint: 'Ctrl+Shift+F', run: actions.openGlobalSearch },
    { label: 'Настройки', hint: 'Ctrl+,', run: actions.openSettings },
    ...(store.activeDoc && isDraftPath(store.activeDoc.path)
      ? [{ label: 'Сохранить черновик в папку…', hint: 'Ctrl+S', run: actions.saveDraftAsFile }]
      : []),
    ...(store.storage.root
      ? [{
          label: store.storage.kind === 'demo' ? 'Сбросить демо-заметки' : 'Закрыть папку с заметками',
          run: actions.closeWorkspace,
        }]
      : []),
    { label: 'Панель: контур заметки', hint: 'Ctrl+Shift+O', run: () => actions.setSidebarTab('outline') },
    { label: 'Панель: теги', run: () => actions.setSidebarTab('tags') },
    { label: 'Панель: ссылки', run: () => actions.setSidebarTab('links') },
    { label: 'Панель: дерево заметок', run: () => actions.setSidebarTab('notes') },
    {
      label: store.settings.focusMode ? 'Режим сосредоточения: выключить' : 'Режим сосредоточения',
      hint: 'Ctrl+Shift+Z',
      run: actions.toggleFocusMode,
    },
    { label: 'Сохранить сейчас', hint: 'Ctrl+S', run: actions.saveAll },
    { label: 'Перечитать файл с диска', run: actions.reloadActive },
    {
      label: `Тема: ${resolvedTheme() === 'dark' ? 'тёмная' : 'светлая'}`,
      hint: 'Ctrl+Shift+L',
      run: actions.toggleTheme,
    },
    { label: 'Тема: как в Windows', run: () => actions.setTheme('system') },
    { label: 'Режим: редактор', run: () => setMode('editor') },
    { label: 'Режим: разделить', run: () => setMode('split') },
    { label: 'Режим: просмотр', run: () => setMode('preview') },
    { label: store.settings.sidebarOpen ? 'Скрыть боковую панель' : 'Показать боковую панель', hint: 'Ctrl+\\', run: actions.toggleSidebar },
    { label: `Размер текста ${store.settings.editorFontSize}px · больше`, hint: 'Ctrl+=', run: () => actions.adjustFontSize(1) },
    { label: `Размер текста ${store.settings.editorFontSize}px · меньше`, hint: 'Ctrl+-', run: () => actions.adjustFontSize(-1) },
    { label: `${store.settings.showLineNumbers ? 'Скрыть' : 'Показать'} номера строк`, run: actions.toggleLineNumbers },
    { label: `${store.settings.syncScroll ? 'Выключить' : 'Включить'} синхронную прокрутку`, run: actions.toggleSyncScroll },
    { label: 'Экспорт в HTML', hint: 'Ctrl+Shift+E', run: actions.exportHtml },
    { label: 'Печать / сохранить в PDF', hint: 'Ctrl+P', run: actions.printPdf },
    { label: 'Обновить дерево заметок', hint: 'F5', run: () => actions.refreshWorkspace() },
  ];
  openPalette(commands);
}

// ------------------------------------------------------------------ toolbar

/** Badge on the sidebar button that opens the drafts panel. */
function mountDraftsButton(): void {
  const update = (): void => {
    const count = store.draftsCount;
    dom.draftsBadge.hidden = count === 0;
    dom.draftsBadge.textContent = String(count);
    dom.btnDrafts.title = count
      ? `Черновики без файла: ${count}`
      : 'Черновики без файла';
  };
  store.on('drafts', update);
  update();
}

function mountToolbar(): void {
  // Static buttons declare their icon in the markup; decorate them in one pass.
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach((element) => {
    const name = element.dataset.icon as IconName | undefined;
    if (!name) return;
    element.prepend(icon(name, Number(element.dataset.iconSize ?? 15)));
  });

  document.getElementById('btn-open-folder')?.addEventListener('click', () => actions.openFolder());
  document.getElementById('btn-close-folder')?.addEventListener('click', () => actions.closeWorkspace());
  document.getElementById('btn-new-note')?.addEventListener('click', () => actions.createNote());
  document.getElementById('btn-new-folder')?.addEventListener('click', () => actions.createFolder());
  document.getElementById('btn-refresh')?.addEventListener('click', () => actions.refreshWorkspace());
  document.getElementById('btn-drafts')?.addEventListener('click', () => openDraftsPanel(store));
  document.getElementById('btn-search')?.addEventListener('click', () => actions.openGlobalSearch());
  document.getElementById('btn-palette')?.addEventListener('click', () => actions.openPalette());
  document.getElementById('btn-theme')?.addEventListener('click', () => actions.toggleTheme());
  document.getElementById('btn-sidebar')?.addEventListener('click', () => actions.toggleSidebar());
  document.getElementById('btn-more')?.addEventListener('click', (event) => {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    showMenu(
      { x: rect.left - 180, y: rect.bottom + 6 },
      [
        ...(store.activeDoc && isDraftPath(store.activeDoc.path)
          ? [{ label: 'Сохранить черновик в папку…', hint: 'Ctrl+S', onClick: actions.saveDraftAsFile }]
          : []),
        { label: 'Настройки…', hint: 'Ctrl+,', onClick: actions.openSettings },
        ...(store.storage.root
          ? [{
              label: store.storage.kind === 'demo' ? 'Сбросить демо-заметки' : 'Закрыть папку',
              danger: store.storage.kind === 'demo',
              onClick: actions.closeWorkspace,
            }]
          : []),
        { label: 'Экспорт в HTML', hint: 'Ctrl+Shift+E', onClick: actions.exportHtml },
        { label: 'Печать / сохранить в PDF', hint: 'Ctrl+P', onClick: actions.printPdf },
        { label: 'Перечитать файл с диска', onClick: actions.reloadActive },
        { label: `Тема: ${resolvedTheme() === 'dark' ? 'тёмная' : 'светлая'}`, onClick: actions.toggleTheme },
        { label: 'Тема: как в Windows', onClick: () => actions.setTheme('system') },
        {
          label: store.settings.showLineNumbers ? '✓ Номера строк' : 'Номера строк',
          onClick: actions.toggleLineNumbers,
        },
        {
          label: store.settings.syncScroll ? '✓ Синхронная прокрутка' : 'Синхронная прокрутка',
          onClick: actions.toggleSyncScroll,
        },
        { label: 'Обновить дерево', hint: 'F5', onClick: () => actions.refreshWorkspace() },
        { label: 'Корзина…', onClick: () => openTrashPanel(store) },
        { label: `Папка: ${store.rootName}`, onClick: () => actions.openFolder() },
        { separator: true },
        { label: 'Проверить обновления…', onClick: () => void checkForUpdates() },
      ],
      { key: 'more', anchorElement: target },
    );
  });

  document.querySelectorAll<HTMLButtonElement>('.segmented__item').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode as ViewMode | undefined;
      if (mode) setMode(mode);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.sidebar__tab').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab as SidebarTab | undefined;
      if (tab) actions.setSidebarTab(tab);
    });
  });

  document.getElementById('empty-open')?.addEventListener('click', () => actions.openFolder());
  document.getElementById('empty-new')?.addEventListener('click', () => actions.createNote());
}

// ---------------------------------------------------------------- resizing

function mountResizers(): void {
  // Sidebar width.
  dom.sidebarResizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = store.settings.sidebarWidth;
    const onMove = (move: PointerEvent): void => {
      const width = clamp(startWidth + (move.clientX - startX), 180, Math.min(520, window.innerWidth * 0.5));
      store.settings.sidebarWidth = width;
      document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    };
    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      store.patchSettings({ sidebarWidth: store.settings.sidebarWidth });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  // Editor / preview split.
  dom.splitter.addEventListener('pointerdown', (event) => {
    if (store.settings.mode !== 'split') return;
    event.preventDefault();
    const panes = dom.panes.getBoundingClientRect();
    const onMove = (move: PointerEvent): void => {
      const ratio = clamp((move.clientX - panes.left) / panes.width, 0.15, 0.85);
      store.settings.splitRatio = ratio;
      document.documentElement.style.setProperty('--split-left', `${ratio * 100}%`);
    };
    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      store.patchSettings({ splitRatio: store.settings.splitRatio });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

// --------------------------------------------------------------- shortcuts

function overlayOpen(): boolean {
  return dom.overlay.classList.contains('overlay--visible');
}

function mountShortcuts(): void {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlayOpen() && tree.hasSelection) {
      event.preventDefault();
      tree.clearSelection();
      return;
    }
    // Delete in the tree, but never while the caret is in the editor or a field.
    if (event.key === 'Delete' && !overlayOpen() && tree.hasSelection) {
      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest('input, textarea, [contenteditable="true"]');
      if (!typing) {
        event.preventDefault();
        actions.deleteSelected(tree.selectedPaths);
        return;
      }
    }
    if (event.key === 'Escape' && overlayOpen()) return;

    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (event.key === 'F5') {
      event.preventDefault();
      actions.refreshWorkspace();
      return;
    }
    if (event.key === 'Escape' && store.settings.focusMode) {
      event.preventDefault();
      actions.toggleFocusMode();
      return;
    }
    if (event.key === 'F2') {
      const doc = store.activeDoc;
      if (doc) {
        event.preventDefault();
        if (isDraftPath(doc.path)) void renameDraftNow();
        else actions.renameEntry({ name: doc.name, path: doc.path, kind: 'file' });
      }
      return;
    }
    if (!mod || overlayOpen()) return;

    // Ctrl+Alt+1/2/3 make headings, Ctrl+Alt+0 turns a block back into text.
    if (event.altKey) {
      const blockByKey: Record<string, BlockType> = {
        '0': 'paragraph',
        '1': 'h1',
        '2': 'h2',
        '3': 'h3',
      };
      const blockType = blockByKey[event.key];
      if (blockType) {
        event.preventDefault();
        actions.setBlockType(blockType);
        return;
      }
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const index = store.docs.findIndex((doc) => doc.path === store.activePath);
      if (store.docs.length < 2) return;
      const delta = event.shiftKey ? -1 : 1;
      const next = store.docs[(index + delta + store.docs.length) % store.docs.length];
      store.activate(next.path);
      return;
    }

    const handlers: Record<string, () => void> = {
      z: () => {
        if (event.shiftKey) actions.toggleFocusMode();
      },
      n: () => (event.shiftKey ? actions.createFolder() : actions.createNote()),
      o: () => (event.shiftKey ? actions.setSidebarTab('outline') : actions.openFolder()),
      ',': () => actions.openSettings(),
      s: () => {
        if (event.shiftKey) actions.saveAll();
        else if (store.activeDoc && isDraftPath(store.activeDoc.path)) actions.saveDraftAsFile();
        else void store.saveDoc(store.activePath ?? '');
      },
      w: () => {
        if (store.activePath) actions.closeTab(store.activePath);
      },
      f: () => (event.shiftKey ? actions.openGlobalSearch() : actions.openFind()),
      h: () => actions.openFind(),
      k: () => (event.shiftKey ? actions.formatLink() : actions.openPalette()),
      p: () => actions.printPdf(),
      b: () => actions.formatBold(),
      i: () => actions.formatItalic(),
      '`': () => actions.formatCode(),
      e: () => (event.shiftKey ? actions.exportHtml() : actions.cycleMode()),
      l: () => {
        if (event.shiftKey) {
          actions.toggleTheme();
          applyTheme();
        }
      },
      '\\': () => actions.toggleSidebar(),
      '=': () => actions.adjustFontSize(1),
      '+': () => actions.adjustFontSize(1),
      '-': () => actions.adjustFontSize(-1),
      '0': () => {
        store.patchSettings({ editorFontSize: 14 });
      },
    };

    const handler = handlers[key];
    if (!handler) return;
    event.preventDefault();
    handler();
  });
}

// ------------------------------------------------------- images and dropping

function imageFilesFrom(files: (File | null)[] | FileList | null | undefined): File[] {
  return Array.from(files ?? []).filter((file): file is File => Boolean(file) && file!.type.startsWith('image/'));
}

async function insertImages(files: File[]): Promise<void> {
  const doc = store.activeDoc;
  if (!doc) {
    showToast('Откройте заметку, чтобы вставить изображение', 'error');
    return;
  }
  if (isDraftPath(doc.path)) {
    showToast('Черновик пока не файл: сохраните его в папку (Ctrl+S), чтобы вставлять картинки', 'error');
    return;
  }
  let added = 0;
  for (const file of files) {
    const saved = await imageStore.save(doc.path, file, file.name.replace(/\.[^.]+$/, ''));
    if (!saved) continue;
    editor.insertBlock(saved.markdown);
    added += 1;
  }
  if (added === 0) showToast('Не удалось сохранить изображение', 'error');
  else showToast(added === 1 ? 'Изображение сохранено в assets/' : `Изображений добавлено: ${added}`, 'success');
}

async function handleDroppedFiles(files: File[]): Promise<void> {
  const images = imageFilesFrom(files);
  if (images.length) await insertImages(images);

  const notes = files.filter((file) => !file.type.startsWith('image/') && isTextFile(file.name));
  for (const file of notes) {
    const content = await file.text();
    await store.importTextFile(store.importDir, file.name, content);
  }

  const ignored = files.filter((file) => !file.type.startsWith('image/') && !isTextFile(file.name));
  if (ignored.length) {
    showToast(`Пропущено: ${ignored.length} — KOCPAD открывает markdown и текстовые файлы`, 'error');
  }
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function mountPaste(): void {
  // Capture phase: images must not be pasted as base64 text by CodeMirror.
  dom.editorHost.addEventListener(
    'paste',
    (event) => {
      const items = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === 'file');
      const files = imageFilesFrom(items.map((item) => item.getAsFile()));
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      void insertImages(files);
    },
    true,
  );
}

function mountDragAndDrop(): void {
  let depth = 0;
  const reset = (): void => {
    depth = 0;
    document.body.classList.remove('is-dragging');
  };

  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    document.body.classList.add('is-dragging');
  });

  document.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove('is-dragging');
  });

  document.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    reset();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void handleDroppedFiles(files);
  });

  window.addEventListener('blur', reset);
}

// ------------------------------------------------------- closing the window

let closeInProgress = false;

async function forceCloseWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('kocpad_close_window');
  } catch {
    // The window is already going away; nothing else to do from the webview.
  }
}

/**
 * Notepad-style exit: file notes are already written by autosave, drafts stay in
 * local storage, and the tabs come back on the next launch. No question dialog —
 * the only interruption left is a failed write.
 */
async function handleCloseRequest(): Promise<void> {
  if (closeInProgress) return;
  closeInProgress = true;
  try {
    const failed = await store.saveAll();

    if (failed > 0) {
      const proceed = await confirmAction({
        title: 'Закрыть KOCPAD?',
        message: `Не удалось сохранить изменения в ${failed} заметке(ах). Закрыть без сохранения?`,
        confirmLabel: 'Закрыть',
        danger: true,
      });
      if (proceed) await forceCloseWindow();
      return;
    }

    await forceCloseWindow();
  } finally {
    closeInProgress = false;
  }
}

/**
 * The Rust side prevents the OS close and asks the webview to run this handler,
 * but only after the frontend signalled it is alive (see `kocpad_ready`).
 */
function mountCloseInterception(): void {
  if (!isTauriRuntime()) return;
  (window as unknown as { __kocpadRequestClose?: () => void }).__kocpadRequestClose = () => {
    void handleCloseRequest();
  };
  // Global hotkey handled in Rust: focus the window and start a note.
  (window as unknown as { __kocpadQuickCapture?: () => void }).__kocpadQuickCapture = () => {
    void createNoteNow();
  };
  void invoke('kocpad_ready').catch(() => undefined);
}

// ------------------------------------------------------------------ startup

function applySettings(): void {
  applyLayout();
  applyTheme();
  const filter = document.getElementById('tree-filter') as HTMLInputElement | null;
  filter?.setAttribute('aria-label', 'Фильтр по имени заметки');
}

async function boot(): Promise<void> {
  applySettings();
  mountToolbar();
  mountResizers();
  mountShortcuts();
  mountPaste();
  mountDragAndDrop();
  mountCloseInterception();
  tree.mount();
  tabsView.mount();
  statusBar.mount();
  mountFormatBar();
  updateFormatBar();
  mountDraftsButton();
  outline.mount();
  tagsView.mount();
  linksView.mount();
  editor.setLinkSuggestions(() => store.linkSuggestions());
  store.onDocClosed = (path) => editor.forget(path);
  store.onDocRenamed = (from) => editor.forget(from);
  store.onDocContentSynced = (path) => {
    const doc = store.docs.find((item) => item.path === path);
    if (doc && store.activePath === path) editor.applyText(doc.content);
  };
  store.onConflict = (path) => void showConflictDialog(path);
  store.onExternalReload = (path) => {
    const doc = store.docs.find((item) => item.path === path);
    if (doc && store.activePath === path) editor.applyText(doc.content);
    showToast(`«${doc?.name ?? 'Заметка'}» изменена на диске — перечитана`);
  };
  mountExternalChangeWatch();

  store.on('active', () => {
    syncActive();
    resetPreviewScroll();
    persistTabs();
  });
  store.on('docs', () => {
    syncActive();
    schedulePersistTabs();
  });
  // Typing: only the title, the preview and (debounced) side panels care.
  store.on('dirty', () => {
    updateTitle();
    if (store.activeDoc && store.activeDoc.content !== lastPreviewSource) schedulePreview();
  });
  store.on('root', () => {
    dom.workspaceName.textContent = store.rootName;
    dom.workspaceName.title = store.storage.root ?? '';
    applyWorkspaceChrome();
  });
  store.on('settings', () => {
    applyLayout();
    editor.refreshLint();
  });
  store.on('status', () => {
    // Any status text is already shown in the status bar; real errors arrive
    // through `onError`, so this handler must not show a second toast.
  });
  store.on('tree', () => {
    dom.sidebarCount.textContent = String(store.flatFiles().length);
    dom.workspaceName.textContent = store.rootName;
    dom.sidebarCount.title = `${store.flatFiles().length} заметок`;
  });

  store.onError = (message) => showToast(message, 'error');

  // Untitled notes from the previous session come back before any folder is read.
  store.restoreDrafts();
  // Expired trash entries are cleaned before the user can see them.
  void trash.purge();

  dom.workspaceName.textContent = store.rootName;
  const restored = await store.storage.restoreRoot().catch(() => false);
  if (restored || store.storage.kind === 'demo') {
    await store.refreshTree();
  }
  await restoreTabs();
  // Nothing to restore from tabs: bring back the most recent draft, if any.
  if (!store.activeDoc && store.draftsCount > 0) {
    const recent = store.draftList[0];
    if (recent) store.openDraft(recent.id);
  }
  if (!store.activeDoc) {
    const files = store.flatFiles();
    // On a fresh workspace open the onboarding note when it exists.
    const welcome = files.find((file) => /добро пожаловать|welcome/i.test(file.name));
    const first = welcome ?? files[0];
    if (first && (store.storage.kind === 'demo' || restored)) await store.openNote(first.path);
  }
  syncActive();
  applyLayout();
  // Any journal snapshot left by a crash is offered before the user starts typing.
  void offerRecovery();

  if (!store.storage.root && store.storage.kind !== 'demo') {
    dom.emptyState.hidden = false;
  }
  document.body.dataset.backend = store.storage.kind;

  if (store.storage.kind !== 'demo') void runOnboarding();

  window.addEventListener('beforeunload', (event) => {
    if (store.dirtyCount > 0) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => {
    void store.saveAll();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void store.saveAll();
  });
  window.addEventListener('blur', () => {
    void store.saveAll();
  });

  // Keep the tab strip usable when many notes are open.
  dom.tabs.addEventListener('wheel', (event) => {
    if (event.deltaY === 0) return;
    dom.tabs.scrollLeft += event.deltaY;
  }, { passive: true });

  // Development-only handle for debugging and end-to-end checks.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__kocpad = {
      store,
      editor,
      actions,
      closeFlow: handleCloseRequest,
      journal,
      encoding: { decodeText, decodeAs, encodeText },
      lint: { diagnostics: (text: string) => runRules(text) },
      trash,
      openTrash: () => openTrashPanel(store),
      buildExport: async () => {
        const doc = store.activeDoc;
        return doc ? await buildExportDocument(doc) : null;
      },
    };
  }
}

void boot();
