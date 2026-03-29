---
name: git-workflow
description: Git branch/PR workflow, save checklist, session continuity, and documentation rules. Auto-loads on every conversation -- governs how all work is committed, documented, and handed off between sessions.
user-invocable: false
---

# Git & Branch Workflow

**Never commit directly to main.** All work happens on feature branches. **Git is invisible to the user** -- never mention branches, PRs, commits, or git operations unless asked.

**The user's workflow is: request -> see it live -> approve or iterate.**

## Single Feature

1. Create a branch silently: `git checkout -b descriptive-branch-name`
2. Make changes, commit as you go -- all automatic, never ask
3. Build, verify, and **deploy to prod** so the user can see it live
4. Tell the user it's deployed and ready to test -- describe what to look for, not what code changed
5. **User approves** ("looks good", "ship it") -> run the Save Checklist
6. **User wants changes** -> iterate on the same branch, redeploy after each round

## Parallel Work (Multiple Agents)

1. Each agent works on its own branch silently
2. After all agents finish, run `/simplify` across changed files to clean up
3. Deploy each completed feature for the user to test
4. As the user approves each feature, merge its branch into main sequentially
5. After each merge, rebase remaining branches onto updated main
6. Merge conflicts: resolve silently, preserving both sides' intent
7. If genuinely ambiguous, explain the tradeoff and ask

## Verification (Every Deploy)

1. Build step (frontend compile, backend syntax check)
2. Deploy
3. Check logs for startup errors
4. Only say "ready to test" when deploy is healthy

## Rollback

If a deploy breaks, immediately switch to main, rebuild, redeploy. Then fix the issue on the branch and try again.

---

## Save Checklist

**When the user approves work, complete ALL 4 steps IN ORDER before responding. Do NOT say "Saved" until every step is done.**

- [ ] **MERGE** -- Merge branch to main, push, delete the branch
- [ ] **DOCS** -- Update documentation per `.claude/KNOWLEDGE_SYSTEM.md`:
  - CLAUDE.md: Cross-cutting gotchas only
  - Reference skills: Subsystem-specific details
  - MEMORY.md: External API quirks
  - Self-prune contradictions
- [ ] **SESSION** -- Clear `SESSION_STATE.md` to `# No active work` (or update if other tasks remain)
- [ ] **CONFIRM** -- Reply "Saved."

**If you say "Saved" without completing steps 1-3, you have made an error.**

---

## Session Continuity

**File:** `SESSION_STATE.md` (project root)

**On conversation start:**
- Read `SESSION_STATE.md`
- Verify against `git log --oneline -5` and `git branch` before trusting
- If the branch was already merged, the state is stale -- clear and start fresh

**During work:**
- Overwrite `SESSION_STATE.md` frequently -- every milestone, every status change
- It's a snapshot of RIGHT NOW, not a log. Include:
  - Each active task: plain English description, status, branch name
  - Completed tasks from this session (so we don't redo them)
  - Decisions the user already made (so we don't re-ask)

**Task statuses:** `building` | `deployed` | `needs-changes` | `approved` | `blocked`

**On all work done:** Clear to `# No active work`
