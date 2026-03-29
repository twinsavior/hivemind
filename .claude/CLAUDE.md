# HIVEMIND Development Guide

> Subsystem docs auto-load from `.claude/skills/*-reference/` when relevant.
> See `.claude/KNOWLEDGE_SYSTEM.md` for where to add new knowledge.

## What This Project Is
HIVEMIND is an open-source autonomous agent swarm platform for the Buy Box / FlipAlert Amazon reseller community. Deploys specialized AI agents (Scout, Builder, Sentinel, Oracle, Courier) coordinated by Nova, collaborating via a desktop Electron app. Includes an integrated email parsing module for purchase tracking, shipment monitoring, and Amazon seller alert detection. TypeScript strict mode, ES2022.

## Architecture
- `src/core/` — LLM adapter, providers (Claude Code, Codex, OpenAI, Anthropic, Ollama), trust system, filesystem sandboxing
- `src/agents/` — BaseAgent (cognitive loop) + LLMAgent + 5 specialized agents
- `src/memory/` — SQLite store with L0/L1/L2 hierarchy, ContextManager
- `src/dashboard/` — Express + WebSocket server, task orchestration hub, config persistence
- `src/cli/` — CLI entry point, agent init, system prompts
- `src/modules/email/` — Email parsing module (see below)
- `src/modules/discord/` — Discord setup wizard API routes + config writer
- `src/connectors/` — Platform connectors (Discord, Slack, Telegram, Webhook) + ConnectorManager
- `desktop/` — Electron app, chat UI (vanilla HTML/JS, no framework)
- `skills/` — Built-in skills (folders with YAML frontmatter). See `skills/SKILL_DESIGN_GUIDE.md` for design principles

