# Keyboard shortcuts

`Ctrl` means `Ctrl` on Windows. On macOS builds use `Cmd` where `Ctrl` is written
(CodeMirror keymaps already map `Mod` correctly; the global shortcuts check both).

## Notes and tabs

| Keys | Action |
| --- | --- |
| `Ctrl+N` | New note: a draft appears immediately, no folder and no name dialog |
| `Ctrl+Alt+N` | Quick capture — global hotkey: brings KOCPAD to the front and starts a note, works from any application |
| `Ctrl+B` | Bold around the selection (`**…**`); pressing again removes it |
| `Ctrl+I` | Italic (`*…*`), toggles the same way |
| ``Ctrl+` `` | Inline code (`` `…` ``) |
| `Ctrl+Shift+K` | Insert a link `[text](url)` and select the address placeholder |
| `Ctrl+Alt+1` / `Ctrl+Alt+2` / `Ctrl+Alt+3` | Heading 1 / 2 / 3 for the current line or the selection |
| `Ctrl+Alt+0` | Turn the block back into plain text |
| Right click in the editor | Context menu: cut/copy/paste, formatting, block types, find the selection, strip markup |
| `Ctrl+Shift+N` | New folder in the current folder |
| `Ctrl+O` | Choose the notes folder |
| `Ctrl+S` | Save now; for a draft this opens «Сохранить в папку…» |
| `Ctrl+Shift+S` | Save every dirty note and draft |
| `Ctrl+W` | Close the current tab (autosaves first). Closing a draft tab keeps the draft in the drafts list |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `F2` | Rename the current note or draft title |
| `F5` | Refresh the notes tree (and forget cached text, picking up external edits) |
| — | Close the folder: the folder button in the sidebar header or «Ещё» → «Закрыть папку» |
| `Ctrl+Shift+E` | Export the current note to HTML |
| `Ctrl+P` | Print the note (Windows print dialog, so "save as PDF" works) |

Encodings, when the automatic detection is wrong: palette (`Ctrl+K`) →
«Кодировка: открыть как UTF-8», «… cp1251», «… UTF-16LE». The status bar shows the
detected encoding, BOM and CRLF.

## Editing

| Keys | Action |
| --- | --- |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo (history is per tab) |
| `Ctrl+B` | Wrap the selection in `**bold**` |
| `Ctrl+I` | Wrap the selection in `*italic*` |
| `Ctrl+=` / `Ctrl++` | Bigger editor text |
| `Ctrl+-` | Smaller editor text |
| `Ctrl+0` | Reset editor text to 14 px |
| `Tab` | Indent inside the editor (inserts a tab, not focus) |

## Search

| Keys | Action |
| --- | --- |
| `Ctrl+F` | Find in the current note |
| `Ctrl+H` | Find and replace in the current note |
| `Enter` / `Shift+Enter` | Next / previous match in the search panel |
| `Esc` | Close the search panel |
| `Ctrl+Shift+F` | Search across every note in the folder |
| `↑` / `↓` in workspace search | Move between results |
| `Enter` in workspace search | Open the selected hit at its line |

## View

| Keys | Action |
| --- | --- |
| `Ctrl+E` | Cycle editor → split → preview |
| `Ctrl+K` | Command palette |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+O` | Outline panel (headings of the current note) |
| `Ctrl+Shift+Z` | Focus mode: hide the sidebar and the preview, center the text column |
| — | Tags panel: palette (`Ctrl+K`) → «Панель: теги», or the «Теги» tab |
| `Ctrl+\` | Show or hide the sidebar |
| `Ctrl+Shift+L` | Switch between light and dark theme |
| `Esc` | Close any dialog, palette or overlay |

## Images and files

| Action | Result |
| --- | --- |
| `Ctrl+V` with an image in the clipboard | Image saved to `assets/` next to the note, `![](...)` inserted at the caret |
| Drop an image file onto the window | Same as paste |
| Drop a `.md` / `.txt` file from Explorer | Imported into the current note's folder and opened (an existing note with that name is opened instead) |

## Wiki links

| Action | Result |
| --- | --- |
| Type `[[` in the editor | Autocomplete with note titles and their folders; `Enter` inserts the title and `]]` |
| `[[Заметка]]` in the text | Clickable link in the preview; click to open the note |
| `[[Заметка\|свой текст]]` | Same link with custom display text |
| «Связи» sidebar tab | Outgoing links of the active note and backlinks to it |
| Unresolved `[[…]]` | Dashed underline; clicking explains the target does not exist |

## Multi-select in the tree

| Keys | Action |
| --- | --- |
| `Ctrl+Click` | Add a note to the selection or remove it |
| `Shift+Click` | Select the range from the last clicked note |
| `Esc` | Clear the selection |
| Selection bar → «Переместить» | Move every selected note into another workspace folder |
| Selection bar → «Удалить» | Delete every selected note after one confirmation |

## Vim mode

Settings → Редактор → Раскладка клавиш → **Vim** switches the editor to a Vim
keymap, loaded on demand so it costs nothing when unused: normal and insert modes,
`hjkl`, `dd`, `ciw`, counts, `/` search and the rest of what
`@replit/codemirror-vim` implements. The status bar shows `· Vim` while it is on,
and the global shortcuts (`Ctrl+N`, `Ctrl+F`, `Ctrl+K`, …) keep working.

Tab width is a separate setting (2 / 4 / 8 spaces); it affects how existing tab
characters are displayed and how `Tab` indents.

## Drafts

A draft is a note without a file: it is stored locally and survives closing the tab
or the whole app.

| Action | Result |
| --- | --- |
| `Ctrl+N` | New draft, no folder required |
| Sidebar button with a counter | Opens the drafts panel: open, «В папку…», delete |
| `Ctrl+S` on a draft | «Сохранить в папку…» — turns it into a real `.md` file |
| `Ctrl+W` on a draft tab | Closes the tab only; the draft stays in the list |
| Closing the window | Saves nothing extra and asks nothing; drafts and tabs come back next launch |

## Mouse

| Gesture | Action |
| --- | --- |
| Click a folder | Expand or collapse it |
| Click a note | Open it in a tab |
| Click a heading in the outline | Jump to that line |
| Middle click a tab | Close it |
| Drag the sidebar edge | Resize the sidebar |
| Drag the divider between panes | Change the editor / preview split |
| Right click a note or folder | Context menu (open, rename, delete, copy path, reveal) |
| Click a checkbox in the preview | Toggle the matching `- [ ]` in the source |
| Click a link in the preview | Open it in the default browser |
