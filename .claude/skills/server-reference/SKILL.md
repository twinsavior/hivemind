---
name: server-reference
description: Dashboard server architecture -- task orchestration, WebSocket protocol, delegation flow, streaming. Auto-loads when working on src/dashboard/ code.
user-invocable: false
---

# Dashboard Server (`src/dashboard/server.ts`)

The hub for all agent orchestration. Express + WebSocket server on port 4000.

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

## WebSocket Message Types

### Client → Server
- `task:submit` — New task (description, agentId?, conversationId, history?)
- `task:followup` — Mid-task message (taskId, text, attachments?)
- `task:cancel` — Cancel running task

### Server → Client
- `task:token` — Streaming token (`{ taskId, text, tokenType: 'text'|'action'|'done'|'status', agentId? }`)
- `task:complete` — Task finished (`{ taskId, result }`)
- `task:error` — Task failed

## Memory Integration
- `loadMemoryContext(query)` — Loads L0 summaries + semantic search results before each task
- `saveTaskMemory(description, agentId, content, conversationId)` — Saves L0 summary + L1 overview after task completes
- Both are non-blocking (fire-and-forget on save, awaited on load)

## CLAUDE.md Injection
- Reads from `CLAUDE.md` and `.claude/CLAUDE.md` in the work directory
- Injected into Nova's system prompt, capped at 3000 chars
- Happens once per `coordinateRequest()` call

## Follow-up Handling
- Follow-ups stored in `taskFollowups` Map (keyed by taskId)
- After each streaming turn completes, pending follow-ups are sent as a new user turn in the same session
- Nova acknowledges follow-ups immediately in the chat stream (cosmetic)
- Attachments sent as `[Attached image: /path]` references with Read tool instructions

## Gotchas
1. **Nova does NOT use BaseAgent.execute().** It runs via subprocess (`completeStreaming`). The cognitive loop (think→act→observe→report) is only for LLMAgent-based tasks.
2. **Sub-task IDs are invisible to the frontend.** Always pass `parentTaskId` so tokens show up in the main chat stream.
3. **Provider fallback chain:** `claude-code` → `codex` → `anthropic` → `openai` → `ollama`. If Claude Code isn't found, Codex becomes primary.
