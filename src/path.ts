/** Path helpers that understand both Windows (`\`) and POSIX (`/`) separators. */

export function sepOf(path: string): '/' | '\\' {
  return path.includes('\\') ? '\\' : '/';
}

/** Joins a directory and a child name using the directory's own separator. */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = sepOf(dir);
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index <= 0 ? '' : path.slice(0, index);
}

export function extname(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index).toLowerCase();
}

/** Files KOCPAD can open as text. Anything else stays hidden in the tree. */
export const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.txt']);

export function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path));
}

/** Normalized form used for comparisons: forward slashes, lowercased. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** True when `path` equals `parent` or lives inside it. */
export function isInside(path: string, parent: string): boolean {
  const p = normalizePath(path);
  const root = normalizePath(parent);
  if (!root) return false;
  return p === root || p.startsWith(root + '/');
}
