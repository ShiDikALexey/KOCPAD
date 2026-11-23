import type { AccentName, EditorKeymap, ExportTheme, PreviewFont, Settings, ThemeMode } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import type { Store } from '../store';
import { h } from '../util';
import { openModal } from './dialog';
import { icon } from './icons';
import { detectHabits, resetLearning, ruleStats } from '../lint/learning';
import { checkForUpdate, isTauriRuntime } from '../updates';

const ACCENTS: { id: AccentName; label: string; color: string }[] = [
  { id: 'marker', label: 'Маркер', color: '#d9a62e' },
  { id: 'azure', label: 'Лазурь', color: '#2f6fd0' },
  { id: 'jade', label: 'Нефрит', color: '#2c7a5b' },
  { id: 'iris', label: 'Ирис', color: '#6c4bb8' },
  { id: 'rose', label: 'Роза', color: '#b8455f' },
];

const THEMES: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
  { id: 'system', label: 'Как в Windows' },
];

const EDITOR_FONTS: { value: string; label: string }[] = [
  { value: '', label: 'По умолчанию (Cascadia Mono)' },
  { value: 'Consolas, monospace', label: 'Consolas' },
  { value: '"Cascadia Code", monospace', label: 'Cascadia Code' },
  { value: 'Georgia, serif', label: 'Georgia (с засечками)' },
  { value: '"Segoe UI", sans-serif', label: 'Segoe UI (без засечек)' },
];

const PREVIEW_FONTS: { value: PreviewFont; label: string }[] = [
  { value: 'serif', label: 'С засечками (Sitka)' },
  { value: 'sans', label: 'Без засечек (Segoe UI)' },
  { value: 'mono', label: 'Моноширинный' },
];

const AUTOSAVE: { value: number; label: string }[] = [
  { value: 300, label: 'Сразу (0,3 с)' },
  { value: 700, label: 'Обычно (0,7 с)' },
  { value: 1500, label: 'Не спеша (1,5 с)' },
];

const TAB_SIZES: { value: string; label: string }[] = [
  { value: '2', label: '2 пробела' },
  { value: '4', label: '4 пробела' },
  { value: '8', label: '8 пробелов' },
];

const KEYMAPS: { id: EditorKeymap; label: string }[] = [
  { id: 'default', label: 'Обычная' },
  { id: 'vim', label: 'Vim' },
];

const EXPORT_THEMES: { id: ExportTheme; label: string }[] = [
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
];

/** How a single newline in the note is treated by the preview. */
const SOFT_BREAKS: { id: 'notepad' | 'markdown'; label: string }[] = [
  { id: 'notepad', label: 'Как в Блокноте' },
  { id: 'markdown', label: 'Как в Markdown' },
];

function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h(
    'div',
    { class: 'settings__row' },
    h('div', { class: 'settings__label' }, h('span', null, label), hint ? h('span', { class: 'settings__hint' }, hint) : null),
    control,
  );
}

function section(title: string, ...rows: HTMLElement[]): HTMLElement {
  return h('section', { class: 'settings__section' }, h('h3', { class: 'settings__section-title' }, title), ...rows);
}

function select(
  options: { value: string; label: string }[],
  current: string,
  onChange: (value: string) => void,
): HTMLElement {
  const element = h('select', { class: 'settings__select' }) as HTMLSelectElement;
  for (const option of options) {
    const node = h('option', { value: option.value, text: option.label }) as HTMLOptionElement;
    element.appendChild(node);
  }
  element.value = current;
  element.addEventListener('change', () => onChange(element.value));
  return element;
}

function slider(
  min: number,
  max: number,
  step: number,
  value: number,
  format: (value: number) => string,
  onInput: (value: number) => void,
): HTMLElement {
  const output = h('span', { class: 'settings__value' }, format(value));
  const input = h('input', {
    class: 'settings__range',
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = format(next);
    onInput(next);
  });
  return h('div', { class: 'settings__slider' }, input, output);
}

function toggle(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = h('input', { class: 'settings__checkbox', type: 'checkbox' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'settings__toggle' }, input, h('span', null, label));
}

function segmented<T extends string>(
  options: { id: T; label: string }[],
  current: T,
  onPick: (value: T) => void,
): HTMLElement {
  const group = h('div', { class: 'settings__segmented', role: 'group' });
  for (const option of options) {
    const button = h(
      'button',
      {
        class: `settings__segment${option.id === current ? ' settings__segment--active' : ''}`,
        type: 'button',
        'aria-pressed': option.id === current ? 'true' : 'false',
        onclick: () => {
          group.querySelectorAll('.settings__segment').forEach((node) => {
            node.classList.remove('settings__segment--active');
            node.setAttribute('aria-pressed', 'false');
          });
          button.classList.add('settings__segment--active');
          button.setAttribute('aria-pressed', 'true');
          onPick(option.id);
        },
      },
      option.label,
    );
    group.appendChild(button);
  }
  return group;
}