## Email Module (`src/modules/email/`)
Extracted from the standalone Email Parsing app. Pure Node.js, zero Next.js dependency.
- **Own tsconfig:** `tsconfig.email.json` (looser strict settings). Excluded from main `tsconfig.json`.
- **Own SQLite DB:** `data/email.db` (separate from Hivemind's memory DB). Initialized via `initEmailModule(dataDir)`.
- **Loaded via `createRequire()`** in `src/cli/commands.ts` to bridge ESM→CJS and avoid main tsconfig type-checking it.
- **Build:** Included in the `pnpm build` script (`tsc && tsc -p tsconfig.email.json`). Output: `dist/modules/email/`.
- **Key files:** `pipeline.ts` (orchestration), `flag-engine.ts` (email matching), `retailer-templates.ts` (15 retailers), `scheduler.ts` (background polling), `routes.ts` (Express router), `db.ts` (SQLite CRUD)
- **API routes** lazy-loaded at `/api/email/*` on the dashboard Express server (in `server.ts`)
- **Event bus:** `emailBus` emits `email:purchase`, `email:seller-alert`, `email:pipeline-complete`. Forwarded to dashboard WebSocket bus in `commands.ts`.
- **Tests:** 170 flag engine tests in `tests/modules/email/flag-engine.test.ts`

## Security Model
- **Trust levels:** OWNER (CLI, authenticated dashboard), TRUSTED (allow-listed users), UNTRUSTED (connectors, unauthenticated)
- **Claude Code permissions:** `--dangerously-skip-permissions` only for OWNER/TRUSTED. UNTRUSTED gets read-only `--allowedTools` (Read, Glob, Grep).
- **WebSocket auth:** When `DASHBOARD_PASSWORD` is unset, only localhost connections accepted. Origin header validated against localhost variants.
- **OAuth:** Gmail and eBay use cryptographic state nonces verified server-side. Gmail redirect URI derived from config only, never from Host header.
- **Filesystem sandboxing:** `resolveAndValidatePath()` in `tool-executor.ts` blocks `../` traversal in all path-accepting tool handlers.
- **Config API:** `GET/POST /api/config` reads/writes the resolved `--config` path (set via `setConfigPath()` from CLI).

## Conventions
- Async/await for all I/O
- EventEmitter for inter-agent communication
- Interfaces over abstract classes
- Config: CLI args > env vars > hivemind.yaml > defaults
- ESM throughout — use `createRequire(import.meta.url)` when CJS `require()` is needed

## Cross-Cutting Gotchas
1. **Codex uses `--full-auto` not `--approval-mode`.** Wrong: `args.push('--approval-mode')`. Right: `args.push('--full-auto')`. The wrong flag silently fails every Codex call.
2. **Nova runs via subprocess, not the cognitive loop.** Wrong: assume `BaseAgent.execute()` handles Nova. Right: `coordinateRequest` → `completeStreaming` directly. Follow-ups go through `taskFollowups` map, not inbox.
3. **Desktop renderer is one vanilla JS file (~5000 lines).** Wrong: rewrite large sections. Right: Edit tool for surgical changes only.
4. **Memory context is injected into system prompts** via `loadMemoryContext()`. Agents don't remember prior tasks — check what's in memory.
5. **Conversation history is truncated.** Last 20 messages, 6000 chars each. Don't assume full context. History fields use `m.type` (not `m.role`) and `m.content` (not `m.text`). Action plans from Nova's responses are auto-persisted in `pendingActionPlans` and injected when users send execution follow-ups.
6. **Skills are folders, not just markdown.** Wrong: one big SKILL.md with everything. Right: SKILL.md + references/, examples/, scripts/ for progressive disclosure. See `skills/SKILL_DESIGN_GUIDE.md`.
7. **Email module has its own tsconfig.** Wrong: add email module files to main `tsconfig.json`. Right: use `tsconfig.email.json` and `createRequire()` from main code to avoid strict type-checking the email module.
8. **Email module DB path must be configured.** Wrong: assume `process.cwd()`. Right: call `initEmailModule(dataDir)` before any email functions. The DB and encryption key are stored in the configured `dataDir`.
9. **Connectors are initialized from `hivemind.yaml`.** The `connectors` array in YAML is parsed at startup, env vars resolved (`$DISCORD_BOT_TOKEN`), and ConnectorManager handles lifecycle. Discord setup wizard in Settings > Connectors auto-writes to `.env` and `hivemind.yaml`.
10. **Trust enforcement for connector tasks.** UNTRUSTED connector sources get restricted tool permissions (`--allowedTools` with read-only list), restricted context (no seller data, no memory, no metrics), and a trust boundary in the system prompt. Owner IDs in `security.ownerIds` must be valid 17-20 digit Discord snowflakes.
11. **Port is configurable via `HIVEMIND_DASHBOARD_PORT`.** CLI, server, desktop main.js, and renderer all read this env var. Default: 4000. Never hardcode port values.
12. **SPA catch-all skips `/api/*` paths.** The `app.get('*')` fallback in server.ts passes through to `next()` for `/api/` and `/ws` paths so later-registered API routes still work.

## Desktop App (`desktop/`)
- **Electron 35** with electron-builder 26 for cross-platform builds
- `main.js` detects `app.isPackaged` — packaged mode runs compiled JS from `process.resourcesPath/server/`, dev mode runs tsx on TypeScript source
- `main.js` is fully async — `findNode()`, `setupPackagedEnvironment()`, `showErrorDialog()` all use `fs.promises` and async APIs
- Port passed to renderer via `loadFile` query param (`?port=...`), renderer reads with `URLSearchParams`
- Platform-aware: uses `/usr/bin/arch -arm64` on macOS, direct `node` on Windows
- Build: `pnpm build` (server + email) → `cd desktop && npm run build:mac` (or `build:win`)
- Output: `desktop/dist-electron/` (gitignored)
- Release: `/release` skill or `v*` tag push → `.github/workflows/release.yml` → builds mac + win → GitHub Releases → auto-update

## Key Commands
- `pnpm dev` — Start development mode
- `pnpm build` — Build (main + email module)
- `pnpm test` — Run tests (Vitest, 550 tests across 13 files)
- `pnpm typecheck` — Type-check main project
- `npx tsc -p tsconfig.email.json --noEmit` — Type-check email module
- `cd desktop && npm run build:mac` — Build macOS .dmg
- `cd desktop && npm run build:win` — Build Windows .exe
- `/release` — Full release pipeline (see `.claude/skills/release/SKILL.md`)
