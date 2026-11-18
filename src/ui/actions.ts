import type { NoteNode, ThemeMode, ViewMode } from '../types';

/** Callbacks the UI modules need from the app shell. Implemented in main.ts. */
export interface AppActions {
  openFolder(): void;
  createNote(parentDir?: string): void;
  createFolder(parentDir?: string): void;
  renameEntry(node: NoteNode): void;
  deleteEntry(node: NoteNode): void;
  openNote(path: string, options?: { line?: number; column?: number }): void;
  revealEntry(node: NoteNode): void;
  copyPath(node: NoteNode): void;
  saveAll(): void;
  reloadActive(): void;
  exportHtml(): void;
  printPdf(): void;
  toggleTheme(): void;
  setTheme(theme: ThemeMode): void;
  cycleMode(): void;
  setMode(mode: ViewMode): void;
  toggleSidebar(): void;
  openGlobalSearch(): void;
  openPalette(): void;
  openFind(): void;
  adjustFontSize(delta: number): void;
  toggleLineNumbers(): void;
  toggleSyncScroll(): void;
}