/**
 * Settings screen (Ctrl+,). Every control applies immediately and is persisted;
 * typography and accent reach the UI through settings subscriptions in main.ts.
 */
export function openSettings(store: Store): void {
  const settings = store.settings;
  const patch = (next: Partial<Settings>): void => store.patchSettings(next);
  let close: () => void = () => undefined;

  const accents = h('div', { class: 'settings__accents' });
  for (const accent of ACCENTS) {
    const button = h('button', {
      class: `settings__accent${accent.id === settings.accent ? ' settings__accent--active' : ''}`,
      type: 'button',
      title: accent.label,
      'aria-label': accent.label,
      'aria-pressed': accent.id === settings.accent ? 'true' : 'false',
      style: `--accent-swatch: ${accent.color}`,
      onclick: () => {
        accents.querySelectorAll('.settings__accent').forEach((node) => {
          node.classList.remove('settings__accent--active');
          node.setAttribute('aria-pressed', 'false');
        });
        button.classList.add('settings__accent--active');
        button.setAttribute('aria-pressed', 'true');
        patch({ accent: accent.id });
      },
    });
    accents.appendChild(button);
  }

  const reset = h(
    'button',
    {
      class: 'btn btn--sm',
      type: 'button',
      onclick: () => {
        patch({ ...DEFAULT_SETTINGS, lastRoot: store.settings.lastRoot });
        close();
        store.setStatus('Настройки сброшены');
      },
    },
    'Сбросить всё',
  );

  // Assistant: toggle + learning statistics + habits found in the active note.
  const assistantBody = h('div', { class: 'assistant' });
  const renderAssistant = (): void => {
    const stats = ruleStats();
    const habits = detectHabits(store.activeDoc?.content ?? '');
    const children: HTMLElement[] = [];
    if (!stats.length) {
      children.push(
        h(
          'p',
          { class: 'assistant__empty' },
          'Пока нет данных. Исправьте или отклоните несколько подсказок — здесь появится статистика.',
        ),
      );
    } else {
      const rows = h('div', { class: 'assistant__stats' });
      for (const stat of stats.slice(0, 8)) {
        const percent = Math.round(stat.confidence * 100);
        rows.appendChild(
          h(
            'div',
            { class: 'assistant__row' },
            h('span', { class: 'assistant__label' }, stat.label),
            h(
              'span',
              { class: 'assistant__bar', title: `Уверенность ${percent}%` },
              h('span', { class: 'assistant__bar-fill', style: `width: ${percent}%` }),
            ),
            h('span', { class: 'assistant__counts' }, `${stat.applied} / ${stat.ignored}`),
          ),
        );
      }
      children.push(rows);
      children.push(
        h('p', { class: 'assistant__hint' }, 'Слева — сколько раз исправили, справа — сколько отклонили.'),
      );
    }
    if (habits.length) {
      children.push(h('p', { class: 'assistant__subtitle' }, 'Из ваших заметок'));
      const habitList = h('div', { class: 'assistant__habits' });
      for (const habit of habits) {
        habitList.appendChild(
          h('div', { class: 'assistant__habit' }, `${habit.label}: ${habit.value} · ${habit.count}`),
        );
      }
      children.push(habitList);
    }
    assistantBody.replaceChildren(...children);
  };
  renderAssistant();

  const assistantReset = h(
    'button',
    {
      class: 'btn btn--sm',
      type: 'button',
      onclick: () => {
        resetLearning();
        renderAssistant();
        store.setStatus('Обучение помощника сброшено');
      },
    },
    'Сбросить обучение',
  );

  const assistantSection = section(
    'Помощник',
    row(
      'Подсказки по разметке',
      toggle('Показывать', settings.assistant, (assistant) => patch({ assistant })),
      'Заметные ошибки Markdown подсвечиваются фоном; клик — объяснение и исправление',
    ),
    row(
      'Стилевые подсказки',
      toggle('Показывать', settings.assistantStyle, (assistantStyle) => patch({ assistantStyle })),
      'Длинные предложения, повторы и вводные фразы — выключено по умолчанию',
    ),
    assistantBody,
    h('div', { class: 'settings__row settings__row--actions' }, assistantReset),
  );

  openModal(
    (closeModal) => {
      close = closeModal;
      return h(
        'div',
        { class: 'settings', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Настройки' },
        h(
          'header',
          { class: 'settings__head' },
          h('h2', { class: 'settings__title' }, 'Настройки'),
          h('span', { class: 'settings__shortcut' }, 'Ctrl+,'),
          h(
            'button',
            {
              class: 'settings__close',
              type: 'button',
              title: 'Закрыть (Esc)',
              'aria-label': 'Закрыть настройки',
              onclick: () => closeModal(),
            },
            icon('close', 14),
          ),
        ),
        h(
          'div',
          { class: 'settings__body' },
          section(
            'Оформление',
            row('Тема', segmented(THEMES, settings.theme, (theme) => patch({ theme }))),
            row('Акцент', accents, 'Цвет курсора, активной вкладки и поиска'),
          ),
          section(
            'Редактор',
            row('Шрифт', select(EDITOR_FONTS, settings.editorFontFamily, (editorFontFamily) => patch({ editorFontFamily }))),
            row(
              'Размер',
              slider(11, 24, 1, settings.editorFontSize, (value) => `${value} px`, (editorFontSize) =>
                patch({ editorFontSize }),
              ),
            ),
            row('Номера строк', toggle('Показывать', settings.showLineNumbers, (showLineNumbers) => patch({ showLineNumbers }))),
            row(
              'Перенос строк',
              segmented(
                SOFT_BREAKS,
                settings.softBreaks ? 'notepad' : 'markdown',
                (value) => patch({ softBreaks: value === 'notepad' }),
              ),
              'Блокнот: каждая строка отдельно · Markdown: строки склеиваются в абзац',
            ),
            row(
              'Ширина таба',
              select(TAB_SIZES, String(settings.editorTabSize), (value) => patch({ editorTabSize: Number(value) })),
            ),
            row(
              'Раскладка клавиш',
              segmented(KEYMAPS, settings.editorKeymap, (editorKeymap) => patch({ editorKeymap })),
              'Vim: режимы команд и вставки, hjkl',
            ),
            row(
              'Режим сосредоточения',
              toggle('Скрыть панели', settings.focusMode, (focusMode) => patch({ focusMode })),
              'Ctrl+Shift+Z — включить, Esc — выйти',
            ),
          ),
          section(
            'Предпросмотр',
            row('Шрифт', select(PREVIEW_FONTS, settings.previewFontFamily, (value) => patch({ previewFontFamily: value as PreviewFont }))),
            row(
              'Размер',
              slider(13, 22, 0.5, settings.previewFontSize, (value) => `${value} px`, (previewFontSize) =>
                patch({ previewFontSize }),
              ),
            ),
            row('Прокрутка', toggle('Синхронизировать с редактором', settings.syncScroll, (syncScroll) => patch({ syncScroll }))),
          ),
          section(
            'Сохранение',
            row(
              'Автосохранение',
              select(
                AUTOSAVE.map((item) => ({ value: String(item.value), label: item.label })),
                String(settings.autosaveDelay),
                (value) => patch({ autosaveDelay: Number(value) }),
              ),
              'Задержка после последнего нажатия',
            ),
          ),
          assistantSection,
          section(
            'Обновления',
            row(
              'Канал',
              segmented(
                [
                  { id: 'stable', label: 'Стабильный' },
                  { id: 'beta', label: 'Бета' },
                ],
                settings.updateChannel,
                (value) => patch({ updateChannel: value === 'beta' ? 'beta' : 'stable' }),
              ),
              'Бета — тестовые сборки: возможны ошибки, автообновление на стабильную потом не откатит',
            ),
            row(
              'Автопроверка',
              toggle('Проверять', settings.updateAutoCheck, (updateAutoCheck) => patch({ updateAutoCheck })),
              'При запуске и раз в несколько часов; значок появится в меню «⋯»',
            ),
            row(
              'Пропущенная версия',
              (() => {
                const group = h('div', { class: 'settings__inline' });
                const versionLabel = h(
                  'span',
                  { class: 'settings__hint' },
                  settings.skippedUpdateVersion ?? 'нет',
                );
                group.appendChild(versionLabel);
                const restore = h(
                  'button',
                  {
                    class: 'btn btn--sm',
                    type: 'button',
                    onclick: () => {
                      patch({ skippedUpdateVersion: null });
                      versionLabel.textContent = 'нет';
                      restore.disabled = true;
                    },
                  },
                  'Вспомнить',
                ) as HTMLButtonElement;
                restore.disabled = !settings.skippedUpdateVersion;
                group.appendChild(restore);
                return group;
              })(),
              'Пропущенная версия не показывается в индикаторе; ручная проверка её увидит',
            ),
            row(
              'Проверить сейчас',
              h(
                'button',
                {
                  class: 'btn btn--sm',
                  type: 'button',
                  onclick: () => {
                    void checkForUpdate(store, { manual: true });
                  },
                },
                'Проверить',
              ),
              isTauriRuntime() ? 'Только подписанные сборки' : 'Доступно в приложении KOCPAD',
            ),
          ),
          section(
            'Экспорт',
            row(
              'Тема HTML и PDF',
              segmented(EXPORT_THEMES, settings.exportTheme, (exportTheme) => patch({ exportTheme })),
              'Подложка в сохранённом файле и при печати',
            ),
          ),
        ),
        h(
          'footer',
          { class: 'settings__foot' },
          reset,
          h('button', { class: 'btn btn--primary', type: 'button', onclick: () => close() }, 'Готово'),
        ),
      );
    },
    () => close(),
  );
}
