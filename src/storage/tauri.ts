import { invoke } from '@tauri-apps/api/core';
import type { NoteNode } from '../types';
import { base64ToBytes, bytesToBase64 } from '../util';
import type { FileStat, Storage } from './types';

/** Shape returned by the Rust `fs_list_tree` command. */
interface RawNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children: RawNode[];
}

function toNoteNode(raw: RawNode): NoteNode {
  return {
    name: raw.name,
    path: raw.path,
    kind: raw.is_dir ? 'dir' : 'file',
    size: raw.size || undefined,
    children: raw.children?.map(toNoteNode),
  };
}

/**
 * Native backend. All file work happens in Rust (`src-tauri/src/fs_ops.rs`),
 * which keeps the webview free of plugin scope configuration and gives us one
 * place for the markdown/text file filter.
 */
export class TauriStorage implements Storage {
  readonly kind = 'tauri' as const;
  readonly label = 'Windows';
  readonly canPersist = true;
  private currentRoot: string | null = null;

  get root(): string | null {
    return this.currentRoot;
  }

  get rootName(): string {
    if (!this.currentRoot) return 'Папка не выбрана';
    const parts = this.currentRoot.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? this.currentRoot;
  }

  async chooseRoot(): Promise<boolean> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({
      directory: true,
      multiple: false,
      title: 'Выберите папку с заметками',
    });
    if (typeof picked !== 'string') return false;
    try {
      await invoke('fs_set_root', { root: picked });
    } catch {
      return false;
    }
    this.currentRoot = picked;
    return true;
  }

  async mountRoot(path: string): Promise<boolean> {
    // The Rust commands only accept paths below the mounted root, so the root
    // must be set before anything is listed or read.
    try {
      await invoke('fs_set_root', { root: path });
      await invoke('fs_list_tree', { path });
    } catch {
      await invoke('fs_set_root', { root: null }).catch(() => undefined);
      return false;
    }
    this.currentRoot = path;
    localStorage.setItem('kocpad.root', path);
    return true;
  }

  async restoreRoot(): Promise<boolean> {
    const remembered = localStorage.getItem('kocpad.root');
    if (!remembered) return false;
    try {
      await invoke('fs_set_root', { root: remembered });
    } catch {
      localStorage.removeItem('kocpad.root');
      return false;
    }
    this.currentRoot = remembered;
    return true;
  }

  async closeRoot(): Promise<void> {
    this.currentRoot = null;
    localStorage.removeItem('kocpad.root');
    await invoke('fs_set_root', { root: null }).catch(() => undefined);
  }

  async listTree(): Promise<NoteNode[]> {
    if (!this.currentRoot) return [];
    const raw = await invoke<RawNode[]>('fs_list_tree', { path: this.currentRoot });
    return raw.map(toNoteNode);
  }

  async readText(path: string): Promise<string> {
    return invoke<string>('fs_read_text', { path });
  }

  async writeText(path: string, text: string): Promise<void> {
    await invoke('fs_write_text', { path, contents: text });
  }

  async readBinary(path: string): Promise<Uint8Array<ArrayBuffer>> {
    // Binary crosses the IPC boundary as base64: JSON arrays of bytes are far slower.
    const encoded = await invoke<string>('fs_read_binary', { path });
    return base64ToBytes(encoded);
  }

  async writeBinary(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    await invoke('fs_write_binary', { path, data: bytesToBase64(bytes) });
  }

  async createFile(path: string, text = ''): Promise<void> {
    await invoke('fs_write_text', { path, contents: text });
  }

  async createDir(path: string): Promise<void> {
    await invoke('fs_create_dir', { path });
  }

  async rename(from: string, to: string): Promise<void> {
    await invoke('fs_rename', { from, to });
  }

  async remove(path: string): Promise<void> {
    await invoke('fs_remove', { path });
  }

  async exists(path: string): Promise<boolean> {
    return invoke<boolean>('fs_exists', { path }).catch(() => false);
  }

  async stat(path: string): Promise<FileStat | null> {
    return invoke<FileStat | null>('fs_stat', { path }).catch(() => null);
  }

  async saveAs(defaultName: string, content: string, _mime = 'text/plain;charset=utf-8'): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const ext = defaultName.split('.').pop() ?? 'txt';
    const target = await save({
      title: 'Сохранить как',
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!target) return null;
    // The chosen export path can be anywhere, so it bypasses the workspace scope.
    await invoke('fs_save_text', { path: target, contents: content });
    return target;
  }

  async openExternal(url: string): Promise<void> {
    await invoke('open_external', { url });
  }

  async reveal(path: string): Promise<void> {
    await invoke('reveal_in_explorer', { path }).catch(() => undefined);
  }
}
