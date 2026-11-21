import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './storage/types';

/**
 * Crash-recovery journal.
 *
 * While a document has unsaved edits, the store writes a snapshot here roughly
 * once a second. A kill or a power cut then leaves a recoverable copy; a normal
 * save removes the snapshot. Native builds keep the files in the app profile via
 * Rust, the browser fallback uses localStorage so e2e can exercise it.
 */
export interface JournalEntry {
  key: string;
  path: string;
  text: string;
  savedAt: number;
}

const STORAGE_KEY = 'kocpad.recovery';

/** FNV-1a: a short, filesystem-safe key for a document path. */
export function journalKeyFor(path: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function readLocal(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is JournalEntry =>
        typeof item === 'object'
        && item !== null
        && typeof (item as JournalEntry).key === 'string'
        && typeof (item as JournalEntry).path === 'string'
        && typeof (item as JournalEntry).text === 'string'
        && typeof (item as JournalEntry).savedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeLocal(entries: JournalEntry[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

export const journal = {
  async list(): Promise<JournalEntry[]> {
    if (isTauriRuntime()) {
      try {
        const entries = await invoke<JournalEntry[]>('recovery_list');
        return entries.sort((left, right) => right.savedAt - left.savedAt);
      } catch {
        return [];
      }
    }
    return readLocal().sort((left, right) => right.savedAt - left.savedAt);
  },

  async write(entry: JournalEntry): Promise<boolean> {
    if (isTauriRuntime()) {
      try {
        await invoke('recovery_write', {
          key: entry.key,
          path: entry.path,
          text: entry.text,
          savedAt: entry.savedAt,
        });
        return true;
      } catch {
        return false;
      }
    }
    const entries = readLocal().filter((item) => item.key !== entry.key);
    entries.push(entry);
    return writeLocal(entries);
  },

  async remove(key: string): Promise<void> {
    if (isTauriRuntime()) {
      try {
        await invoke('recovery_remove', { key });
      } catch {
        // Best effort: a stale journal entry is not worth an error dialog.
      }
      return;
    }
    writeLocal(readLocal().filter((item) => item.key !== key));
  },

  async clear(): Promise<void> {
    if (isTauriRuntime()) {
      try {
        await invoke('recovery_clear');
      } catch {
        // Best effort.
      }
      return;
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Best effort.
    }
  },
};
