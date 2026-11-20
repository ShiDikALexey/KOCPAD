import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __kocpad: {
      store: {
        activeDoc: { content: string; path: string; name: string } | null;
        docs: { path: string; name: string }[];
        flatFiles: () => { path: string; name: string }[];
        openNote: (path: string) => Promise<unknown>;
        settings: Record<string, unknown>;
        draftDocs: { path: string }[];
        resolveLink: (target: string) => { name: string; path: string } | null;
      };
      editor: {
        openSearch: () => void;
        focus: () => void;
        applyText: (text: string) => void;
        caret: number;
        text: string;
        formatBold: () => void;
        formatItalic: () => void;
        formatCode: () => void;
        formatLink: () => void;
        view: {
          state: {
            doc: { toString: () => string; length: number };
            replaceSelection: (text: string) => Record<string, unknown>;
          };
          dispatch: (spec: Record<string, unknown>) => void;
        };
      };
      actions: {
        setTheme: (theme: string) => void;
        setSidebarTab: (tab: string) => void;
        openSettings: () => void;
        openPalette: () => void;
        toggleFocusMode: () => void;
      };
    };
  }
}

const DEMO = '/?demo=1';

test.describe('workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.cm-content');
  });

  test('opens the demo workspace with a note and a live preview', async ({ page }) => {
    await expect(page.locator('#sidebar-count')).toHaveText('5');
    await expect(page.locator('.tab')).toHaveCount(1);
    await expect(page.locator('#preview h1')).toContainText('Добро пожаловать');
  });

  test('typing updates the preview and autosaves', async ({ page }) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nпроверка автосохранения');
    await expect(page.locator('#preview')).toContainText('проверка автосохранения');
    await expect(page.locator('#status-saved')).toHaveText('Сохранено');
  });

  test('Ctrl+N creates a note immediately and opens a tab', async ({ page }) => {
    await page.keyboard.press('Control+n');
    await expect(page.locator('.tab')).toHaveCount(2);
    await expect(page.locator('#sidebar-count')).toHaveText('6');
    await expect(page.locator('.tab').last()).toContainText('Новая заметка');
  });

  test('close tab keeps the workspace intact', async ({ page }) => {
    await page.keyboard.press('Control+n');
    await expect(page.locator('.tab')).toHaveCount(2);
    await page.keyboard.press('Control+w');
    await expect(page.locator('.tab')).toHaveCount(1);
  });

  test('sidebar refresh reports the number of notes', async ({ page }) => {
    await page.locator('#btn-refresh').click();
    await expect(page.locator('.toast__text')).toContainText('Дерево обновлено');
  });
});

