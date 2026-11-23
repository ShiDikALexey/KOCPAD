import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './storage/types';

/**
 * Local note history: snapshots of saved revisions, kept in the app profile by
 * Rust (or in localStorage in the browser fallback used by e2e).
 */

export interface HistoryEntry {
  id: string;
  savedAt: number;
  size: number;
}

interface BrowserSnapshot extends HistoryEntry {
  text: string;
}

const STORAGE_KEY = 'kocpad.history';
const MAX_ENTRIES = 30;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 60 * 1000;

/** Last snapshot time/text per path, so autosave cannot flood the history. */
const lastRecord = new Map<string, { at: number; text: string }>();

type BrowserStore = Record<string, BrowserSnapshot[]>;

function readAll(): BrowserStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as BrowserStore;
  } catch {
    return {};
  }
}

function writeAll(store: BrowserStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // History is best effort: a full localStorage must not break saving.
  }
}

function prune(list: BrowserSnapshot[]): BrowserSnapshot[] {
  const cutoff = Date.now() - RETENTION_MS;
  return list
    .filter((entry) => entry.savedAt >= cutoff)
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, MAX_ENTRIES);
}

/**
 * Records a snapshot when a note was just written. Skips identical text and
 * throttles autosave to one snapshot per five minutes per note.
 */
export async function recordHistorySnapshot(
  path: string,
  text: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!text.trim()) return;
  const now = Date.now();
  const previous = lastRecord.get(path);
  if (!options.force && previous) {
    if (previous.text === text) return;
    if (now - previous.at < MIN_INTERVAL_MS) return;
  }
  lastRecord.set(path, { at: now, text });

  if (isTauriRuntime()) {
    try {
      await invoke('history_put', { path, text });
    } catch {
      // History is never allowed to break a normal save.
    }
    return;
  }

  const store = readAll();
  const list = prune([
    ...(store[path] ?? []),
    { id: String(now), savedAt: now, size: text.length, text },
  ]);
  store[path] = list;
  writeAll(store);
}

export async function listSnapshots(path: string): Promise<HistoryEntry[]> {
  if (isTauriRuntime()) {
    try {
      return await invoke<HistoryEntry[]>('history_list', { path });
    } catch {
      return [];
    }
  }
  const list = prune(readAll()[path] ?? []);
  return list.map(({ id, savedAt, size }) => ({ id, savedAt, size }));
}

export async function readSnapshot(path: string, id: string): Promise<string | null> {
  if (isTauriRuntime()) {
    try {
      return await invoke<string>('history_read', { path, id });
    } catch {
      return null;
    }
  }
  const found = (readAll()[path] ?? []).find((entry) => entry.id === id);
  return found?.text ?? null;
}

export async function clearHistory(path: string): Promise<void> {
  lastRecord.delete(path);
  if (isTauriRuntime()) {
    try {
      await invoke('history_clear', { path });
    } catch {
      // Nothing to clear or the profile is read-only.
    }
    return;
  }
  const store = readAll();
  delete store[path];
  writeAll(store);
}
