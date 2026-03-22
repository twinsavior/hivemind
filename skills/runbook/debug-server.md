---
name: debug-server
version: 1.0.0
agent: builder
description: "Diagnose server issues — takes a symptom (error, crash, slow response, blank page) and walks through a structured investigation. Use when something is broken, not working, erroring, or behaving unexpectedly."
triggers: ["debug this", "it's broken", "not working", "server error", "why is this failing", "something's wrong", "debug server", "investigate error", "fix this bug", "what's causing this", "diagnose", "troubleshoot"]
dependencies: []
requiredSecrets: []
timeout: 600
tags: ["debugging", "runbook", "investigation", "server", "troubleshooting"]
author: nova
---

# Debug Server — Runbook

Systematic debugging. Take a symptom, investigate methodically, produce a structured finding.

## Process

### Phase 1: Capture the Symptom

1. Get the exact error message, status code, or behavior description
2. Determine WHEN it started — check `git log --oneline -10` for recent changes
3. Determine WHERE — which endpoint, page, or function
4. Determine FREQUENCY — always, intermittent, or one-time

### Phase 2: Check the Obvious First

Run these in order (stop at the first hit):

1. **Is the server running?**
   - `curl -s http://localhost:3000/health` or equivalent
   - Check process: `ps aux | grep node` or `lsof -i :3000`
   - If not running, check why: look at last output, check logs

2. **Does it build?**
   - `npx tsc --noEmit` — type errors are the #1 cause of "it stopped working"
   - If build fails, the error IS the bug. Fix it.

3. **What changed recently?**
   - `git diff HEAD~3` — check last 3 commits
   - `git log --oneline -10` — scan for suspicious changes
   - If it worked before a specific commit: `git stash && pnpm dev` to verify

4. **Are dependencies up to date?**
   - Check if `node_modules` exists and `pnpm install` was run after package.json changes
   - `pnpm install` to be safe

### Phase 3: Targeted Investigation

Based on the symptom type:

**HTTP errors (4xx/5xx):**
1. Find the route handler: `Grep` for the endpoint path in `src/`
2. Read the handler code
3. Check middleware chain — auth, validation, error handlers
4. Look for thrown errors: `Grep` for `throw` in the handler and its dependencies
5. Test with minimal curl: `curl -v http://localhost:3000/path`

**Blank page / UI not loading:**
1. Check browser console via CDP: `cdp.mjs eval <targetId> "JSON.stringify(window.__errors || [])"`
2. Check network requests: `cdp.mjs net <targetId>`
3. Check if static files are being served
4. Look for JS errors in the renderer

**Crash / process exits:**
1. Check for unhandled promise rejections: `Grep` for `.catch` gaps
2. Check for uncaught exceptions in async code
3. Look for resource exhaustion: file handles, memory, connections
4. Check if the error is in a dependency vs our code

**Slow response:**
1. Add timing: check which phase is slow (DB query? External API? Computation?)
2. Check for N+1 queries or unbounded loops
3. Check for missing `await` (fire-and-forget that blocks)

### Phase 4: Root Cause

1. State the root cause in ONE sentence
2. Show the exact line(s) of code responsible
3. Explain WHY it fails (not just what's wrong)
4. Check if this same pattern exists elsewhere: `Grep` for similar code

### Phase 5: Fix & Verify

1. Implement the fix using `Edit` (surgical changes only)
2. Run `npx tsc --noEmit` — must pass
3. Run `pnpm test` if tests exist for the affected area
4. Start the server and verify the symptom is gone
5. Check for regressions — does everything else still work?

### Phase 6: Report

```
## Debug Report

### Symptom
[What the user reported]

### Root Cause
[One sentence: what was wrong and why]

### Fix Applied
[What was changed, with file paths and line numbers]

### Verification
[How we confirmed it's fixed]

### Prevention
[How to prevent this class of bug in the future — test to add, pattern to avoid, etc.]
```

## Gotchas

- **Don't guess. Verify.** Read the actual code before theorizing. The bug is in the code, not in your mental model.
- **Check git diff before assuming code is correct.** Other agents or the user may have changed files since you last looked.
- **TypeScript errors cascade.** One real error can cause 50 reported errors. Find and fix the FIRST error.
- **WebSocket issues won't show in curl.** Use the desktop app or a WS client to test WebSocket endpoints.
- **Memory/context issues are invisible.** If an agent's response is wrong, check what context was loaded into its system prompt via `loadMemoryContext()`.

## Memory

Store under `debug.<issue-slug>`:
- **L0**: "Fixed: [one-line description of the bug and fix]"
- **L1**: Root cause, fix applied, files changed
- **L2**: Full investigation trail, all commands run, outputs captured
