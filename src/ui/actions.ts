import type { NoteNode, SidebarTab, ThemeMode, ViewMode } from '../types';

/** Callbacks the UI modules need from the app shell. Implemented in main.ts. */
export interface AppActions {
  openFolder(): void;
  openRecentFolder(path: string): void;
  closeWorkspace(): void;
  /** Re-reads the tree and forgets cached note text (F5). */
  refreshWorkspace(): void;
  createNote(parentDir?: string): void;
  createFolder(parentDir?: string): void;
  renameEntry(node: NoteNode): void;
  deleteEntry(node: NoteNode): void;
  /** Bulk actions from the tree multi-select. */
  deleteSelected(paths: string[]): void;
  moveSelected(paths: string[]): void;
  openNote(path: string, options?: { line?: number; column?: number }): void;
  /** Closes a tab: drafts are deleted, files are saved and closed. */
  closeTab(path: string): void;
  /** Saves the active draft into a folder as a real `.md` file. */
  saveDraftAsFile(): void;
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
  setSidebarTab(tab: SidebarTab): void;
  jumpToLine(line: number): void;
  openSettings(): void;
  openGlobalSearch(): void;
  openPalette(): void;
  openFind(): void;
  adjustFontSize(delta: number): void;
  toggleLineNumbers(): void;
  toggleSyncScroll(): void;
}
