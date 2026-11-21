import type { NoteNode } from '../types';
import { basename, isTextFile } from '../path';
import { downloadText } from '../util';
import type { FileStat, Storage } from './types';
import { getDirectoryPicker, type FsaDirectoryHandle, type FsaFileHandle } from './fsa';

const DB_NAME = 'kocpad';
const STORE_NAME = 'handles';
const ROOT_KEY = 'workspace-root';

/** Directories that are never scanned: they belong to other tools. */
const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules', 'target', 'dist', '.vscode']);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as T) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Browser backend built on the File System Access API.
 *
 * The directory handle survives reloads in IndexedDB, so reopening KOCPAD in
 * the same browser asks only for a permission confirmation. Only Chromium-based
 * browsers implement this; otherwise KOCPAD falls back to the demo workspace.
 */
export class BrowserStorage implements Storage {
  readonly kind = 'browser' as const;
  readonly label = 'Браузер';
  readonly canPersist = true;
  private handle: FsaDirectoryHandle | null = null;

  get root(): string | null {
    return this.handle ? '/' : null;
  }

  get rootName(): string {
    return this.handle ? this.handle.name : 'Папка не выбрана';
  }

  async chooseRoot(): Promise<boolean> {
    const picker = getDirectoryPicker();
    if (!picker) return false;
    try {
      const handle = await picker({ mode: 'readwrite', id: 'kocpad-workspace' });
      const granted = await ensurePermission(handle);
      if (!granted) return false;
      this.handle = handle;
      await idbSet(ROOT_KEY, handle);
      return true;
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return false;
      throw error;
    }
  }

  async restoreRoot(): Promise<boolean> {
    const handle = await idbGet<FsaDirectoryHandle>(ROOT_KEY).catch(() => null);
    if (!handle) return false;
    const state = await handle.queryPermission?.({ mode: 'readwrite' });
    if (state !== 'granted') {
      // Asking without a user gesture throws or is ignored; the UI offers a button.
      const again = await handle.requestPermission?.({ mode: 'readwrite' }).catch(() => 'denied');
      if (again !== 'granted') return false;
    }
    this.handle = handle;
    return true;
  }

  async mountRoot(): Promise<boolean> {
    // A browser cannot reopen a folder from a path string: the handle must be
    // picked by the user (or restored from IndexedDB).
    return false;
  }

  async closeRoot(): Promise<void> {
    this.handle = null;
    await forgetBrowserRoot();
  }

  async listTree(): Promise<NoteNode[]> {
    if (!this.handle) return [];
    const children = await this.walk(this.handle, '');
    return children;
  }

  private async walk(dir: FsaDirectoryHandle, prefix: string): Promise<NoteNode[]> {
    const dirs: NoteNode[] = [];
    const files: NoteNode[] = [];
    for await (const [name, child] of dir.entries()) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'directory') {
        // Empty folders stay visible: the user just created them.
        const nested = await this.walk(child, path);
        dirs.push({ name, path, kind: 'dir', children: nested });
      } else if (isTextFile(name)) {
        const file = await (child as FsaFileHandle).getFile();
        files.push({ name, path, kind: 'file', size: file.size });
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    files.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return [...dirs, ...files];
  }

  private async parentDir(path: string, create = false): Promise<FsaDirectoryHandle> {
    if (!this.handle) throw new Error('Папка не выбрана');
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    let dir = this.handle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  private async fileHandle(path: string, create = false): Promise<FsaFileHandle> {
    const parent = await this.parentDir(path, create);
    return parent.getFileHandle(basename(path), { create });
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const handle = await this.fileHandle(path);
      const file = await handle.getFile();
      return { mtimeMs: file.lastModified, size: file.size };
    } catch {
      return null;
    }
  }

  async readText(path: string): Promise<string> {
    const handle = await this.fileHandle(path);
    const file = await handle.getFile();
    return file.text();
  }

  async writeText(path: string, text: string): Promise<void> {
    const handle = await this.fileHandle(path, true);
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async readBinary(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const handle = await this.fileHandle(path);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async writeBinary(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const handle = await this.fileHandle(path, true);
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }

  async createFile(path: string, text = ''): Promise<void> {
    await this.writeText(path, text);
  }

  async createDir(path: string): Promise<void> {
    if (!this.handle) throw new Error('Папка не выбрана');
    const parts = path.split('/').filter(Boolean);
    let dir = this.handle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
  }

  async rename(from: string, to: string): Promise<void> {
    // The picker API has no portable move(), so copy then delete.
    const text = await this.readText(from);
    await this.writeText(to, text);
    await this.remove(from);
  }

  async remove(path: string): Promise<void> {
    const parent = await this.parentDir(path);
    await parent.removeEntry(basename(path), { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.readText(path);
      return true;
    } catch {
      if (!this.handle) return false;
      try {
        const parent = await this.parentDir(path);
        const name = basename(path);
        for await (const [childName] of parent.entries()) {
          if (childName === name) return true;
        }
      } catch {
        return false;
      }
      return false;
    }
  }

  async saveAs(defaultName: string, content: string): Promise<string | null> {
    downloadText(defaultName, content);
    return defaultName;
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async reveal(): Promise<void> {
    // Not possible from an unprivileged page.
  }
}

async function ensurePermission(handle: FsaDirectoryHandle): Promise<boolean> {
  const state = await handle.queryPermission?.({ mode: 'readwrite' });
  if (state === 'granted') return true;
  const requested = await handle.requestPermission?.({ mode: 'readwrite' }).catch(() => 'denied');
  return requested === 'granted';
}

/** Clears the remembered browser workspace, used by "Забыть папку". */
export async function forgetBrowserRoot(): Promise<void> {
  await idbDelete(ROOT_KEY).catch(() => undefined);
}
