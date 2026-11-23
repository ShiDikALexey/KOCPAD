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

  test('a horizontal rule at the start is not eaten as front matter', async ({ page }) => {
    // `---` at the top followed by another `---` used to be parsed as front
    // matter, hiding everything between them from the preview and the tags.
    await page.evaluate(async () => {
      const doc = window.__kocpad.store.activeDoc;
      if (!doc) return;
      window.__kocpad.editor.applyText('---\n\nважная строка\n\n---\n\nконец\n');
      await window.__kocpad.store.updateContent(doc.path, window.__kocpad.editor.text);
    });
    await expect(page.locator('#preview')).toContainText('важная строка');
    await expect(page.locator('#preview')).toContainText('конец');
  });

  test('an external edit is detected instead of overwritten', async ({ page }) => {
    const path = await page.evaluate(() => window.__kocpad.store.activeDoc?.path ?? '');
    // Another program rewrites the file while KOCPAD holds the old text.
    await page.evaluate(async (target) => {
      await window.__kocpad.store.storage.writeText(target, '# версия из другой программы\n');
    }, path);

    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' моя правка');
    await page.keyboard.press('Control+s');

    const dialog = page.locator('.dialog');
    await expect(dialog).toContainText('Файл изменён на диске');
    await dialog.getByRole('button', { name: 'Перечитать с диска' }).click();
    await expect(page.locator('#preview')).toContainText('версия из другой программы');
    await expect(page.locator('#preview')).not.toContainText('моя правка');
  });

  test('a clean note is reloaded when the file changes on disk', async ({ page }) => {
    const path = await page.evaluate(() => window.__kocpad.store.activeDoc?.path ?? '');
    await page.evaluate(async (target) => {
      await window.__kocpad.store.storage.writeText(target, '# снаружи\n');
    }, path);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#preview')).toContainText('снаружи');
    await expect(page.locator('#toasts')).toContainText('изменена на диске');
  });

  test('keeping my version overwrites the external edit', async ({ page }) => {
    const path = await page.evaluate(() => window.__kocpad.store.activeDoc?.path ?? '');
    await page.evaluate(async (target) => {
      await window.__kocpad.store.storage.writeText(target, '# снаружи\n');
    }, path);

    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' моё');
    await page.keyboard.press('Control+s');

    const dialog = page.locator('.dialog');
    await expect(dialog).toContainText('Файл изменён на диске');
    await dialog.getByRole('button', { name: 'Оставить моё' }).click();
    await expect
      .poll(async () =>
        page.evaluate(async (target) => {
          const api = window.__kocpad;
          const bytes = await api.store.storage.readBinary(target);
          return api.encoding.decodeText(bytes).text;
        }, path),
      )
      .toContain('моё');
  });

  test('offers text left by a crash', async ({ page }) => {
    const path = await page.evaluate(() => window.__kocpad.store.activeDoc?.path ?? '');
    await page.evaluate(async (target) => {
      await window.__kocpad.journal.write({
        key: 'crash-test',
        path: target,
        text: 'текст, который не успел сохраниться',
        savedAt: Date.now(),
      });
    }, path);

    await page.reload();
    await page.waitForSelector('.cm-content');
    const dialog = page.locator('.dialog');
    await expect(dialog).toContainText('Найден несохранённый текст');
    await dialog.getByRole('button', { name: 'Восстановить' }).click();
    await expect(page.locator('#preview')).toContainText('текст, который не успел сохраниться');
    await expect(page.locator('#status-saved')).toContainText('не сохранены');
  });

  test('the recovery journal is removed after a normal save', async ({ page }) => {
    // Keep autosave out of the way, otherwise it saves (and clears the journal)
    // before the assertion can see the snapshot.
    await page.evaluate(() => window.__kocpad.store.patchSettings({ autosaveDelay: 5000 }));
    await page.locator('.cm-content').click();
    await page.keyboard.type(' быстрая правка');
    await page.waitForTimeout(900);
    const before = await page.evaluate(() => window.__kocpad.journal.list());
    expect(before.length).toBeGreaterThan(0);

    await page.keyboard.press('Control+s');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.__kocpad.journal.list());
    expect(after.length).toBe(0);
  });

  test('opens and preserves legacy cp1251 with CRLF', async ({ page }) => {
    await page.evaluate(async () => {
      const api = window.__kocpad;
      const text = 'Старая заметка из Блокнота: привет\nвторая строка';
      await api.store.storage.writeBinary('legacy.txt', api.encoding.encodeText(text, 'cp1251', false, '\r\n'));
      await api.store.openNote('legacy.txt');
    });
    await expect(page.locator('#preview')).toContainText('Старая заметка из Блокнота');

    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('!');
    await page.keyboard.press('Control+s');

    const saved = await page.evaluate(async () => {
      const api = window.__kocpad;
      const bytes = await api.store.storage.readBinary('legacy.txt');
      const decoded = api.encoding.decodeText(bytes);
      return { encoding: decoded.encoding, eol: decoded.eol, text: decoded.text };
    });
    expect(saved.encoding).toBe('cp1251');
    expect(saved.eol).toBe('\r\n');
    expect(saved.text).toContain('!');
  });

  test('opens UTF-16LE with a BOM and keeps it on save', async ({ page }) => {
    const info = await page.evaluate(async () => {
      const api = window.__kocpad;
      await api.store.storage.writeBinary(
        'unicode.txt',
        api.encoding.encodeText('Юникод текст', 'utf-16le', true, '\n'),
      );
      await api.store.openNote('unicode.txt');
      return api.store.encodingInfo('unicode.txt');
    });
    expect(info.encoding).toBe('utf-16le');
    expect(info.bom).toBe(true);
    await expect(page.locator('#preview')).toContainText('Юникод текст');
  });

  test('deleted notes go to the trash and can be restored', async ({ page }) => {
    const path = await page.evaluate(() => window.__kocpad.store.activeDoc?.path ?? '');
    await page.evaluate(async (target) => {
      await window.__kocpad.store.deleteMany([target]);
    }, path);
    await expect
      .poll(async () => page.evaluate(async (target) => window.__kocpad.store.storage.exists(target), path))
      .toBe(false);

    await page.evaluate(() => window.__kocpad.openTrash());
    const panel = page.locator('.drafts');
    await expect(panel).toContainText('Корзина');
    await panel.getByRole('button', { name: 'Восстановить' }).first().click();
    await expect
      .poll(async () => page.evaluate(async (target) => window.__kocpad.store.storage.exists(target), path))
      .toBe(true);
  });

  test('the trash purges entries older than 30 days', async ({ page }) => {
    const removed = await page.evaluate(async () => {
      const day = 24 * 60 * 60 * 1000;
      localStorage.setItem(
        'kocpad.trash',
        JSON.stringify([
          { id: 'old', originalPath: 'old.md', name: 'old.md', deletedAt: Date.now() - 40 * day, isDir: false, size: 1, data: 'aGVsbG8=' },
          { id: 'new', originalPath: 'new.md', name: 'new.md', deletedAt: Date.now(), isDir: false, size: 1, data: 'aGVsbG8=' },
        ]),
      );
      return window.__kocpad.trash.purge(30);
    });
    expect(removed).toBe(1);
    const left = await page.evaluate(async () => (await window.__kocpad.trash.list()).length);
    expect(left).toBe(1);
  });

  test('export embeds relative images and renders wiki links', async ({ page }) => {
    const exported = await page.evaluate(async () => {
      const api = window.__kocpad;
      // A real 1x1 transparent PNG.
      const base64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      await api.store.storage.writeBinary('assets/pic.png', bytes);
      const doc = api.store.activeDoc;
      const text = '# Экспорт\n\n![картинка](assets/pic.png)\n\nСсылка на [[Другая заметка|другую]].\n';
      api.editor.applyText(text);
      await api.store.updateContent(doc.path, text);
      return await api.buildExport();
    });
    expect(exported).not.toBeNull();
    const html = exported!.html;
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('другую');
    expect(html).not.toContain('assets/pic.png');
    expect(html).not.toContain('[[Другая заметка');
  });

  test('Delete removes selected notes from the tree', async ({ page }) => {
    const note = page.locator('[role="treeitem"]', { hasText: 'Добро пожаловать' }).first();
    await note.click({ modifiers: ['Control'] });
    await page.keyboard.press('Delete');
    await expect(page.locator('.dialog')).toContainText('Удалить');
  });

  test('a modal keeps keyboard focus inside itself', async ({ page }) => {
    await page.evaluate(() => window.__kocpad.actions.openSettings());
    const settings = page.locator('.settings');
    await expect(settings).toBeVisible();
    for (let index = 0; index < 8; index += 1) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() =>
      !!document.activeElement?.closest('.settings, .dialog, .overlay'),
    );
    expect(inside).toBe(true);
  });

  test('menu items are reachable with the arrow keys', async ({ page }) => {
    await page.locator('#block-type').click();
    const menu = page.locator('.menu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const inside = await page.evaluate(() =>
      !!document.activeElement?.closest('.menu__item'),
    );
    expect(inside).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('clicking an unresolved wiki link offers to create the note', async ({ page }) => {
    await page.evaluate(async () => {
      const api = window.__kocpad;
      const doc = api.store.activeDoc;
      const text = '# Ссылки\n\nПродолжение в [[Новая заметка]].\n';
      api.editor.applyText(text);
      await api.store.updateContent(doc.path, text);
    });
    await page.locator('.wikilink--missing').click();
    const dialog = page.locator('.dialog');
    await expect(dialog).toContainText('Создать заметку?');
    await dialog.getByRole('button', { name: 'Создать' }).click();
    await expect(page.locator('.tab').last()).toContainText('Новая заметка');
    const exists = await page.evaluate(() =>
      window.__kocpad.store.storage.exists('Новая заметка.md'),
    );
    expect(exists).toBe(true);
  });

  test('renaming a note updates wiki links in other notes', async ({ page }) => {
    await page.evaluate(async () => {
      const api = window.__kocpad;
      const doc = api.store.activeDoc;
      const text = '# Ссылки\n\nСм. [[Шпаргалка по markdown]].\n';
      api.editor.applyText(text);
      await api.store.updateContent(doc.path, text);
      await api.store.saveAll();
    });
    const renamed = await page.evaluate(async () => {
      const api = window.__kocpad;
      const node = api.store.flatFiles().find((file: { name: string }) => file.name === 'Шпаргалка по markdown.md');
      if (!node) return false;
      return await api.store.renameEntry(node, 'Шпаргалка новая');
    });
    expect(renamed).toBe(true);
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text))
      .toContain('[[Шпаргалка новая]]');
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const api = window.__kocpad;
          const doc = api.store.activeDoc;
          if (!doc) return '';
          return api.encoding.decodeText(await api.store.storage.readBinary(doc.path)).text;
        }),
      )
      .not.toContain('[[Шпаргалка по markdown]]');
  });
  test('the assistant highlights a broken heading and fixes it on click', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.__kocpad;
      api.editor.applyText('# Тест\n\n##Hello world\n');
    });
    const marks = page.locator('.cm-lint-suggestion');
    await expect(marks).toHaveCount(1);
    await marks.first().click();

    const popover = page.locator('.lint-popover');
    await expect(popover).toContainText('После «#» нужен пробел');
    await expect(popover).toContainText('## Hello');
    await popover.getByRole('button', { name: 'Исправить' }).click();
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text))
      .toContain('## Hello world');
    await expect(marks).toHaveCount(0);
  });

  test('a suggestion can be ignored or turned off for good', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.editor.applyText('##Hello world\n');
    });
    await page.locator('.cm-lint-suggestion').first().click();
    await page.locator('.lint-popover').getByRole('button', { name: 'Игнорировать' }).click();
    await expect(page.locator('.cm-lint-suggestion')).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => window.__kocpad.editor.text)).toBe('##Hello world\n');

    // A fresh document reports it again, now permanently disabled.
    await page.evaluate(() => {
      window.__kocpad.editor.applyText('\n##Hello again\n');
    });
    await page.locator('.cm-lint-suggestion').first().click();
    await page.locator('.lint-popover').getByRole('button', { name: 'Больше не предлагать' }).click();
    await expect(page.locator('.cm-lint-suggestion')).toHaveCount(0);
    const disabled = await page.evaluate(() => window.__kocpad.store.settings.disabledLintRules);
    expect(disabled).toContain('heading-space');
  });

  test('turning the assistant off removes every mark', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.editor.applyText('##Hello\n\n-пункт\n');
    });
    await expect(page.locator('.cm-lint-suggestion').first()).toBeVisible();
    await page.evaluate(() => window.__kocpad.store.patchSettings({ assistant: false }));
    await expect(page.locator('.cm-lint-suggestion')).toHaveCount(0);
    await page.evaluate(() => window.__kocpad.store.patchSettings({ assistant: true }));
    await expect(page.locator('.cm-lint-suggestion').first()).toBeVisible();
  });

  test('rules skip fenced code and can be inspected directly', async ({ page }) => {
    const diagnostics = await page.evaluate(() => {
      const lint = window.__kocpad.lint;
      return {
        broken: lint.diagnostics('##Hello').map((item: { rule: string }) => item.rule),
        insideFence: lint.diagnostics('```\n##Hello\n```').map((item: { rule: string }) => item.rule),
      };
    });
    expect(diagnostics.broken).toContain('heading-space');
    expect(diagnostics.insideFence).not.toContain('heading-space');
  });

  test('the learning panel counts accepted suggestions and can be reset', async ({ page }) => {
    await page.evaluate(() => window.__kocpad.editor.applyText('##Hello world\n'));
    await page.locator('.cm-lint-suggestion').first().click();
    await page.locator('.lint-popover').getByRole('button', { name: 'Исправить' }).click();

    await page.evaluate(() => window.__kocpad.actions.openSettings());
    const panel = page.locator('.assistant');
    await expect(panel).toContainText('Пробел после #');
    await expect(panel).toContainText('1 / 0');

    await page.locator('.settings').getByRole('button', { name: 'Сбросить обучение' }).click();
    await expect(panel).toContainText('Пока нет данных');
  });

  test('the learning panel shows formatting habits from the note', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.editor.applyText(
        '# План\n\n[раз](https://a.ru) [два](https://b.ru) [три](https://c.ru)\n\n- один\n- два\n- три\n',
      );
    });
    await page.evaluate(() => window.__kocpad.actions.openSettings());
    const panel = page.locator('.assistant');
    await expect(panel).toContainText('Ссылки: [текст](url)');
    await expect(panel).toContainText('Списки: -');
  });

  test('a click outside the tinted fragment does not open the popover', async ({ page }) => {
    await page.evaluate(() => window.__kocpad.editor.applyText('vk.com\n'));
    const mark = page.locator('.cm-lint-suggestion').first();
    await expect(mark).toBeVisible();
    const line = page.locator('.cm-line').first();
    const box = await line.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    // The tint covers only `vk.com`; the right side of the line is empty.
    await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
    await expect(page.locator('.lint-popover')).toHaveCount(0);
    await mark.click();
    await expect(page.locator('.lint-popover')).toBeVisible();
  });

  test('right click applies all assistant fixes in the selection at once', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.__kocpad.editor;
      api.applyText('##Первый\n\n##Второй\n\n-пункт\n');
      api.view.dispatch({ selection: { anchor: 0, head: api.text.length } });
      document
        .querySelector('.cm-content')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 250, clientY: 200 }));
    });

    const menu = page.locator('.menu');
    await expect(menu).toContainText('Применить все исправления');
    await menu.getByRole('menuitem', { name: /Применить все исправления/ }).click();

    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text))
      .toBe('## Первый\n\n## Второй\n\n- пункт\n');

    // The whole batch is one undo step.
    await page.evaluate(() => window.__kocpad.editor.focus());
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text))
      .toBe('##Первый\n\n##Второй\n\n-пункт\n');
  });

  test('right click can dismiss all assistant suggestions in the selection', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.__kocpad.editor;
      api.applyText('##Первый\n\n-пункт\n');
      api.view.dispatch({ selection: { anchor: 0, head: api.text.length } });
      document
        .querySelector('.cm-content')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 250, clientY: 200 }));
    });

    const menu = page.locator('.menu');
    await expect(menu).toContainText('Отклонить подсказки');
    await menu.getByRole('menuitem', { name: /Отклонить подсказки/ }).click();
    await expect(page.locator('.cm-lint-suggestion')).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => window.__kocpad.editor.text)).toBe('##Первый\n\n-пункт\n');
  });

  test('drafts panel navigates to an open draft and focuses the editor', async ({ page }) => {
    await page.evaluate(async () => {
      const store = window.__kocpad.store;
      await store.createDraftDoc();
      await store.createDraftDoc();
    });
    await page.waitForTimeout(300);
    const background = await page.evaluate(() => {
      const store = window.__kocpad.store;
      const drafts = store.docs.filter((doc) => doc.path.startsWith('draft:'));
      return drafts[0].path;
    });

    await page.click('#btn-drafts');
    await expect(page.locator('.drafts__row--active')).toContainText('В редакторе');
    await page.locator('.drafts__row').getByRole('button', { name: 'Перейти' }).click();

    await expect(page.locator('.drafts')).toHaveCount(0);
    const state = await page.evaluate(() => ({
      active: window.__kocpad.store.activePath,
      editorFocused: Boolean(document.activeElement?.closest('.cm-editor')),
    }));
    expect(state.active).toBe(background);
    expect(state.editorFocused).toBe(true);
  });

  test('Ctrl+B works with a Russian keyboard layout', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.editor.applyText('привет\n');
      window.__kocpad.editor.focus();
      // Ctrl+B on a Russian layout produces `и` as event.key; the physical code
      // must still trigger bold.
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'и',
        code: 'KeyB',
        ctrlKey: true,
        bubbles: true,
      }));
    });
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text))
      .toContain('**');
  });

  test('Ctrl+Alt+1 makes a heading regardless of layout', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.editor.applyText('заголовок\n');
      window.__kocpad.editor.focus();
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: '1',
        code: 'Digit1',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
      }));
    });
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text))
      .toContain('# заголовок');
  });

  test('an inline tag is not reported as a broken heading', async ({ page }) => {
    const rules = await page.evaluate(() => ({
      tag: window.__kocpad.lint.diagnostics('#Ячейка 262:').map((item: { rule: string }) => item.rule),
      heading: window.__kocpad.lint.diagnostics('##Встречи').map((item: { rule: string }) => item.rule),
    }));
    expect(rules.tag).not.toContain('heading-space');
    expect(rules.heading).toContain('heading-space');
  });

  test('editor and preview scroll in sync', async ({ page }) => {
    await page.evaluate(() => {
      const lines = Array.from({ length: 120 }, (_, index) => `## Раздел ${index}\n\nАбзац ${index} с текстом.`);
      window.__kocpad.editor.applyText(`${lines.join('\n\n')}\n`);
    });
    await page.waitForTimeout(500);

    await page.evaluate(() => window.__kocpad.editor.scrollToRatio(0.5));
    await page.waitForTimeout(400);
    const previewTop = await page.evaluate(() => document.querySelector('#preview')?.scrollTop ?? 0);
    expect(previewTop).toBeGreaterThan(0);

    await page.evaluate(() => {
      const preview = document.querySelector('#preview');
      if (preview) preview.scrollTop = 10;
    });
    await page.waitForTimeout(300);
    const editorTop = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller');
      return scroller ? scroller.scrollTop : 0;
    });
    expect(editorTop).toBeGreaterThan(0);
  });

  test('printing a selection prints only that fragment', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.editor.applyText('Первый абзац\n\nВторой абзац\n');
      window.__kocpad.editor.focus();
    });
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Shift+End');
    await page.evaluate(() => window.__kocpad.actions.printPdf());
    await page.waitForTimeout(500);

    const printed = await page.evaluate(() =>
      [...document.querySelectorAll('iframe')]
        .map((frame) => frame.contentDocument?.body?.innerText ?? '')
        .join('\n'),
    );
    expect(printed).toContain('Первый абзац');
    expect(printed).not.toContain('Второй абзац');
    await expect(page.locator('.toast')).toContainText('выделенного');
  });

  test('an available update shows a dot and a menu action', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.updates.setAvailable({
        version: '9.9.9',
        currentVersion: '1.5.2-a',
        body: 'Заметки к релизу',
        channel: 'stable',
      });
    });
    await expect(page.locator('#btn-more')).toHaveClass(/tb-btn--update/);

    await page.locator('#btn-more').click();
    await expect(page.locator('.menu')).toContainText('Обновление 9.9.9');
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__kocpad.updates.setAvailable(null));
    await expect(page.locator('#btn-more')).not.toHaveClass(/tb-btn--update/);
  });

  test('update channel is saved in settings', async ({ page }) => {
    await page.evaluate(() => window.__kocpad.actions.openSettings());
    const settings = page.locator('.settings');
    await expect(settings).toContainText('Обновления');
    await settings.getByRole('button', { name: 'Бета' }).click();
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.store.settings.updateChannel))
      .toBe('beta');

    await settings.getByRole('button', { name: 'Готово' }).click();
    await page.reload();
    await page.waitForSelector('.cm-content');
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.store.settings.updateChannel))
      .toBe('beta');
  });

  test('a skipped update version can be restored from settings', async ({ page }) => {
    await page.evaluate(() => {
      window.__kocpad.store.patchSettings({ skippedUpdateVersion: '9.9.9' });
    });
    await page.evaluate(() => window.__kocpad.actions.openSettings());
    const settings = page.locator('.settings');
    await expect(settings).toContainText('9.9.9');

    await settings.getByRole('button', { name: 'Вспомнить' }).click();
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.store.settings.skippedUpdateVersion))
      .toBeNull();
    await expect(settings.getByRole('button', { name: 'Вспомнить' })).toBeDisabled();
  });

  test('note history lists saved versions and restores one', async ({ page }) => {
    await page.evaluate(() => window.__kocpad.editor.applyText('версия один\n'));
    await page.waitForTimeout(1300);
    await page.evaluate(() => window.__kocpad.editor.applyText('версия два\n'));
    await page.waitForTimeout(1300);

    await page.evaluate(() => window.__kocpad.actions.openHistory());
    const row = page.locator('.history__row').first();
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Восстановить' }).click();
    await row.getByRole('button', { name: 'Точно?' }).click();
    await expect
      .poll(async () => page.evaluate(() => window.__kocpad.editor.text))
      .toContain('версия один');
  });

  test('broken links panel lists unresolved wiki links', async ({ page }) => {
    await page.evaluate(() => window.__kocpad.editor.applyText('# Тест\n\n[[Нет такой заметки]]\n'));
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.__kocpad.actions.openBrokenLinks());

    const panel = page.locator('.history[aria-label="Битые ссылки"]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Нет такой заметки');
    await expect(panel).toContainText('Найдено');
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

  test('selection keeps the theme accent colour', async ({ page }) => {
    await page.evaluate(() => {
      const view = window.__kocpad.editor.view;
      view.dispatch({ selection: { anchor: 0, head: 5 } });
      // Opening a menu blurs the editor, which is when CodeMirror falls back to
      // its own base theme unless our rule outranks it.
      document.querySelector('.cm-content')?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }),
      );
    });
    await expect(page.locator('.menu')).toBeVisible();
    const colour = await page.evaluate(() => {
      const layer = document.querySelector('.cm-selectionBackground');
      return layer ? getComputedStyle(layer).backgroundColor : 'missing';
    });
    expect(colour).toBe('rgba(217, 166, 46, 0.3)');
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
    // A restored draft must not hide behind the "no folder" welcome screen.
    await expect(page.locator('#empty-state')).toBeHidden();
    await expect(page.locator('.cm-content')).toContainText('черновик без папки');
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

  test('drafts panel creates a draft and deletes it in two steps', async ({ page }) => {
    await page.goto('/?demo=1');
    await page.waitForSelector('.cm-content');

    await page.locator('#btn-drafts').click();
    const panel = page.locator('.drafts');
    await panel.getByRole('button', { name: 'Новый черновик' }).click();

    // Even with a folder connected, "Новый черновик" must create a draft, not a file.
    await expect(page.locator('#status-saved')).toContainText('Черновик');

    await page.locator('#btn-drafts').click();
    await page.locator('.drafts').getByRole('button', { name: 'Удалить черновик' }).click();
    const confirmButton = page.locator('.drafts').getByRole('button', { name: 'Подтвердить удаление' });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();
    await expect(page.locator('.drafts')).toContainText('Черновиков пока нет');
  });
});
