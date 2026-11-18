import type { NoteNode, StorageKind } from '../types';

/**
 * Everything KOCPAD needs from the host.
 *
 * Three implementations exist:
 *  - `TauriStorage` — native Windows build, real files through Rust commands;
 *  - `BrowserStorage` — dev/preview build, File System Access API;
 *  - `DemoStorage` — in-memory sample workspace, used when neither is available.
 *
 * Paths are opaque to the rest of the app: native Windows paths in Tauri mode,
 * slash-separated relative paths in browser/demo mode.
 */
export interface Storage {
  readonly kind: StorageKind;
  /** Human readable backend name, shown in the status bar. */
  readonly label: string;
  /** False when writes cannot reach the disk (demo). */
  readonly canPersist: boolean;
  /** Workspace root path, or null when no folder is selected. */
  readonly root: string | null;
  /** Display name of the workspace root. */
  readonly rootName: string;

  /** Opens the folder picker and mounts the chosen folder. */
  chooseRoot(): Promise<boolean>;
  /** Mounts a known absolute path without a picker (native backend only). */
  mountRoot(path: string): Promise<boolean>;
  /** Re-mounts the folder used last time. Returns false when it is gone. */
  restoreRoot(): Promise<boolean>;
  /** Detaches the workspace: after this `root` is null until a folder is picked. */
  closeRoot(): Promise<void>;
  /** Reads the whole workspace tree below the root. */
  listTree(): Promise<NoteNode[]>;

  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  /** Reads a binary asset (images pasted into a note). */
  readBinary(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeBinary(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  createFile(path: string, text?: string): Promise<void>;
  createDir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;

  /** Asks where to store an exported file. Returns the path written, or null. */
  saveAs(defaultName: string, content: string, mime?: string): Promise<string | null>;
  /** Opens a link in the user's default browser. */
  openExternal(url: string): Promise<void>;
  /** Highlights a file in the OS file manager. Best effort. */
  reveal(path: string): Promise<void>;
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
