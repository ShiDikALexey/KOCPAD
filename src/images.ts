import type { Storage } from './storage';
import { basename, dirname, extname, joinPath } from './path';
import { extensionForMime, timestampSlug } from './util';

const REMOTE_SRC = /^(https?:|data:|blob:|asset:)/i;

function sanitizeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';
}

/**
 * Saves images pasted or dropped into a note and resolves relative image
 * references back to displayable URLs.
 *
 * Files land in an `assets/` folder next to the note. Resolution goes through
 * the storage backend, so the same code works for native Windows files, a
 * browser folder and the demo workspace: the bytes become a blob URL that the
 * preview can show.
 */
export class ImageStore {
  private urlCache = new Map<string, string>();
  private pending = new Map<string, Promise<string | null>>();

  constructor(private storage: Storage) {}

  /** Writes the image next to the note and returns markdown ready to insert. */
  async save(notePath: string, file: File | Blob, suggestedName = ''): Promise<{ markdown: string; path: string } | null> {
    const mime = file.type || 'image/png';
    if (!mime.startsWith('image/')) return null;

    const assetsDir = joinPath(dirname(notePath), 'assets');
    try {
      await this.storage.createDir(assetsDir);
    } catch {
      // The folder usually exists already; a real failure surfaces on write.
    }

    const extension = extensionForMime(mime);
    const base = sanitizeName(suggestedName || `image-${timestampSlug()}`);
    const stem = extname(base) ? base.slice(0, base.length - extname(base).length) : base;
    let target = joinPath(assetsDir, `${stem}.${extension}`);
    let counter = 1;
    while (await this.storage.exists(target)) {
      target = joinPath(assetsDir, `${stem}-${counter}.${extension}`);
      counter += 1;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.storage.writeBinary(target, bytes);
    const relative = `assets/${basename(target)}`;
    return { markdown: `![](${relative})`, path: target };
  }

  /** Turns a relative `src` from markdown into a URL the webview can render. */
  async resolve(notePath: string, src: string): Promise<string | null> {
    if (!src) return null;
    if (REMOTE_SRC.test(src)) return src;

    const clean = decodeURI(src.split('#')[0].split('?')[0]);
    const absolute = clean.startsWith('/') ? clean : joinPath(dirname(notePath), clean);

    const cached = this.urlCache.get(absolute);
    if (cached) return cached;

    const inFlight = this.pending.get(absolute);
    if (inFlight) return inFlight;

    const task = (async (): Promise<string | null> => {
      try {
        const bytes = await this.storage.readBinary(absolute);
        const url = URL.createObjectURL(new Blob([bytes]));
        this.urlCache.set(absolute, url);
        return url;
      } catch {
        return null;
      } finally {
        this.pending.delete(absolute);
      }
    })();

    this.pending.set(absolute, task);
    return task;
  }

  /** Replaces relative image sources inside a rendered note. */
  async decorate(container: HTMLElement, notePath: string): Promise<void> {
    const images = Array.from(container.querySelectorAll('img'));
    await Promise.all(
      images.map(async (image) => {
        const src = image.getAttribute('src') ?? '';
        const url = await this.resolve(notePath, src);
        if (!url) {
          // A broken <img> shows nothing useful, so swap in a readable note.
          const placeholder = document.createElement('span');
          placeholder.className = 'image--missing';
          placeholder.textContent = `Не найден файл: ${src}`;
          placeholder.title = `Ожидался файл рядом с заметкой: ${src}`;
          image.replaceWith(placeholder);
          return;
        }
        if (url !== src) image.src = url;
      }),
    );
  }

  forget(path: string): void {
    const url = this.urlCache.get(path);
    if (!url) return;
    URL.revokeObjectURL(url);
    this.urlCache.delete(path);
  }
}
