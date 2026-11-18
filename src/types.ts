/** Shared types for KOCPAD. */

export type ThemeMode = 'light' | 'dark' | 'system';

export type ViewMode = 'editor' | 'split' | 'preview';

export type SidebarTab = 'notes' | 'outline';

export type AccentName = 'marker' | 'azure' | 'jade' | 'iris' | 'rose';

export type PreviewFont = 'serif' | 'sans' | 'mono';

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
  accent: AccentName;
  mode: ViewMode;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  splitRatio: number;
  editorFontSize: number;
  /** Empty string means the built-in monospace stack. */
  editorFontFamily: string;
  previewFontSize: number;
  previewFontFamily: PreviewFont;
  autosaveDelay: number;
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
  accent: 'marker',
  mode: 'split',
  sidebarOpen: true,
  sidebarTab: 'notes',
  sidebarWidth: 268,
  splitRatio: 0.5,
  editorFontSize: 14,
  editorFontFamily: '',
  previewFontSize: 16.5,
  previewFontFamily: 'serif',
  autosaveDelay: 700,
  showLineNumbers: false,
  lastRoot: null,
  syncScroll: true,
};
