# Knowledge System Guide

How HIVEMIND project knowledge is organized. Follow this when adding new learnings, gotchas, or documentation.

## File Hierarchy

### CLAUDE.md (Always Loaded)
**Location:** `.claude/CLAUDE.md`
**Loaded:** Every conversation. Counts against context window.
**Contains:**
- Project identity and architecture overview
- Cross-cutting gotchas (things that have actually caused bugs)
- Key commands
- Provider architecture (affects ALL agent code)

**Rule:** If ignoring this would cause a bug in ANY part of the codebase, it goes here. If it only matters for one subsystem, it goes in a reference skill.

**Budget:** Keep under ~80 lines. Every line costs tokens on every conversation.

### Reference Skills (On-Demand)
**Location:** `.claude/skills/<name>-reference/SKILL.md`
**Loaded:** Auto-loaded when working on that subsystem's code. NOT loaded otherwise.
**Contains:**
- Detailed architecture for one subsystem
- Subsystem-specific gotchas
- Data structures, event formats, message types

**Current reference skills:**
- `server-reference` — Dashboard server, task orchestration, WebSocket protocol
- `desktop-reference` — Electron app, renderer, chat UI specifics
- `agents-reference` — Agent types, prompts, cognitive loop, provider wiring
- `memory-reference` — SQLite store, L0/L1/L2 hierarchy, ContextManager

**Current reference skills:**
- `server-reference` — Dashboard server, task orchestration, WebSocket protocol, security, config API
- `desktop-reference` — Electron app, renderer, chat UI, async startup
- `agents-reference` — Agent types, prompts, cognitive loop, provider wiring
- `memory-reference` — SQLite store, L0/L1/L2 hierarchy, ContextManager

**Rule:** If a gotcha only bites you when editing files in one subsystem, it goes here.

### Action Skills (Workflow Automation)
**Location:** `.claude/skills/<name>/SKILL.md`
**Loaded:** Auto-triggered by keywords, or manually via `/skill-name`.
**Contains:**
- Step-by-step operational procedures (deploy, check logs, inspect data, release)
- Parameterized workflows with `$ARGUMENTS`

**Current action skills:**
- `release` — Full release pipeline (typecheck, test, build, bump, tag, CI)
- `deploy` — Deploy via GitHub Releases
- `server-logs` — Check local server health
- `inspect-data` — Query SQLite databases
- `scan-secrets` — Gitleaks scan for exposed credentials
- `simplify` — Code review after batch work
- `git-workflow` — Branch/PR workflow, save checklist, session continuity
- `project-setup` — First-run interview and configuration

**Rule:** If you find yourself doing the same sequence more than twice, make it a skill.

### MEMORY.md (Cross-Session Learnings)
**Location:** `.claude/memory/MEMORY.md`
**Loaded:** Every conversation.
**Contains:**
- External API/CLI quirks learned by doing (Codex CLI flags, Claude Code session behavior)
- Patterns that work across projects
- User preferences and decisions already made

**Rule:** If you'd want to know this in a different project using the same tool/API, it goes here.

### SESSION_STATE.md (Session Continuity)
**Location:** Project root (gitignored)
**Contains:** Snapshot of current work — active tasks, branches, decisions made.
**Rule:** Overwrite frequently during work. Clear to `# No active work` when done.

## Decision Tree

```
New learning / gotcha / bug fix
|
+-- Affects ALL code in the project?
|   YES -> CLAUDE.md (cross-cutting gotchas)
|
+-- Affects only ONE subsystem?
|   YES -> That subsystem's *-reference skill
|
+-- Repeatable workflow/procedure?
|   YES -> Action skill (.claude/skills/<name>/SKILL.md)
|
+-- External API quirk (not project-specific)?
|   YES -> MEMORY.md
|
+-- One-time bug fix?
    YES -> Probably doesn't need documenting.
        Exception: If the bug WILL recur, add it above.
```

## Creating a New Reference Skill

```yaml
---
name: <name>-reference
description: Detailed <subsystem> documentation -- <topics>. Auto-loads when working on <subsystem> code.
user-invocable: false
---
```

## Creating a New Action Skill

```yaml
---
name: <name>
description: <What it does. Include trigger words Claude should match on.>
allowed-tools: Bash
argument-hint: <argument description>
---
```

## Maintenance

- **After major features:** Create or update the relevant reference skill
- **After recurring bugs:** Add gotcha per the decision tree
- **After every git push:** Update CLAUDE.md, reference skills, and KNOWLEDGE_SYSTEM.md if the push changed architecture, commands, or conventions
- **Periodically:** Review CLAUDE.md for items that became subsystem-specific (move to reference)
- **Always:** Self-prune contradictions when updating any file
