import { invoke } from '@tauri-apps/api/core';
import type { Store } from './store';
import { confirmAction, showToast } from './ui/dialog';

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
    available = info;
    checkedAt = Date.now();

    if (!info) {
      notifiedVersion = null;
      if (manual) {
        const version = await currentAppVersion();
        showToast(version ? `Обновлений нет · установлена ${version}` : 'Обновлений нет');
      }
    } else if (manual) {
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

async function promptInstall(store: Store, info: UpdateInfo): Promise<void> {
  const channel = info.channel === 'beta' ? '\n\nЭто тестовая сборка: возможны ошибки.' : '';
  const confirmed = await confirmAction({
    title: `Доступно обновление ${info.version}`,
    message:
      (info.body?.trim() ||
        'Скачать и установить новую версию? KOCPAD закроется, установит обновление, после чего его нужно будет запустить снова.') +
      channel,
    confirmLabel: 'Обновить',
  });
  if (confirmed) await installUpdate(store);
}

export async function installUpdate(store: Store): Promise<void> {
  showToast('Скачиваю обновление…');
  try {
    await invoke('update_install', { channel: store.settings.updateChannel });
    available = null;
    emit();
    showToast('Обновление установлено. Запустите KOCPAD снова.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showToast(`Не удалось установить обновление: ${message}`, 'error');
  }
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
