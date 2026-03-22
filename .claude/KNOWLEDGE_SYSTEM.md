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

**Rule:** If a gotcha only bites you when editing files in one subsystem, it goes here.

### MEMORY.md (Cross-Session Learnings)
**Location:** `.claude/memory/MEMORY.md`
**Loaded:** Every conversation.
**Contains:**
- External API/CLI quirks learned by doing (Codex CLI flags, Claude Code session behavior)
- Patterns that work across projects
- User preferences and decisions already made

**Rule:** If you'd want to know this in a different project using the same tool/API, it goes here.

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
+-- External API/CLI quirk (not project-specific)?
|   YES -> MEMORY.md
|
+-- One-time bug fix?
    YES -> Probably doesn't need documenting.
        Exception: If the bug WILL recur, add it above.
```

## Maintenance

- **After major features:** Create or update the relevant reference skill
- **After recurring bugs:** Add gotcha per the decision tree
- **Periodically:** Review CLAUDE.md for items that became subsystem-specific (move to reference)
- **Always:** Self-prune contradictions when updating any file
