import './style.css';

import { Store } from './store';
import { createStorage } from './storage';
import { MarkdownEditor } from './editor';
import {
  buildExportHtml,
  decoratePreview,
  documentTitle,
  printDocument,
  renderMarkdown,
  toggleTaskAtIndex,
} from './markdown';
import { TreeView } from './ui/tree';
import { TabsView } from './ui/tabs';
import { StatusBar } from './ui/statusbar';
import { GlobalSearchPanel } from './ui/gsearch';
import { OutlineView } from './ui/outline';
import { openPalette, type Command } from './ui/palette';
import { openSettings } from './ui/settings';
import { confirmAction, promptText, showMenu, showToast } from './ui/dialog';
import { icon, type IconName } from './ui/icons';
import type { AppActions } from './ui/actions';
import { ImageStore } from './images';
import type { PreviewFont, SidebarTab, ViewMode } from './types';
import { basename, dirname, isTextFile, joinPath } from './path';
import { clamp, debounce } from './util';

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
  tabs: must('tabs'),
  panes: must('panes'),
  editorHost: must('editor'),
  preview: must('preview'),
  emptyState: must('empty-state'),
  splitter: must('splitter'),
  statusMode: must('status-mode'),
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

function applySidebarTab(): void {  const tab = store.settings.sidebarTab;
  document.querySelectorAll<HTMLButtonElement>('.sidebar__tab').forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle('sidebar__tab--active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  const notesVisible = tab === 'notes';
  dom.tree.hidden = !notesVisible;
  dom.treeFilter.hidden = !notesVisible;
  dom.outline.hidden = notesVisible;
  if (!notesVisible) outline.render();
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

function applyLayout(): void {
  const settings = store.settings;
  dom.sidebar.classList.toggle('sidebar--collapsed', !settings.sidebarOpen);
  dom.sidebarResizer.hidden = !settings.sidebarOpen;
  document.documentElement.style.setProperty('--sidebar-width', `${clamp(settings.sidebarWidth, 180, 520)}px`);
  dom.panes.dataset.mode = settings.mode;
  document.documentElement.style.setProperty('--split-left', `${clamp(settings.splitRatio, 0.15, 0.85) * 100}%`);
  dom.statusMode.textContent = {
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
}

// -------------------------------------------------------------------- editor

let suppressPreviewRender = false;

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
    },
  },
  { showLineNumbers: store.settings.showLineNumbers },
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
    updateTitle();
    return;
  }

  editor.open(doc.path, doc.content);
  editor.setLineNumbers(store.settings.showLineNumbers);
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

async function restoreTabs(): Promise<void> {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { paths?: string[]; active?: string | null };
    const available = new Set(store.flatFiles().map((node) => node.path));
    const paths = (parsed.paths ?? []).filter((path) => available.has(path));
    for (const path of paths) {
      await store.openNote(path, { focus: false });
    }
    if (parsed.active && store.docs.some((doc) => doc.path === parsed.active)) {
      store.activate(parsed.active);
    }
  } catch {
    // A corrupt entry just means we start with no tabs.
  }
}

// ------------------------------------------------------------------- actions

function targetDirectory(): string {
  const doc = store.activeDoc;
  return doc ? dirname(doc.path) : '';
}

