/** Shared types for KOCPAD. */

export type ThemeMode = 'light' | 'dark' | 'system';

export type ViewMode = 'editor' | 'split' | 'preview';

export type StorageKind = 'tauri' | 'browser' | 'demo';

/** A node of the workspace tree. Directories carry `children`. */
export interface NoteNode {
  name: string;
  /** Native path in Tauri mode, slash path inside the browser workspace. */
  path: string;
  kind: 'file' | 'dir';
  children?: NoteNode[];
  /** File size in bytes, when the backend knows it. */
  size?: number;
}

/** An open tab. */
export interface Doc {
  path: string;
  name: string;
  content: string;
  /** Content as last written to disk, used for dirty tracking. */
  savedContent: string;
}

export interface Settings {
  theme: ThemeMode;
  mode: ViewMode;
  sidebarOpen: boolean;
  sidebarWidth: number;
  splitRatio: number;
  editorFontSize: number;
  showLineNumbers: boolean;
  lastRoot: string | null;
  syncScroll: boolean;
}

export interface SearchHit {
  path: string;
  name: string;
  line: number;
  column: number;
  /** Line text with the match, trimmed for display. */
  text: string;
  /** Offset of the match inside `text`, used for highlighting in the UI. */
  matchStart: number;
  matchLength: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  mode: 'split',
  sidebarOpen: true,
  sidebarWidth: 268,
  splitRatio: 0.5,
  editorFontSize: 14,
  showLineNumbers: false,
  lastRoot: null,
  syncScroll: true,
};
