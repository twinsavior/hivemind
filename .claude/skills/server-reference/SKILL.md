---
name: server-reference
description: Dashboard server architecture -- task orchestration, WebSocket protocol, delegation flow, streaming, security, config API. Auto-loads when working on src/dashboard/ code.
user-invocable: false
---

# Dashboard Server (`src/dashboard/server.ts`)

The hub for all agent orchestration. Express + WebSocket server on configurable port (default 4000 via `HIVEMIND_DASHBOARD_PORT`).

## Two Execution Paths

### 1. `coordinateRequest()` — Nova's orchestration flow
- User sends `task:submit` → Nova receives full prompt (system + CLAUDE.md + memory + conversation history + user message)
- Nova streams response via `completeStreaming()` on Claude Code provider
- If Nova delegates (JSON block with `delegations[]`), each sub-agent runs via `handleStreamingTask()`
- Sub-task tokens forward to parent task via `parentTaskId` parameter
- After all agents finish, Nova synthesizes results in a second streaming turn
- Follow-ups checked after each streaming turn via `taskFollowups` map

### 2. `handleStreamingTask()` — Direct agent tasks
- Used for delegated sub-tasks AND direct agent selection from UI
- Resolves provider (Claude Code or Codex) based on `agentId`
- Streams tokens back to WebSocket with `task:token` messages
- Supports `parentTaskId` to forward tokens to a parent task's stream
- Dashboard tasks always pass `trustLevel: TrustLevel.OWNER` to the provider

## WebSocket Protocol

### Client → Server
- `task:submit` — New task (description, agentId?, conversationId, history?)
- `task:followup` — Mid-task message (taskId, text, attachments?)
- `task:cancel` — Cancel running task
- `task:answer` — Answer to an interactive question (taskId, answer)

### Server → Client
- `task:token` — Streaming token (`{ taskId, text, tokenType: 'text'|'action'|'done'|'status', agentId? }`)
- `task:complete` — Task finished (`{ taskId, result }`)
- `task:error` — Task failed
- `task:question` — Interactive question for the user (`{ taskId, header, question, options }`)
- `swarm:metrics` — Periodic metrics broadcast
- `swarm:graph` — Swarm graph state for visualization
- `context:usage` — Context window usage percentage per agent

## Security

### Authentication
- `DASHBOARD_PASSWORD` env var enables password auth (Bearer token or `?token=` query param)
- When unset: HTTP and WS both restricted to localhost only via `isLocalhostRequest()`
- `verifyWsClient()` validates Origin header against localhost variants (blocks cross-origin browser attacks)
- `classifyWsConnection(req)` checks actual request locality, not just "assume authenticated"

### Trust Classification
- `classifyHttpRequest(req)` → `TaskSource` with `authenticated` flag based on password or localhost
- `classifyWsConnection(req)` → Same logic for WebSocket connections
- `submitConnectorTask()` → Passes explicit restricted permissions and trust level to provider
- UNTRUSTED sources get `trustLevel` propagated to `buildArgs()` which omits `--dangerously-skip-permissions`

### OAuth
- **Gmail:** Cryptographic state nonce via `verifyOAuthState()`, redirect URI from config only
- **eBay:** Server-side `ebayOAuthStates` map with 10-min TTL, verified before code exchange

## Config API
- `GET /api/config` — Reads `hivemind.yaml` from the resolved `--config` path (set via `setConfigPath()`)
- `POST /api/config` — Merges UI sections into existing YAML and writes back
- Uses top-level ESM `import { parse, stringify } from 'yaml'` (not `require()`)
- Falls back to `activeWorkDir/hivemind.yaml` if `setConfigPath()` was not called

## Route Ordering
- `/health` — No auth, before middleware (for Docker healthchecks / load balancers)
- `/api/*` — Behind `requireAuth` middleware
- SPA catch-all `app.get('*')` — Skips `/api/` and `/ws` paths via `next()`, so later API routes work

## Memory Integration
- `loadMemoryContext(query)` — Loads L0 summaries + semantic search results before each task
- `saveTaskMemory(description, agentId, content, conversationId)` — Saves L0 summary + L1 overview after task completes
- Both are non-blocking (fire-and-forget on save, awaited on load)

## Follow-up Handling
- Follow-ups stored in `taskFollowups` Map (keyed by taskId)
- After each streaming turn completes, pending follow-ups are sent as a new user turn in the same session
- If a question is pending (`taskQuestionResolvers`), followup text resolves it
- Otherwise, the active Nova stream is aborted and restarted with the followup

## Gotchas
1. **Nova does NOT use BaseAgent.execute().** It runs via subprocess (`completeStreaming`). The cognitive loop (think→act→observe→report) is only for LLMAgent-based tasks.
2. **SPA catch-all must skip /api/ paths.** If it doesn't, later-registered API routes (like `/api/connectors`) get served `index.html` instead.
3. **Config API uses `_resolvedConfigPath`, not `activeWorkDir`.** The CLI sets this via `setConfigPath(configPath)` at startup so `/api/config` writes to the correct file regardless of cwd.
4. **`PORT` constant is used for self-referencing fetches.** Internal fetch calls (finance summary, pipeline summary) use `PORT`, not a hardcoded 4000 or `__hivemindPort`.
