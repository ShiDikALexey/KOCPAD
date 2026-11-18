import type { NoteNode } from '../types';
import { isTextFile } from '../path';
import { downloadText } from '../util';
import type { Storage } from './types';

const WELCOME = `# Добро пожаловать в KOCPAD

**KOCPAD** — блокнот для markdown-заметок. Как «Блокнот» из Windows, только с вкладками,
поиском, живым предпросмотром и папкой обычных \`.md\` файлов на диске.

## Что уже работает

- Вкладки — несколько заметок одновременно, \`Ctrl+Tab\` переключает
- Автосохранение — изменения уходят на диск сами, \`Ctrl+S\` сохраняет сразу
- Живой предпросмотр рядом с текстом, режимы: редактор / разделить / просмотр
- Дерево заметок и папок в левой панели
- Поиск по открытому файлу (\`Ctrl+F\`) и по всем заметкам (\`Ctrl+Shift+F\`)
- Тёмная и светлая темы, следование теме Windows
- Экспорт в HTML и печать в PDF

> Это демо-режим: заметки живут в памяти вкладки и не пишутся на диск.
> Нажмите **«Открыть папку»**, чтобы подключить настоящую папку с \`.md\` файлами.

## С чего начать

1. Откройте папку с заметками — KOCPAD запомнит её на следующий запуск.
2. Создайте заметку кнопкой \`+\` или через \`Ctrl+N\`.
3. Пишите в левой панели, читайте результат в правой.

Дальше — «Шпаргалка по markdown»: там вся разметка, которую понимает KOCPAD.
`;

const CHEATSHEET = `# Шпаргалка по Markdown

Всё, что ниже, можно проверить прямо в этом файле: правьте текст и смотрите справа.

## Заголовки

\`\`\`md
# Первый уровень
## Второй уровень
### Третий уровень
\`\`\`

## Выделение

**жирный**, *курсив*, ~~зачёркнутый~~, \`код в строке\`.

## Списки

- маркированный пункт
- ещё один
  - вложенный пункт

1. нумерованный
2. по порядку

## Чеклист

- [x] работает в KOCPAD
- [x] отмечается мышкой в предпросмотре
- [ ] осталось написать свою заметку

## Таблица

| Клавиши | Действие |
| --- | --- |
| \`Ctrl+N\` | новая заметка |
| \`Ctrl+F\` | поиск по файлу |
| \`Ctrl+Shift+F\` | поиск по всем заметкам |
| \`Ctrl+K\` | палитра команд |

## Код

\`\`\`ts
function greet(name: string): string {
  return \`Привет, \${name}!\`;
}
\`\`\`

## Цитата

> Мир достаточно большой, чтобы в нём поместились все. — Марк Твен

## Ссылка

[Markdown Guide](https://www.markdownguide.org/) — внешние ссылки открываются в браузере.

## Разделитель

---
`;

const WEEK_PLAN = `# План на неделю

## Понедельник

- [ ] разобрать входящие
- [ ] письмо по проекту
- [ ] прогулка 40 минут

## Среда

- [ ] созвон в 11:00
- [ ] подготовить черновик

## Пятница

- [ ] итоги недели
- [ ] план на следующую

## Заметки

Не забыть: блокнот должен открываться быстрее, чем я успеваю отвлечься.
`;

const DRAFT = `# Черновик заметки

## Мысль

Инструмент не должен мешать. Блокнот побеждает не количеством кнопок,
а тем, что открывается мгновенно и не теряет ни строчки.

## Что улучшить в KOCPAD

1. Счёт слов всегда на виду
2. Ничего не пропадает при переключении вкладок
3. Тема не бьёт по глазам ночью

## Цитата

> Пиши коротко, правь долго.
`;

const DAILY = `# 18 ноября 2026

## Сделано

- поднял каркас приложения
- проверил предпросмотр

## В работе

- дерево заметок
- поиск по всей папке

## Вопросы

- как быть с очень большими файлами?
`;

