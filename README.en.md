<div align="center">
  <img src="docs/icon.png" alt="KOCPAD icon" width="80" height="80">
  <h1>KOCPAD · beta</h1>
  <p><b>The next version. Just what changed and what we are checking.</b></p>

  [![build](https://github.com/ShiDikALexey/KOCPAD/actions/workflows/build.yml/badge.svg?branch=beta)](https://github.com/ShiDikALexey/KOCPAD/actions/workflows/build.yml)
  [![beta](https://img.shields.io/badge/beta-1.5.3--beta.7-orange)](https://github.com/ShiDikALexey/KOCPAD/tree/beta)
  [![stable](https://img.shields.io/github/v/release/ShiDikALexey/KOCPAD?label=stable)](https://github.com/ShiDikALexey/KOCPAD/releases/latest)

  <sub><a href="README.md">Русский</a> · English · <a href="https://github.com/ShiDikALexey/KOCPAD/blob/main/README.en.md">full description (main)</a></sub>
</div>

---

This is the `beta` branch. It currently carries the pre-release `1.5.3-beta.7`:
stable/beta update channels, the available-update indicator, batch assistant fixes
and text-only printing. Stable `1.5.2` lives in
[main](https://github.com/ShiDikALexey/KOCPAD/blob/main/README.en.md); below is what
the 1.5 line brought and what this build is checked against.

## What is already in stable 1.5.2

The main point is that the notepad stopped losing text when things go wrong.

If a file was changed in another editor, KOCPAD no longer overwrites it silently: it
compares the file version before writing and asks what to do. If the app was killed
or the power went out, the next launch offers the recovered text. Old cp1251 `.txt`
files and CRLF files open and save back in their original encoding. Deleted notes
sit in the trash for 30 days and can be restored.

Then there are boundaries. File commands now only work inside the chosen folder. File
operations no longer block the window on a large folder. A second launch focuses the
existing window instead of starting another process. `Cargo.lock` is in the repo and
the CSP is stricter.

On the interface side: HTML and PDF export embed images and style `[[links]]`, `Del`
removes selected notes, modals keep focus, small text has better contrast. Menus work
with arrow keys, a missing `[[link]]` can be turned into a note with a click, renaming
a note rewrites links in other notes, and search no longer shows results from a stale
query.

CI also launches the built `.exe` now; before, only the web page was tested.

## What is new in 1.5.3-beta.7

- File associations: `.md`, `.markdown`, `.mdown` and `.txt` open in KOCPAD from
  Explorer, double-click or "Open with".
- A note opened from Explorer mounts its folder as the workspace; a second launch
  forwards the file to the running window.

## What is new in 1.5.3-beta.6

- Opt-in style hints: long sentences, repeated words and filler phrases. Repeats
  and filler phrases offer a one-click fix.

## What is new in 1.5.3-beta.5

- Workspace search has a regex mode (`.*`).
- Replace across the folder with a two-step confirmation; every affected note is
  snapshotted into history first, and encodings/line endings are preserved.

## What is new in 1.5.3-beta.4

- «⋯» → «Broken links…» lists every unresolved `[[…]]` with its source
  note and line, and can open the source or create the missing note.
- Moving a note rewrites folder-qualified links (`[[folder/Note]]`) to the new
  path; plain title links already survive.

## What is new in 1.5.3-beta.3

- Note version history: «⋯» → «Version history…» with preview and a
  two-step restore (the current text is snapshotted before rolling back).

## What is new in 1.5.3-beta.2

- «Skip this version» in the update dialog and a restore action in settings.
- The update dialog shows release notes from CHANGELOG.
- KOCPAD restarts itself after installing an update.

## What is new in 1.5.3-beta.1

- Settings → «Updates»: stable or beta channel, automatic checks and a manual
  check. Checks go through Rust commands with the selected endpoint and only signed
  releases are installed.
- When an update is available, the «⋯» button gets a dot, its menu entry becomes
  «Update X — install», and one toast is shown.
- For beta, CI refreshes a rolling `beta-channel` release with `latest.json`; stable
  `latest` and its updater are not touched.

## What is new in 1.5.2-a

- `Ctrl+P` prints the selected fragment, or the whole note without a selection;
  the app UI is no longer printed and WebView2 browser accelerators are off.
- A restored draft is not hidden behind the «no folder» welcome screen on
  launch.
- Right-click on a selection with assistant suggestions: «apply all fixes (N)»
  as one undo, and «dismiss suggestions (N)».

## What we are checking

Before merging into `main`, this needs a manual pass:

- change a note in Notepad, come back and press `Ctrl+S` — a conflict question should
  appear;
- type, kill the process with `taskkill /F /IM kocpad.exe` — the next launch should
  offer the recovered text;
- open an old cp1251 `.txt` and a CRLF file, edit them and save — encoding and line
  endings must stay the same;
- delete a note and restore it from «⋯» → «Корзина…»;
- launch the app twice — one window should remain;
- export a note with an image and a link, print it to PDF;
- use the menus with arrows, create a note from a missing link, rename a note and
  check the links.

There are 61 automated tests. There is also a launch of the `.exe` in CI, but a full
native e2e against the packaged app is blocked by the GitHub runner environment; see
[ROADMAP](docs/ROADMAP.md).

## Getting a beta build

On every push to `beta`, Actions builds the `kocpad-windows` artifact: the portable
`kocpad.exe` and the NSIS installer. MSI is skipped for beta because WiX does not
accept a version with a suffix.

No tags and no releases from this branch. First the checks, then the merge into
`main` and the `1.5.0` release.

## What comes next

After the checks, beta merges into `main` and ships as `1.5.0`. The
[Experimental](https://github.com/ShiDikALexey/KOCPAD/blob/Experimental/README.en.md)
branch holds the inline markup assistant; it is not part of beta.

Limitations and plans: [ROADMAP](docs/ROADMAP.md). Version policy:
[VERSIONING](docs/VERSIONING.md).
