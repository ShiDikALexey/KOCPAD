/**
 * Draft notes: what a notepad opens before any file exists.
 *
 * A draft is a document with no file on disk. Its content is kept in
 * `localStorage` so a crash, a closed window or a forgotten save cannot lose it.
 * The tab shows up exactly like a file tab; "Сохранить в папку…" turns it into a
 * real `.md` file.
 */

export const DRAFT_PREFIX = 'draft:';
const DRAFTS_KEY = 'kocpad.drafts';

export interface StoredDraft {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}

export function isDraftPath(path: string): boolean {
  return path.startsWith(DRAFT_PREFIX);
}

export function draftIdOf(path: string): string {
  return path.slice(DRAFT_PREFIX.length);
}

export function draftPathOf(id: string): string {
  return `${DRAFT_PREFIX}${id}`;
}

/** «Новая заметка», «Новая заметка 2», … — never collides with an open title. */
export function nextDraftTitle(taken: string[]): string {
  const base = 'Новая заметка';
  const used = new Set(taken.map((title) => title.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export function newDraftId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${random}`;
}

export function loadDrafts(): StoredDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is StoredDraft => {
        if (!item || typeof item !== 'object') return false;
        const draft = item as Partial<StoredDraft>;
        return typeof draft.id === 'string' && typeof draft.title === 'string' && typeof draft.content === 'string';
      })
      .map((draft) => ({
        id: draft.id,
        title: draft.title,
        content: draft.content,
        updatedAt: typeof draft.updatedAt === 'number' ? draft.updatedAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

/** Returns false when the browser storage refuses the write (quota, private mode). */
export function persistDrafts(drafts: StoredDraft[]): boolean {
  try {
    if (drafts.length === 0) localStorage.removeItem(DRAFTS_KEY);
    else localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    return true;
  } catch {
    return false;
  }
}