/** Seed content for the demo workspace, keyed by slash path. */
const SEED: Record<string, string> = {
  'Добро пожаловать в KOCPAD.md': WELCOME,
  'Шпаргалка по markdown.md': CHEATSHEET,
  'Дневник/18 ноября.md': DAILY,
  'Идеи/План на неделю.md': WEEK_PLAN,
  'Идеи/Черновик заметки.md': DRAFT,
};

/** Directories present in the seed content, so empty folders survive a reload. */
function collectSeedDirs(): string[] {
  const dirs = new Set<string>();
  for (const path of Object.keys(SEED)) {
    const parts = path.split('/');
    parts.pop();
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      dirs.add(prefix);
    }
  }
  return [...dirs];
}

function buildTree(paths: string[], extraDirs: string[]): NoteNode[] {
  const root: NoteNode[] = [];
  const ensureDir = (level: NoteNode[], part: string, prefix: string): NoteNode => {
    let dir = level.find((node) => node.kind === 'dir' && node.name === part);
    if (!dir) {
      dir = { name: part, path: prefix, kind: 'dir', children: [] };
      level.push(dir);
    }
    return dir;
  };

  for (const dirPath of extraDirs) {
    const parts = dirPath.split('/');
    let level = root;
    let prefix = '';
    parts.forEach((part) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      level = ensureDir(level, part, prefix).children!;
    });
  }

  for (const path of paths) {
    const parts = path.split('/');
    let level = root;
    let prefix = '';
    parts.forEach((part, index) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      if (isLeaf) {
        level.push({ name: part, path: prefix, kind: 'file', size: SEED[path]?.length });
        return;
      }
      level = ensureDir(level, part, prefix).children!;
    });
  }

  const sortLevel = (nodes: NoteNode[]): NoteNode[] => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'ru');
    });
    nodes.forEach((node) => node.children && sortLevel(node.children));
    return nodes;
  };
  return sortLevel(root);
}

/**
 * In-memory workspace used when the app runs without a real folder (demo mode,
 * first launch in a browser during development). Writes stay in memory, so the
 * UI can be exercised end to end without touching the disk.
 */
export class DemoStorage implements Storage {
  readonly kind = 'demo' as const;
  readonly label = 'Демо';
  readonly canPersist = false;
  private files = new Map<string, string>(Object.entries(SEED));
  private dirs = new Set<string>(collectSeedDirs());

  get root(): string | null {
    return '/';
  }

  get rootName(): string {
    return 'Демо-заметки';
  }

  async chooseRoot(): Promise<boolean> {
    return true;
  }

  async restoreRoot(): Promise<boolean> {
    return true;
  }

  async listTree(): Promise<NoteNode[]> {
    return buildTree([...this.files.keys()].filter(isTextFile), [...this.dirs]);
  }

  async readText(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`Файл не найден: ${path}`);
    return text;
  }

  async writeText(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }

  async createFile(path: string, text = ''): Promise<void> {
    this.files.set(path, text);
  }

  async createDir(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      this.dirs.add(prefix);
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const text = this.files.get(from) ?? '';
    this.files.delete(from);
    this.files.set(to, text);
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${from}/`)) {
        const moved = to + key.slice(from.length);
        this.files.set(moved, this.files.get(key)!);
        this.files.delete(key);
      }
    }
    for (const dir of [...this.dirs]) {
      if (from === dir || dir.startsWith(`${from}/`)) {
        this.dirs.delete(dir);
        this.dirs.add(to + dir.slice(from.length));
      }
    }
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${path}/`)) this.files.delete(key);
    }
    for (const dir of [...this.dirs]) {
      if (dir === path || dir.startsWith(`${path}/`)) this.dirs.delete(dir);
    }
  }

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;
    return [...this.files.keys()].some((key) => key.startsWith(`${path}/`));
  }

  async saveAs(defaultName: string, content: string): Promise<string | null> {
    downloadText(defaultName, content);
    return defaultName;
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async reveal(): Promise<void> {
    // Nothing to reveal in memory.
  }
}