test.describe('editor surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.cm-content');
  });

  test('find panel is localized', async ({ page }) => {
    await page.evaluate(() => window.__kocpad.editor.openSearch());
    const panel = page.locator('.cm-panel.cm-search');
    await expect(panel).toBeVisible();
    await expect(panel.locator('button').first()).toHaveText('далее');
    await expect(panel.locator('input[placeholder="Найти"]')).toBeVisible();
    await expect(panel.locator('label').first()).toContainText('регистр');
  });

  test('front matter renders as a metadata card', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.editor.applyText(
        '---\ntitle: План\ndate: 2026-11-19\ntags: [работа, план]\n---\n\n# Основной текст\n',
      );
    });
    const card = page.locator('#preview .frontmatter');
    await expect(card).toBeVisible();
    await expect(card).toContainText('План');
    await expect(card).toContainText('#работа');
    await expect(page.locator('#preview')).toContainText('Основной текст');
    await expect(page.locator('#preview')).not.toContainText('---');
  });

  test('wiki links render, navigate and list backlinks', async ({ page }) => {
    await page.evaluate(async () => {
      await window.__kocpad.store.openNote('Добро пожаловать в KOCPAD.md');
      await new Promise((resolve) => setTimeout(resolve, 300));
      window.__kocpad.editor.applyText('# Старт\n\nСм. [[Шпаргалка по markdown]] и [[План на неделю|план]].\n');
      // Give autosave time to reach the storage the backlink index reads.
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    const links = page.locator('#preview .wikilink');
    await expect(links).toHaveCount(2);
    await expect(links.last()).toHaveText('план');

    await links.first().click();
    await expect(page.locator('#doc-title')).toContainText('Шпаргалка');

    await page.evaluate(() => window.__kocpad.actions.setSidebarTab('links'));
    await expect(page.locator('.links__title').first()).toHaveText('Исходящие ссылки');
    await expect(page.locator('.links__section').nth(1)).toContainText('Добро пожаловать');
  });

  test('tags panel counts inline and front-matter tags', async ({ page }) => {
    await page.evaluate(async () => {
      await window.__kocpad.store.openNote('Добро пожаловать в KOCPAD.md');
      await new Promise((resolve) => setTimeout(resolve, 300));
      window.__kocpad.editor.applyText('---\ntags: [проект]\n---\n\n# Старт\n\n#идея #проект\n');
      await new Promise((resolve) => setTimeout(resolve, 900));
      window.__kocpad.actions.setSidebarTab('tags');
    });
    const rows = page.locator('.tag-row');
    await expect(rows.filter({ hasText: '#проект' })).toContainText('1');
    await expect(rows.filter({ hasText: '#идея' })).toHaveCount(1);
  });

  test('settings switch the export theme', async ({ page }) => {
    await page.evaluate(() => window.__kocpad.actions.openSettings());
    const dialog = page.locator('.settings');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Тёмная', exact: true }).last().click();
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.store.settings.exportTheme))
      .toBe('dark');
  });

  test('typing does not rebuild the sidebar tree', async ({ page }) => {
    // Regression guard: every keystroke used to re-render the tree and the tabs.
    const mutations = await page.evaluate(async () => {
      const tree = document.getElementById('tree') as HTMLElement;
      const tabs = document.querySelector('.tabs') as HTMLElement;
      let treeChanges = 0;
      let tabChanges = 0;
      const treeObserver = new MutationObserver((records) => {
        treeChanges += records.length;
      });
      treeObserver.observe(tree, { childList: true, subtree: true });
      const tabsObserver = new MutationObserver((records) => {
        tabChanges += records.length;
      });
      tabsObserver.observe(tabs, { childList: true, subtree: true });

      const view = window.__kocpad.editor.view;
      for (let index = 0; index < 25; index += 1) {
        view.dispatch({ ...view.state.replaceSelection('я'), userEvent: 'input.type' });
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
      treeObserver.disconnect();
      tabsObserver.disconnect();
      return { treeChanges, tabChanges };
    });
    expect(mutations.treeChanges).toBeLessThan(10);
    expect(mutations.tabChanges).toBeLessThan(10);
  });

  test('focus mode hides the sidebar and the preview', async ({ page }) => {
    await page.evaluate(() => window.__kocpad.actions.toggleFocusMode());
    await expect(page.locator('body')).toHaveClass(/focus-mode/);
    await expect(page.locator('#sidebar')).toBeHidden();
    await expect(page.locator('.pane--preview')).toBeHidden();
    await expect(page.locator('#formatbar')).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/focus-mode/);
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('#formatbar')).toBeVisible();
  });

  test('block-type bar shows the caret block and converts it', async ({ page }) => {
    // The demo note starts with "# Добро пожаловать", so line 1 is a heading.
    await expect(page.locator('#block-type-label')).toHaveText('Заголовок 1');

    await page.locator('#block-type').click();
    await expect(page.locator('.menu')).toBeVisible();
    await page.locator('.menu .menu__item', { hasText: 'Список' }).click();

    await expect(page.locator('#block-type-label')).toHaveText('Список');
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text.split('\n')[0]))
      .toBe('- Добро пожаловать в KOCPAD');

    // Ctrl+Alt+0 turns the block back into plain text.
    await page.keyboard.press('Control+Alt+0');
    await expect(page.locator('#block-type-label')).toHaveText('Текст');
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text.split('\n')[0]))
      .toBe('Добро пожаловать в KOCPAD');
  });

  test('Ctrl+Alt+2 makes a heading and the bar follows', async ({ page }) => {
    await page.evaluate(() => {
      const view = window.__kocpad.editor.view;
      view.dispatch({ selection: { anchor: 0 } });
    });
    await page.keyboard.press('Control+Alt+2');
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text.split('\n')[0]))
      .toBe('## Добро пожаловать в KOCPAD');
    await expect(page.locator('#block-type-label')).toHaveText('Заголовок 2');
  });

  test('format bar buttons wrap the selection', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.__kocpad.editor;
      api.applyText('слово');
      api.view.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    await page.locator('#formatbar [data-format="bold"]').click();
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text))
      .toBe('**слово**');
  });

  test('right click in the editor opens a Word-like menu with our actions', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.__kocpad.editor;
      api.applyText('# Заголовок\n\nтекст');
      // "текст" occupies offsets 13..18.
      api.view.dispatch({ selection: { anchor: 13, head: 18 } });
      document
        .querySelector('.cm-content')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }));
    });

    const menu = page.locator('.menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Вырезать' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Жирный' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Заголовок 1' })).toBeVisible();
    await expect(menu).toContainText('Убрать форматирование');
    await expect(menu.locator('.menu__sep').first()).toBeVisible();

    await menu.getByRole('menuitem', { name: 'Жирный' }).click();
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text))
      .toContain('**текст**');
  });

  test('clear formatting removes markers without losing words', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.__kocpad.editor;
      api.applyText('## **Жирный** и `код` и [ссылка](url)');
      api.view.dispatch({ selection: { anchor: 0, head: api.text.length } });
      api.clearFormatting();
    });
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text))
      .toBe('Жирный и код и ссылка');
  });

  test('formatting shortcuts wrap and toggle markdown markers', async ({ page }) => {
    const result = await page.evaluate(() => {
      const api = window.__kocpad.editor;
      const view = api.view;
      const selectAll = () =>
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

      api.applyText('слово');
      selectAll();
      api.formatBold();
      const bold = view.state.doc.toString();
      api.formatBold();
      const toggledOff = view.state.doc.toString();

      api.applyText('ссылка');
      selectAll();
      api.formatLink();
      return { bold, toggledOff, link: view.state.doc.toString() };
    });
    expect(result.bold).toBe('**слово**');
    expect(result.toggledOff).toBe('слово');
    expect(result.link).toContain('[ссылка](url)');
  });

  test('palette lists recently opened notes', async ({ page }) => {
    await page.evaluate(async () => {
      await window.__kocpad.store.openNote('Шпаргалка по markdown.md');
      await window.__kocpad.store.openNote('Идеи/План на неделю.md');
    });
    await page.evaluate(() => window.__kocpad.actions.openPalette());
    // The active note is intentionally not offered again.
    await page.locator('.palette__input').fill('Недавняя');
    await expect(page.locator('.palette__item').first()).toContainText('Недавняя заметка');
    await expect(page.locator('.palette__item').first()).toContainText('Шпаргалка');
  });

  test('status bar shows reading time for long notes', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.editor.applyText(`# Долгая\n\n${'слово '.repeat(200)}`);
    });
    await expect(page.locator('#status-stats')).toContainText('мин чтения', { timeout: 5000 });
  });

  test('update check explains that it only works in the desktop app', async ({ page }) => {
    await page.evaluate(() => document.getElementById('btn-more')?.click());
    await page.locator('.menu .menu__item', { hasText: 'Проверить обновления' }).click();
    await expect(page.locator('.toast__text')).toContainText('только в приложении');
  });

  test('the update command sits at the bottom of the menu', async ({ page }) => {
    await page.evaluate(() => document.getElementById('btn-more')?.click());
    await expect(page.locator('.menu')).toBeVisible();
    const labels = await page.$$eval('.menu .menu__item .menu__label', (els) =>
      els.map((el) => el.textContent?.trim() ?? ''),
    );
    expect(labels.at(-1)).toBe('Проверить обновления…');
    await page.keyboard.press('Escape');
  });

  test('clicking the block-type button again closes its menu', async ({ page }) => {
    await page.locator('#block-type').click();
    await expect(page.locator('.menu')).toBeVisible();
    await page.locator('#block-type').click();
    await expect(page.locator('.menu')).toHaveCount(0);
  });

  test('settings close when the dimmed area is clicked', async ({ page }) => {
    await page.evaluate(() => window.__kocpad.actions.openSettings());
    await expect(page.locator('.settings')).toBeVisible();
    await page.locator('#overlay').click({ position: { x: 8, y: 8 } });
    await expect(page.locator('.settings')).toHaveCount(0);
  });

  test('a single newline becomes a line break in the preview', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.editor.applyText('первая строка\nвторая строка');
    });
    await expect.poll(async () => page.evaluate(() => document.getElementById('preview')?.innerHTML ?? '')).toContain('<br>');
  });

  test('line numbers are shown by default and stay subtle', async ({ page }) => {
    // CodeMirror keeps a hidden measuring element in the gutter, so look for
    // the actual first line number instead of the first child.
    await expect(
      page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: /^1$/ }).first(),
    ).toBeVisible();
    const opacity = await page.evaluate(() => {
      const gutter = document.querySelector('.cm-gutters');
      return gutter ? getComputedStyle(gutter).opacity : '';
    });
    expect(Number(opacity)).toBeLessThan(0.8);
  });
});

