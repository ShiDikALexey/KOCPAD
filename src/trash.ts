import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime, type Storage } from './storage/types';
import { base64ToBytes, bytesToBase64 } from './util';

/**
 * Internal KOCPAD trash.
 *
 * Deleting a note moves it into the app profile instead of dropping it; the list
 * is shown in a panel, entries can be restored, and everything older than 30 days
 * is purged on startup. Native builds use Rust commands; the browser/demo fallback
 * keeps the content in localStorage so the flow works in e2e.
 */
export interface TrashEntry {
  id: string;
  originalPath: string;
  name: string;
  deletedAt: number;
  isDir: boolean;
  size: number;
}

export const TRASH_RETENTION_DAYS = 30;

interface LocalEntry extends TrashEntry {
  data?: string;
}

const STORAGE_KEY = 'kocpad.trash';

function readLocal(): LocalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalEntry =>
        typeof item === 'object'
        && item !== null
        && typeof (item as LocalEntry).id === 'string'
        && typeof (item as LocalEntry).originalPath === 'string',
    );
  } catch {
    return [];
  }
}

function writeLocal(entries: LocalEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 200)));
  } catch {
    // Best effort: the browser fallback has no disk to rely on anyway.
  }
}

function uniqueLocalPath(path: string): string {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${dir ? `${dir}/` : ''}${stem} (восстановлено)${ext}`;
}

export const trash = {
  /** Moves a path into the trash. Returns false when nothing was deleted. */
  async put(storage: Storage, path: string): Promise<boolean> {
    if (isTauriRuntime()) {
      try {
        await invoke('trash_put', { path });
        return true;
      } catch {
        return false;
      }
    }
    try {
      const bytes = await storage.readBinary(path);
      const slash = path.lastIndexOf('/');
      const entry: LocalEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        originalPath: path,
        name: slash >= 0 ? path.slice(slash + 1) : path,
        deletedAt: Date.now(),
        isDir: false,
        size: bytes.byteLength,
        data: bytesToBase64(bytes),
      };
      writeLocal([entry, ...readLocal()]);
      await storage.remove(path);
      return true;
    } catch {
      return false;
    }
  },

  async list(): Promise<TrashEntry[]> {
    if (isTauriRuntime()) {
      try {
        return await invoke<TrashEntry[]>('trash_list');
      } catch {
        return [];
      }
    }
    return readLocal()
      .filter((entry) => typeof entry.data === 'string')
      .map(({ data: _data, ...entry }) => entry)
      .sort((left, right) => right.deletedAt - left.deletedAt);
  },

  /** Restores an entry; returns the path it was restored to, or null. */
  async restore(id: string, storage: Storage): Promise<string | null> {
    if (isTauriRuntime()) {
      try {
        return await invoke<string>('trash_restore', { id });
      } catch {
        return null;
      }
    }
    const entries = readLocal();
    const entry = entries.find((item) => item.id === id);
    if (!entry?.data) return null;
    try {
      let target = entry.originalPath;
      if (await storage.exists(target)) target = uniqueLocalPath(target);
      if (await storage.exists(target)) {
        const dot = target.lastIndexOf('.');
        target = dot > 0 ? `${target.slice(0, dot)} 2${target.slice(dot)}` : `${target} 2`;
      }
      await storage.writeBinary(target, base64ToBytes(entry.data));
      writeLocal(entries.filter((item) => item.id !== id));
      return target;
    } catch {
      return null;
    }
  },

  async remove(id: string): Promise<void> {
    if (isTauriRuntime()) {
      try {
        await invoke('trash_delete', { id });
      } catch {
        // Best effort.
      }
      return;
    }
    writeLocal(readLocal().filter((item) => item.id !== id));
  },

  /** Drops entries older than `days` (and keeps at most 200). Returns removed count. */
  async purge(days = TRASH_RETENTION_DAYS): Promise<number> {
    if (isTauriRuntime()) {
      try {
        return await invoke<number>('trash_purge', { days });
      } catch {
        return 0;
      }
    }
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const entries = readLocal();
    const kept = entries.filter((entry) => entry.deletedAt >= cutoff).slice(0, 200);
    writeLocal(kept);
    return entries.length - kept.length;
  },

  async empty(): Promise<void> {
    if (isTauriRuntime()) {
      try {
        await invoke('trash_empty');
      } catch {
        // Best effort.
      }
      return;
    }
    writeLocal([]);
  },
};
