/** Shared types for KOCPAD. */

export type ThemeMode = 'light' | 'dark' | 'system';

export type ViewMode = 'editor' | 'split' | 'preview';

export type SidebarTab = 'notes' | 'outline' | 'tags' | 'links';

export type AccentName = 'marker' | 'azure' | 'jade' | 'iris' | 'rose';

export type PreviewFont = 'serif' | 'sans' | 'mono';

export type EditorKeymap = 'default' | 'vim';

export type ExportTheme = 'light' | 'dark';

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
  /** Version stamp of the file as last read or written; drafts have none. */
  disk?: { mtimeMs: number; size: number } | null;
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
  editorTabSize: number;
  editorKeymap: EditorKeymap;
  exportTheme: ExportTheme;
  /** Distraction-free writing: no sidebar, no preview, one narrow column. */
  focusMode: boolean;
  /** Most recently opened notes, newest first (drafts included). */
  recentNotes: string[];
  recentFolders: string[];
  onboarded: boolean;
  showLineNumbers: boolean;
  /** Treat a single newline as a line break, like Notepad does. */
  softBreaks: boolean;
  /** Persisted settings schema; bumped when defaults need a one-time migration. */
  schema: number;
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
  editorTabSize: 4,
  editorKeymap: 'default',
  exportTheme: 'light',
  focusMode: false,
  recentNotes: [],
  recentFolders: [],
  onboarded: false,
  showLineNumbers: true,
  softBreaks: true,
  schema: 2,
  lastRoot: null,
  syncScroll: true,
};
