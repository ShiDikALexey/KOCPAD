import { invoke } from '@tauri-apps/api/core';
import type { Store } from './store';
import { choiceDialog, showToast } from './ui/dialog';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string | null;
  channel: 'stable' | 'beta';
}

const listeners = new Set<() => void>();
let available: UpdateInfo | null = null;
let checking = false;
let checkedAt: number | null = null;
let lastError: string | null = null;
let notifiedVersion: string | null = null;

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getAvailableUpdate(): UpdateInfo | null {
  return available;
}

export function isCheckingUpdate(): boolean {
  return checking;
}

export function lastCheckTime(): number | null {
  return checkedAt;
}

export function lastCheckError(): string | null {
  return lastError;
}

export function subscribeUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener();
}

export async function currentAppVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return '';
  }
}

/** Test/dev hook: show the badge and menu state without a real update server. */
export function setAvailableUpdateForTests(info: UpdateInfo | null): void {
  available = info;
  if (info) checkedAt = Date.now();
  emit();
}

export async function checkForUpdate(
  store: Store,
  options: { manual?: boolean } = {},
): Promise<UpdateInfo | null> {
  const manual = options.manual === true;
  if (!isTauriRuntime()) {
    if (manual) showToast('Обновления проверяются только в приложении KOCPAD', 'info');
    return null;
  }
  if (checking) return available;
  checking = true;
  lastError = null;
  emit();

  try {
    const info = await invoke<UpdateInfo | null>('update_check', {
      channel: store.settings.updateChannel,
    });
    checkedAt = Date.now();

    if (!info) {
      available = null;
      notifiedVersion = null;
      if (manual) {
        const version = await currentAppVersion();
        showToast(version ? `Обновлений нет · установлена ${version}` : 'Обновлений нет');
      }
      return null;
    }

    // A version the user explicitly skipped stays silent until a manual check.
    if (!manual && info.version === store.settings.skippedUpdateVersion) {
      available = null;
      return info;
    }

    available = info;

    if (manual) {
      await promptInstall(store, info);
    } else if (notifiedVersion !== info.version) {
      notifiedVersion = info.version;
      const channel = info.channel === 'beta' ? ' · бета' : '';
      showToast(`Доступно обновление ${info.version}${channel}`, 'info');
    }
    return info;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    if (manual) {
      showToast(`Не удалось проверить обновления: ${lastError}`, 'error');
    }
    return null;
  } finally {
    checking = false;
    emit();
  }
}

/** Turns release notes (plain text or markdown) into short dialog lines. */
export function cleanReleaseNotes(body?: string | null): string[] {
  if (!body?.trim()) return [];
  return body
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^#{1,6}\s*/, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/^[-*]\s+/, '')
        .trim(),
    )
    .filter(
      (line) =>
        Boolean(line)
        && !/^\[?\d+(?:\.\d+)*(?:[-+][\w.]+)?\]?/.test(line)
        && !/^(changed|added|fixed|removed|deprecated|security)$/i.test(line),
    )
    .slice(0, 6)
    .map((line) => (line.length > 180 ? `${line.slice(0, 177)}…` : line));
}

async function promptInstall(store: Store, info: UpdateInfo): Promise<void> {
  const details = cleanReleaseNotes(info.body);
  if (info.channel === 'beta') {
    details.push('Это тестовая сборка: возможны ошибки.');
  }
  details.push('KOCPAD перезапустится после установки.');
  const choice = await choiceDialog({
    title: `Доступно обновление ${info.version}`,
    message: 'Скачать и установить сейчас?',
    details,
    options: [
      { id: 'install', label: 'Обновить', kind: 'primary' },
      { id: 'later', label: 'Позже' },
      { id: 'skip', label: 'Пропустить версию' },
    ],
  });

  if (choice === 'install') {
    if (store.settings.skippedUpdateVersion === info.version) {
      store.patchSettings({ skippedUpdateVersion: null });
    }
    await installUpdate(store);
  } else if (choice === 'skip') {
    store.patchSettings({ skippedUpdateVersion: info.version });
    available = null;
    emit();
    showToast(`Версия ${info.version} больше не предлагается`, 'info');
  }
}

export async function installUpdate(store: Store): Promise<void> {  showToast('Скачиваю обновление…');
  try {
    await invoke('update_install', { channel: store.settings.updateChannel });
    available = null;
    emit();
    showToast('Обновление установлено · KOCPAD перезапустится', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showToast(`Не удалось установить обновление: ${message}`, 'error');
  }
}

/** E2E/dev helper: show the real update dialog with a fake note payload. */
export async function showUpdateDialogForTests(store: Store, info: UpdateInfo): Promise<void> {
  await promptInstall(store, info);
}

/** Startup and periodic checks; respects the settings toggle on every tick. */
export function scheduleUpdateChecks(store: Store): void {
  if (!isTauriRuntime()) return;
  window.setTimeout(() => {
    if (store.settings.updateAutoCheck) void checkForUpdate(store);
  }, 5000);
  window.setInterval(() => {
    if (store.settings.updateAutoCheck) void checkForUpdate(store);
  }, 6 * 60 * 60 * 1000);
}
