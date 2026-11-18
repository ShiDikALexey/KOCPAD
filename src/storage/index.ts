import type { Storage } from './types';
import { isTauriRuntime, supportsFileSystemAccess } from './types';
import { TauriStorage } from './tauri';
import { BrowserStorage } from './browser';
import { DemoStorage } from './demo';

export type { Storage } from './types';
export { isTauriRuntime, supportsFileSystemAccess } from './types';
export { forgetBrowserRoot } from './browser';

/**
 * Picks the best available backend:
 * native build → File System Access API → in-memory demo workspace.
 * `?demo=1` forces the demo workspace, which is handy for reviews and tests.
 */
export function createStorage(): Storage {
  const forcedDemo = new URLSearchParams(location.search).get('demo') === '1';
  if (!forcedDemo && isTauriRuntime()) return new TauriStorage();
  if (!forcedDemo && supportsFileSystemAccess()) return new BrowserStorage();
  return new DemoStorage();
}
