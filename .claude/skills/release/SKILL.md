---
name: release
description: Full release workflow — typecheck, test, build, bump version, update badges, commit, push to main, tag, and trigger CI to build desktop app and publish GitHub Release. Run with /release.
user-invocable: true
---

# Release Workflow

Run the complete release pipeline for HIVEMIND. This skill handles everything from verification through GitHub Release publication.

## Trigger

User says: `/release`, "ship it", "push a release", "release a new version", "push to main and update desktop"

## Pre-flight Checks

Before doing anything, run ALL of these and stop if any fail:

```
pnpm typecheck            # npx tsc --noEmit
pnpm tsc -p tsconfig.email.json --noEmit  # email module typecheck
pnpm test                 # all tests must pass
pnpm build                # tsc && tsc -p tsconfig.email.json
node dist/cli/index.js --help  # CLI must boot
npm audit                 # root: 0 vulnerabilities
cd desktop && npm audit   # desktop: 0 vulnerabilities
```

If any check fails, stop and fix the issue before continuing.

## Version Bump

1. Read the current version from `package.json` (e.g. `1.0.0-beta.4`)
2. Increment the pre-release segment (e.g. `beta.4` → `beta.5`). If it's a stable release, increment patch.
3. Update the version in ALL of these files:
   - `package.json`
   - `desktop/package.json`
4. Update the test count badge in `README.md` — grep for the old count in the shields.io badge URL and the two prose mentions, replace with the actual count from the test run output.

## Build Desktop App

```bash
cd desktop && npm run build:mac
```

Verify the output DMG exists at `desktop/dist-electron/HIVEMIND-{version}-arm64.dmg`.

## Commit and Push

1. Stage all changed files (be specific — no `git add -A`)
2. Commit with message: `release: v{version}` + a one-line summary of what changed since last release
3. Push to `main`

## Tag and Trigger CI

1. Create annotated tag: `git tag -a v{version} -m "v{version}: {summary}"`
2. Push tag: `git push origin v{version}`
3. This triggers `.github/workflows/release.yml` which:
   - Builds Mac + Windows desktop apps on CI
   - Runs tests on all platforms
   - Creates a draft GitHub Release with assets
   - `publish-release` job flips it to a published pre-release
4. Existing desktop users get auto-updated via `electron-updater` (checks on launch + every 4h)

## Post-release Verification

Tell the user:
- The CI workflow URL (https://github.com/twinsavior/hivemind/actions)
- That the release will appear at https://github.com/twinsavior/hivemind/releases once CI completes (~5-10 min)
- That existing desktop users will be prompted to update automatically

## Important Notes

- NEVER skip pre-flight checks — a broken release wastes CI minutes and ships broken software
- If the tag already exists, bump to the next version instead of force-moving
- The `publish-release` job expects `electron-builder` to create the draft — don't create a manual release
- shields.io caches badge images for ~5 minutes; the dynamic version badge updates automatically from GitHub releases
- Test assertions must use `path.resolve()` not hardcoded POSIX paths (Windows CI uses backslash paths)
