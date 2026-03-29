---
name: deploy
description: Deploy to production, check logs for startup errors, and report status. Use when the user says deploy, push to prod, ship it, or after making code changes that need to go live.
allowed-tools: Bash
---

# Deploy to Production

HIVEMIND deploys via GitHub Releases — desktop users get auto-updates via electron-updater.

1. **Run pre-flight checks:**
   ```bash
   pnpm typecheck
   npx tsc -p tsconfig.email.json --noEmit
   pnpm test
   pnpm build
   node dist/cli/index.js --help
   npm audit
   cd desktop && npm audit
   ```

2. **Build desktop app:**
   ```bash
   cd desktop && npm run build:mac
   ```

3. **Push to main** (if not already pushed)

4. **Tag and push** to trigger CI release:
   ```bash
   git tag -a v{version} -m "v{version}: {summary}"
   git push origin v{version}
   ```

5. **Verify:** CI builds Mac + Windows at https://github.com/twinsavior/hivemind/actions
   Release appears at https://github.com/twinsavior/hivemind/releases

6. **Report results:**
   - Success: "Released v{version}. Desktop users will be prompted to update."
   - Failure: Show the CI error, suggest a fix.

## Rules

- Always run pre-flight checks before deploying
- Never skip tests — a broken release ships broken software to real users
- The `/release` skill handles the full pipeline end-to-end
