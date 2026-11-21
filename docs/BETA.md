# Beta branch

`main` is the release line: every tag `v*` built from it goes to GitHub Releases,
and the updater reads `latest.json` from the latest release. Finished work lands there.

`beta` is where the next version is built. Quick experiments, visual changes and
anything that still needs a second look go here first.

## Workflow

1. Branch from `beta` for a change, or commit to `beta` directly for small fixes.
2. CI runs the same four jobs on every push: typecheck + build, e2e (34 scenarios),
   Windows installers, and a release only for tags. On `beta` the Windows job uploads
   the `kocpad-windows` artifact — a ready portable exe and installers to try.
3. When the change is verified, merge `beta` into `main` with a merge commit or a
   fast-forward, bump the version (`node scripts/bump-version.cjs <x.y.z>`), and tag
   the release.

## Getting a beta build

- From the Actions tab: open the latest `build` run on `beta`, download the
  `kocpad-windows` artifact, unpack `kocpad.exe`.
- Or build locally: `git checkout beta`, `npm ci`, `npm run tauri:build`.

Beta builds are unsigned and are **not** published as releases, so they never reach
the updater. A beta build with the same version as the installed app will not appear
as an update — that is intentional.