test.describe('drafts without a folder', () => {
  test('first launch offers onboarding, draft survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const dialog = page.locator('.dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Добро пожаловать');
    await dialog.getByRole('button', { name: 'Начать с черновика' }).click();

    await expect(page.locator('#doc-title')).toContainText('Новая заметка');
    await expect(page.locator('#status-message')).toContainText('Черновик');
    await page.locator('.cm-content').click();
    await page.keyboard.type('черновик без папки');
    await expect(page.locator('#preview')).toContainText('черновик без папки');

    await page.reload();
    await page.waitForSelector('.cm-content');
    await expect(page.locator('#preview')).toContainText('черновик без папки');
    await expect(page.locator('#status-saved')).toContainText('Черновик');
  });

  test('drafts panel lists stored drafts and keeps them after closing the tab', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.dialog').getByRole('button', { name: 'Начать с черновика' }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.type('заметка в черновике');
    await expect(page.locator('#drafts-badge')).toBeVisible();

    // Closing the tab must keep the draft in the list, not delete it.
    await page.keyboard.press('Control+w');
    await expect(page.locator('.tab')).toHaveCount(0);

    await page.locator('#btn-drafts').click();
    const panel = page.locator('.drafts');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Новая заметка');

    await panel.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.locator('.tab')).toHaveCount(1);
    await expect(page.locator('#preview')).toContainText('заметка в черновике');
  });
});
