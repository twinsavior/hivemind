---
name: smoke-test
version: 1.0.0
agent: builder
description: "Verify that code changes actually work — build, run, test, and visually confirm via Chrome CDP. Use when the user says test this, does it work, verify, smoke test, check if it's working, or after any significant code change."
triggers: ["smoke test", "test this", "does it work", "verify this works", "check if it's working", "is it broken", "run the tests", "make sure it works", "did that break anything", "sanity check"]
dependencies: []
requiredSecrets: []
timeout: 300
tags: ["testing", "verification", "quality", "smoke-test"]
author: nova
---

# Smoke Test — Product Verification

Verify that code changes actually work. Don't trust "it compiled" — prove it runs, passes tests, and looks right.

## Process

### Phase 1: Identify What Changed

1. Run `git diff --stat` to see which files changed
2. Run `git diff` to understand WHAT changed (not just where)
3. Categorize the change:
   - **Backend logic** → needs unit tests + integration check
   - **Frontend UI** → needs visual verification via Chrome CDP
   - **API endpoint** → needs curl/fetch test
   - **Config/build** → needs build + startup verification
   - **Database/schema** → needs migration check + data verification

### Phase 2: Build & Type-Check

1. Run `npx tsc --noEmit` — must pass with zero errors
2. If build system exists, run `pnpm build` — must succeed
3. If either fails, report the exact errors. Do NOT proceed until fixed.

### Phase 3: Run Tests

1. Check for existing tests: `Glob` for `**/*.test.ts`, `**/*.spec.ts`
2. Run `pnpm test` — capture output
3. If tests fail:
   - Report which tests failed and why
   - Check if the failure is from the new change or pre-existing
   - If pre-existing, note it and continue. If new, stop and report.
4. If no tests exist for the changed code, note this as a gap

### Phase 4: Runtime Verification

Based on the change type:

**For servers/APIs:**
1. Start the server: `pnpm dev` (background)
2. Wait 3 seconds for startup
3. Hit the affected endpoint with `curl` or `WebFetch`
4. Verify response status, shape, and content
5. Check server logs for errors

**For UI changes:**
1. Start the dev server if not running
2. Use Chrome CDP: `node skills/chrome-cdp/scripts/cdp.mjs list` to find the tab
3. Navigate to the affected page: `cdp.mjs nav <targetId> <url>`
4. Take a screenshot: `cdp.mjs shot <targetId>` — show it to the user
5. Get the accessibility tree: `cdp.mjs snap <targetId>` — verify elements exist
6. If interactive, click/type to test the flow

**For CLI changes:**
1. Run the CLI command that was changed
2. Capture stdout and stderr
3. Verify output matches expectations

### Phase 5: Report

```
## Smoke Test Results

### What Changed
[1-2 sentence summary of the change]

### Results
| Check | Status | Details |
|-------|--------|---------|
| Type-check | ✅/❌ | [errors if any] |
| Tests | ✅/❌/⚠️ | [X passed, Y failed, Z skipped] |
| Runtime | ✅/❌ | [what was verified] |
| Visual | ✅/❌/N/A | [screenshot if applicable] |

### Issues Found
[List any problems, or "None — all checks passed"]

### Gaps
[Tests missing, edge cases not covered, things that need manual verification]
```

## Gotchas

- **Don't trust "no errors" as "it works."** A function can type-check perfectly and return wrong data. Test the actual output.
- **Dev server startup is async.** After `pnpm dev`, wait for the "listening on" message before hitting endpoints. Don't just sleep and hope.
- **Chrome CDP screenshots need the tab to be visible.** If the tab is in the background, the screenshot may be stale or blank.
- **Pre-existing test failures are common.** Don't block on failures that existed before the change. Note them and move on.

## Memory

Store under `verify.<feature-slug>`:
- **L0**: "Smoke test [passed/failed] for [feature] on {date}"
- **L1**: Results table, issues found
- **L2**: Full test output, screenshots, logs