/** Opens the folder picker and mounts the result. Shared by "Открыть папку" and friends. */
async function chooseWorkspace(): Promise<boolean> {
  try {
    await store.saveAll();
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
 * Renaming stays on F2 if the person cares about the title.
 */
async function createNoteNow(parentDir?: string): Promise<void> {
  if (!store.storage.root && !(await chooseWorkspace())) return;
  const dir = parentDir ?? targetDirectory();
  const path = await store.createNoteAuto(dir);
  if (path) window.setTimeout(() => editor.focus(), 60);
}

async function closeCurrentWorkspace(): Promise<void> {
  const demo = store.storage.kind === 'demo';
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
      const title = documentTitle(doc.name);
      const html = buildExportHtml(title, renderMarkdown(doc.content), { subtitle: doc.path });
      const saved = await store.storage.saveAs(`${title}.html`, html, 'text/html;charset=utf-8');
      if (saved) showToast(store.storage.kind === 'tauri' ? `Сохранено: ${saved}` : 'HTML-файл скачан', 'success');
    })();
  },

  printPdf: () => {
    const doc = store.activeDoc;
    if (!doc) {
      showToast('Откройте заметку для печати', 'error');
      return;
    }
    printDocument(documentTitle(doc.name), renderMarkdown(doc.content), doc.path);
    showToast('Выберите «Сохранить как PDF» в диалоге печати');
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

function palette(): void {
  const commands: Command[] = [
    { label: 'Открыть папку с заметками', hint: 'Ctrl+O', run: actions.openFolder },
    { label: 'Новая заметка', hint: 'Ctrl+N', run: () => actions.createNote() },
    { label: 'Новая папка', hint: 'Ctrl+Shift+N', run: () => actions.createFolder() },
    { label: 'Найти в заметке', hint: 'Ctrl+F', run: actions.openFind },
    { label: 'Найти во всех заметках', hint: 'Ctrl+Shift+F', run: actions.openGlobalSearch },
    { label: 'Настройки', hint: 'Ctrl+,', run: actions.openSettings },
    ...(store.storage.root
      ? [{
          label: store.storage.kind === 'demo' ? 'Сбросить демо-заметки' : 'Закрыть папку с заметками',
          run: actions.closeWorkspace,
        }]
      : []),
    { label: 'Панель: контур заметки', hint: 'Ctrl+Shift+O', run: () => actions.setSidebarTab('outline') },
    { label: 'Панель: дерево заметок', run: () => actions.setSidebarTab('notes') },
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
    { label: 'Обновить дерево заметок', hint: 'F5', run: () => void store.refreshTree() },
  ];
  openPalette(commands);
}

// ------------------------------------------------------------------ toolbar

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
  document.getElementById('btn-search')?.addEventListener('click', () => actions.openGlobalSearch());
  document.getElementById('btn-palette')?.addEventListener('click', () => actions.openPalette());
  document.getElementById('btn-theme')?.addEventListener('click', () => actions.toggleTheme());
  document.getElementById('btn-sidebar')?.addEventListener('click', () => actions.toggleSidebar());
  document.getElementById('btn-more')?.addEventListener('click', (event) => {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    showMenu({ x: rect.left - 180, y: rect.bottom + 6 }, [
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
      { label: 'Обновить дерево', hint: 'F5', onClick: () => void store.refreshTree() },
      { label: `Папка: ${store.rootName}`, onClick: () => actions.openFolder() },
    ]);
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
    if (event.key === 'Escape' && overlayOpen()) return;

    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (event.key === 'F5') {
      event.preventDefault();
      void store.refreshTree();
      return;
    }
    if (event.key === 'F2') {
      const doc = store.activeDoc;
      if (doc) {
        event.preventDefault();
        actions.renameEntry({ name: doc.name, path: doc.path, kind: 'file' });
      }
      return;
    }
    if (!mod || overlayOpen()) return;

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
      n: () => (event.shiftKey ? actions.createFolder() : actions.createNote()),
      o: () => (event.shiftKey ? actions.setSidebarTab('outline') : actions.openFolder()),
      ',': () => actions.openSettings(),
      s: () => {
        if (event.shiftKey) actions.saveAll();
        else void store.saveDoc(store.activePath ?? '');
      },
      w: () => {
        if (store.activePath) void store.closeDoc(store.activePath);
      },
      f: () => (event.shiftKey ? actions.openGlobalSearch() : actions.openFind()),
      h: () => actions.openFind(),
      k: () => actions.openPalette(),
      p: () => actions.printPdf(),
      b: () => editor.wrapSelection('**', '**', 'жирный текст'),
      i: () => editor.wrapSelection('*', '*', 'курсив'),
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
  tree.mount();
  tabsView.mount();
  statusBar.mount();
  outline.mount();

  store.on('active', () => {
    syncActive();
    resetPreviewScroll();
  });
  store.on('docs', () => {
    syncActive();
    persistTabs();
  });
  store.on('root', () => {
    dom.workspaceName.textContent = store.rootName;
    dom.workspaceName.title = store.storage.root ?? '';
    applyWorkspaceChrome();
  });
  store.on('settings', () => applyLayout());
  store.on('status', () => {
    if (store.status.kind === 'error' && store.status.text) showToast(store.status.text, 'error');
  });
  store.on('tree', () => {
    dom.sidebarCount.textContent = String(store.flatFiles().length);
    dom.workspaceName.textContent = store.rootName;
    dom.sidebarCount.title = `${store.flatFiles().length} заметок`;
  });

  store.onError = (message) => showToast(message, 'error');

  dom.workspaceName.textContent = store.rootName;
  const restored = await store.storage.restoreRoot().catch(() => false);
  if (restored || store.storage.kind === 'demo') {
    await store.refreshTree();
  }
  await restoreTabs();
  if (!store.activeDoc) {
    const files = store.flatFiles();
    // On a fresh workspace open the onboarding note when it exists.
    const welcome = files.find((file) => /добро пожаловать|welcome/i.test(file.name));
    const first = welcome ?? files[0];
    if (first && (store.storage.kind === 'demo' || restored)) await store.openNote(first.path);
  }
  syncActive();
  applyLayout();

  if (!store.storage.root && store.storage.kind !== 'demo') {
    dom.emptyState.hidden = false;
  }
  document.body.dataset.backend = store.storage.kind;

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
    (window as unknown as Record<string, unknown>).__kocpad = { store, editor, actions };
  }
}

void boot();
