# Versioning and maturity

This page exists because the project overshot its own version numbers. Honest account:

- KOCPAD reached `1.0.0` after two days of development. That release was labelled
  "first stable" in `CHANGELOG.md` without a single real user, without installer
  signing, without a clean-machine install and with features still being reworked the
  next day.
- Between 18 and 20 November 2026 the repository published **14 releases** (from
  `v0.2.0` to `v1.4.0`). Most of them were UI polish or a single feature. Versions
  stopped distinguishing a test build from something worth installing.

So: **do not read the version number as a maturity promise.** The 1.5 line has grown
a lot: `1.5.2` is the current release on `main`, carrying the data-safety work, the
boundary hardening, the inline assistant, and the print/shortcut fixes that follow
`1.5.1`. It is more mature than `1.4.0`, but the 2.0 gate below still says what
"stable" will have to mean.

## What we do with the existing versions

- **No renumbering backwards.** Tags and releases are public, the updater compares
  semver (`latest.json`), and installed copies are on `1.4.0`, `1.5.1` or `1.5.2`. A
  "downgrade" to 0.x would break update continuity without making the software any
  better.
- **No deleting releases.** They are the history. The fix is labelling, not erasing.
- The README states what each branch is and links here.
- Beta builds carry a suffix and are published as **pre-releases**
  (`v1.5.0-beta.1`): `/releases/latest` — and therefore the updater — keeps pointing
  at the last plain release, so a rejected beta can never reach users.
- A plain version is only tagged from `main`, after the beta has been used for a
  while, and is published as a normal release so the updater delivers it.

## Rules for the next versions

SemVer is used normally, but the bar for each digit is defined by verification, not
by ambition. CI enforces the mechanical part (`scripts/check-versions.cjs`: tag,
`package.json`, `package-lock.json`, `Cargo.toml` and `tauri.conf.json` must agree;
a `-beta` tag needs a `-beta` version).

| Bump | What may go in | Gate |
|---|---|---|
| **patch** `1.5.x` | bug fixes, documentation, small UI corrections | typecheck + build + 67 e2e green; the bug's reproduction checked by hand |
| **minor** `1.5.0` | a coherent set of features or a data-model change | the above, plus: the owner uses the beta for at least a week, no data-loss bug open, the changes have e2e coverage, rollback plan for user data |
| **major** `2.0.0` | a claim of stability | everything below in "2.0 gate" |

### 2.0 gate (what "stable" must mean here)

1. No open P0/P1 data-loss bug; the four data-safety gaps that used to be open are
   verifiably closed:
   external-edit detection, crash recovery, encodings (cp1251/UTF-16/BOM/CRLF) and
   permanent deletion (recycle bin or version history).
2. At least one native smoke test on Windows against the built `.exe`
   (open folder → edit → kill → reopen → update), not only browser e2e.
3. Installer signing decision made: signed by a compatible certificate **or**
   explicitly "unsigned by design", with the SmartScreen warning documented.
4. Clean-machine install verified (Windows 10 without WebView2, offline).
5. Upgrade from `1.x` verified on real data, including drafts and settings.
6. Performance budget measured: startup to first keystroke, typing on a 5 MB note,
   workspace with 1000 notes.

## Additional rules

- **One release per week at most.** Several finished changes go into one release;
  a release is a checkpoint, not a progress bar.
- **Beta first.** Features and data-model changes land on `beta`, are built by CI,
  get tried with real notes, then merge to `main` and are tagged.
- **Release notes are written from `CHANGELOG.md`** — the release job extracts the
  section for the tag (`scripts/changelog-notes.cjs`) and fails if it is missing.
  No blind "generate from commits".
- **No release without a fresh installer smoke test** on the same Windows machine:
  install → create a note → close → reopen → update from the previous version.
- **Rollback is roll-forward.** A bad release gets a patch, not a deleted tag; keep
  a known-good `latest.json` as a kill switch.

## Release checklist (short)

1. `beta` is green in CI (typecheck, 46 e2e, Windows build).
2. Manual pass: create/edit/close/reopen, drafts panel, large note, images, export,
   search, tags/links, settings persistence.
3. Cleanup: no `TODO`/debug code, versions consistent (`npm run check:versions`),
   README/docs match the behaviour, `CHANGELOG.md` has the new section.
4. Merge to `main`, bump, tag, wait for the release job, verify assets and
   `SHA256SUMS.txt`, install the new build over the old one.

## Honest current maturity

| Area | State |
|---|---|
| Core writing (edit, save, close, reopen) | works, covered by tests and by hand |
| Drafts and session restore | works on `beta`, needs a week of real use |
| Search, tags, links | work; search reads the folder on first query (cached after) |
| Images and export | images work in the packaged app since 1.4.1 (CSP fix); export does not embed them |
| Large folders | chunked rendering; no lazy backend loading yet |
| Windows integration | no file associations, no tray, no jump list, no single-instance guard |
| Installer | unsigned, SmartScreen warning on first launch |
| Updates | signed with a project key, verified end to end once; beta releases are pre-releases |
