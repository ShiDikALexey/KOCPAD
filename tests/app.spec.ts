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
      };
      actions: {
        setTheme: (theme: string) => void;
        setSidebarTab: (tab: string) => void;
        openSettings: () => void;
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
});
