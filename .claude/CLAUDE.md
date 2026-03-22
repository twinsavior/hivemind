# HIVEMIND Development Guide

> Subsystem docs auto-load from `.claude/skills/*-reference/` when relevant.
> See `.claude/KNOWLEDGE_SYSTEM.md` for where to add new knowledge.

## What This Project Is
HIVEMIND is an open-source autonomous agent swarm platform. Deploys specialized AI agents (Scout, Builder, Sentinel, Oracle, Courier) coordinated by Nova, collaborating via a desktop Electron app. TypeScript strict mode, ES2022.

## Architecture
- `src/core/` — LLM adapter, providers (Claude Code, Codex, OpenAI, Anthropic, Ollama), trust system
- `src/agents/` — BaseAgent (cognitive loop) + LLMAgent + 5 specialized agents
- `src/memory/` — SQLite store with L0/L1/L2 hierarchy, ContextManager
- `src/dashboard/` — Express + WebSocket server, task orchestration hub
- `src/cli/` — CLI entry point, agent init, system prompts
- `desktop/` — Electron app, chat UI (vanilla HTML/JS, no framework)
- `skills/` — Built-in skills (folders with YAML frontmatter). See `skills/SKILL_DESIGN_GUIDE.md` for design principles

## Conventions
- Async/await for all I/O
- EventEmitter for inter-agent communication
- Interfaces over abstract classes
- Config: CLI args > env vars > hivemind.yaml > defaults

## Cross-Cutting Gotchas
1. **Codex uses `--full-auto` not `--approval-mode`.** Wrong: `args.push('--approval-mode')`. Right: `args.push('--full-auto')`. The wrong flag silently fails every Codex call.
2. **Nova runs via subprocess, not the cognitive loop.** Wrong: assume `BaseAgent.execute()` handles Nova. Right: `coordinateRequest` → `completeStreaming` directly. Follow-ups go through `taskFollowups` map, not inbox.
3. **Desktop renderer is one vanilla JS file (~3700 lines).** Wrong: rewrite large sections. Right: Edit tool for surgical changes only.
4. **Memory context is injected into system prompts** via `loadMemoryContext()`. Agents don't remember prior tasks — check what's in memory.
5. **Conversation history is truncated.** Last 20 messages, 6000 chars each. Don't assume full context. History fields use `m.type` (not `m.role`) and `m.content` (not `m.text`). Action plans from Nova's responses are auto-persisted in `pendingActionPlans` and injected when users send execution follow-ups.
6. **Skills are folders, not just markdown.** Wrong: one big SKILL.md with everything. Right: SKILL.md + references/, examples/, scripts/ for progressive disclosure. See `skills/SKILL_DESIGN_GUIDE.md`.

## Key Commands
- `pnpm dev` — Start development mode
- `pnpm build` / `npx tsc` — Build
- `pnpm test` — Run tests (Vitest)
- `npx tsc --noEmit` — Type-check only
