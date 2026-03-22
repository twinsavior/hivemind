---
name: memory-reference
description: Memory system -- SQLite store, L0/L1/L2 hierarchy, ContextManager, token budgets. Auto-loads when working on src/memory/ code.
user-invocable: false
---

# Memory System (`src/memory/`)

## Architecture

### Three-Level Hierarchy
- **L0 (Summary)** — Short summaries (~200 chars). Always loaded. 20% of token budget.
- **L1 (Overview)** — Detailed overviews (~1500 chars). Loaded on demand. 35% of budget.
- **L2 (Detail)** — Full content. Loaded selectively. 45% of budget.

### Storage (`src/memory/store.ts`)
- SQLite database at `data/hivemind.db`
- Table: `memories` with columns: id, namespace, title, content, level, tokenCount, parentId, tags, createdAt, updatedAt
- Namespace convention: `conv:${conversationId}` for conversation-scoped, `project` for global
- Parent-child relationships: L0 entry → L1 children → L2 children

### Context Manager (`src/memory/context.ts`)
- `load(request)` — Phase 1: L0 summaries for namespaces, Phase 2: expand to L1/L2
- `drill(entryId, targetLevel)` — Expand a loaded entry to deeper level
- `evict(targetFreeTokens)` — Frees tokens by evicting L2 first, then L1. Never auto-evicts L0.
- `loadRelevant(query)` — Semantic/keyword search, respects budget
- `renderContext()` — Builds `<memory>` XML block grouped by namespace, sorted by level

### Token Budget
- Default: 8192 tokens total
- Levels can borrow from lower-priority (higher-level) unused allocations
- Budget tracked per-level: `l0`, `l1`, `l2` with `used` and `remaining`

## Integration Points

### Saving (in `server.ts`)
```typescript
saveTaskMemory(taskDescription, agentId, content, conversationId)
```
- Creates L0 summary (first 200 chars) + L1 overview (first 1500 chars)
- Namespaced to conversation
- Called after task completion (non-blocking)

### Loading (in `server.ts`)
```typescript
loadMemoryContext(taskDescription)
```
- Loads L0 summaries from all namespaces
- Runs keyword search against the task description
- Returns rendered `<memory>` block for system prompt injection

## Current Limitations
- **No semantic/vector search** — `search()` with `semantic: true` falls back to keyword matching
- **No embedding provider wired** — `@xenova/transformers` planned but not installed
- **Memory page in UI** shows raw entries — no summarization or smart display yet

## Gotchas
1. **ContextManager was disconnected until recently.** If you see old code paths that don't use it, they're legacy — the correct path goes through `loadMemoryContext()` and `saveTaskMemory()` in `server.ts`.
2. **Token counts are estimated** (content.length / 4). Not accurate for non-English or code-heavy content.
3. **SQLite is synchronous** in the store — `listByNamespace`, `getChildren`, `read` are all sync. Only `search` is async (for future vector search).
