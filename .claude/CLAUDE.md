# HIVEMIND Development Guide

> Subsystem docs auto-load from `.claude/skills/*-reference/` when relevant.
> See `.claude/KNOWLEDGE_SYSTEM.md` for where to add new knowledge.

## What This Project Is
HIVEMIND is an open-source autonomous agent swarm platform for the Buy Box / FlipAlert Amazon reseller community. Deploys specialized AI agents (Scout, Builder, Sentinel, Oracle, Courier) coordinated by Nova, collaborating via a desktop Electron app. Includes an integrated email parsing module for purchase tracking, shipment monitoring, and Amazon seller alert detection. TypeScript strict mode, ES2022.

## Architecture
- `src/core/` — LLM adapter, providers (Claude Code, Codex, OpenAI, Anthropic, Ollama), trust system
- `src/agents/` — BaseAgent (cognitive loop) + LLMAgent + 5 specialized agents
- `src/memory/` — SQLite store with L0/L1/L2 hierarchy, ContextManager
- `src/dashboard/` — Express + WebSocket server, task orchestration hub
- `src/cli/` — CLI entry point, agent init, system prompts
- `src/modules/email/` — Email parsing module (see below)
- `desktop/` — Electron app, chat UI (vanilla HTML/JS, no framework)
- `skills/` — Built-in skills (folders with YAML frontmatter). See `skills/SKILL_DESIGN_GUIDE.md` for design principles

## Email Module (`src/modules/email/`)
Extracted from the standalone Email Parsing app. Pure Node.js, zero Next.js dependency.
- **Own tsconfig:** `tsconfig.email.json` (looser strict settings). Excluded from main `tsconfig.json`.
- **Own SQLite DB:** `data/email.db` (separate from Hivemind's memory DB). Initialized via `initEmailModule(dataDir)`.
- **Loaded via `require()`** in `src/cli/commands.ts` to avoid main tsconfig type-checking it.
- **Key files:** `pipeline.ts` (orchestration), `flag-engine.ts` (email matching), `retailer-templates.ts` (15 retailers), `scheduler.ts` (background polling), `routes.ts` (Express router), `db.ts` (SQLite CRUD)
- **API routes** mounted at `/api/email/*` on the dashboard Express server (in `server.ts`)
- **Event bus:** `emailBus` emits `email:purchase`, `email:seller-alert`, `email:pipeline-complete`. Forwarded to dashboard WebSocket bus in `commands.ts`.
- **UI:** 4 views in the Electron renderer (Operations Dashboard, Purchases, Shipments, Alerts) + 2 onboarding steps (Email Setup, Retailer Selection)
- **Tests:** 170 flag engine tests in `tests/modules/email/flag-engine.test.ts`

## Conventions
- Async/await for all I/O
- EventEmitter for inter-agent communication
- Interfaces over abstract classes
- Config: CLI args > env vars > hivemind.yaml > defaults

## Cross-Cutting Gotchas
1. **Codex uses `--full-auto` not `--approval-mode`.** Wrong: `args.push('--approval-mode')`. Right: `args.push('--full-auto')`. The wrong flag silently fails every Codex call.
2. **Nova runs via subprocess, not the cognitive loop.** Wrong: assume `BaseAgent.execute()` handles Nova. Right: `coordinateRequest` → `completeStreaming` directly. Follow-ups go through `taskFollowups` map, not inbox.
3. **Desktop renderer is one vanilla JS file (~5000 lines).** Wrong: rewrite large sections. Right: Edit tool for surgical changes only.
4. **Memory context is injected into system prompts** via `loadMemoryContext()`. Agents don't remember prior tasks — check what's in memory.
5. **Conversation history is truncated.** Last 20 messages, 6000 chars each. Don't assume full context. History fields use `m.type` (not `m.role`) and `m.content` (not `m.text`). Action plans from Nova's responses are auto-persisted in `pendingActionPlans` and injected when users send execution follow-ups.
6. **Skills are folders, not just markdown.** Wrong: one big SKILL.md with everything. Right: SKILL.md + references/, examples/, scripts/ for progressive disclosure. See `skills/SKILL_DESIGN_GUIDE.md`.
7. **Email module has its own tsconfig.** Wrong: add email module files to main `tsconfig.json`. Right: use `tsconfig.email.json` and `require()` (not `import()`) from main code to avoid strict type-checking the email module.
8. **Email module DB path must be configured.** Wrong: assume `process.cwd()`. Right: call `initEmailModule(dataDir)` before any email functions. The DB and encryption key are stored in the configured `dataDir`.

## Key Commands
- `pnpm dev` — Start development mode
- `pnpm build` / `npx tsc` — Build
- `pnpm test` — Run tests (Vitest, 489 tests across 9 files)
- `npx tsc --noEmit` — Type-check main project
- `npx tsc -p tsconfig.email.json --noEmit` — Type-check email module
