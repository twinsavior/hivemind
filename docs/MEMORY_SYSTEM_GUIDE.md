# How the Hivemind Memory System Works

A plain-English guide to the three-tier memory system that lets AI agents remember things between conversations without blowing up their context window.

---

## The Problem This Solves

LLMs have a limited context window. If you dump every past conversation, task result, and piece of knowledge into the prompt, you run out of space fast. But if you don't give the agent any history, it forgets everything and repeats mistakes.

Hivemind solves this with **progressive memory loading** -- a three-tier system where short summaries are always available, and full details are only loaded when needed.

---

## The Three Tiers

Think of it like Google search results:

| Level | Name | What It Holds | Size | When It's Loaded |
|-------|------|---------------|------|------------------|
| **L0** | Summary | A compressed one-liner (~200 chars) | Tiny | **Always** -- loaded into every prompt |
| **L1** | Overview | A paragraph of context (~1500 chars) | Medium | **On demand** -- when the agent needs more detail |
| **L2** | Full Content | The complete raw data | Large | **Selectively** -- only when drilling deep |

**Example:** An agent completes a task "Fix the login bug."

- **L0 (Summary):** `"Fixed login bug -- session cookie was missing SameSite attribute, causing auth failures on Chrome."`
- **L1 (Overview):** A paragraph explaining what files were changed, what the root cause was, and what was tested.
- **L2 (Full Content):** The complete task output, diffs, logs, everything.

Next time any agent works on auth, L0 is already in context. If it needs more, it "drills" into L1. If it needs the raw diff, it loads L2.

---

## How It's Stored

Everything lives in a single **SQLite database** with one table:

```sql
CREATE TABLE memories (
  id          TEXT PRIMARY KEY,     -- UUID
  namespace   TEXT NOT NULL,        -- Organizes memories (e.g., "tasks", "project")
  title       TEXT NOT NULL,        -- Human-readable label
  content     TEXT NOT NULL,        -- The actual memory content
  level       INTEGER NOT NULL,     -- 0, 1, or 2
  parent_id   TEXT,                 -- Links tiers together (L1 points to L0, L2 points to L1)
  embedding   BLOB,                -- Vector for semantic search (optional)
  metadata    TEXT DEFAULT '{}',    -- JSON blob for anything extra
  created_at  TEXT NOT NULL,        -- ISO timestamp
  updated_at  TEXT NOT NULL,        -- ISO timestamp
  token_count INTEGER DEFAULT 0,   -- Estimated tokens (see "Token Estimation" below)
  source      TEXT DEFAULT 'system' -- Who created it (agent ID, skill name, etc.)
);
```

**Key indexes** for fast lookups:
- `namespace` -- find all memories in a category
- `level` -- filter by tier
- `parent_id` -- navigate the hierarchy
- `source` -- find what a specific agent wrote

The `parent_id` column is what connects the tiers. An L1 entry's `parent_id` points to its L0 summary. An L2 entry's `parent_id` points to its L1 overview. This lets you "drill down" from summary to full content.

**Delete cascades recursively.** When you delete an L0 entry, the system uses a recursive CTE to find and delete all descendants -- L1 children, L2 grandchildren, and anything deeper. No orphans.

```sql
-- The actual delete query:
WITH RECURSIVE descendants(id) AS (
  SELECT id FROM memories WHERE parent_id = :id
  UNION ALL
  SELECT m.id FROM memories m JOIN descendants d ON m.parent_id = d.id
)
DELETE FROM memories WHERE id IN (SELECT id FROM descendants);
DELETE FROM memories WHERE id = :id;
```

### Vector Search Indexing

When embeddings are enabled, each memory's vector is stored in a separate virtual table (`memory_vss`) using SQLite's internal integer `rowid` as the join key -- not the UUID `id` column. This is important because `sqlite-vss` requires integer rowids for its index.

```typescript
// After inserting the memory, get its integer rowid for the VSS table
const row = db.prepare("SELECT rowid FROM memories WHERE id = ?").get(id);
db.prepare("INSERT INTO memory_vss (rowid, embedding) VALUES (?, ?)").run(row.rowid, embedding);

// Searches join on the integer rowid, not the UUID
"JOIN memories m ON m.rowid = v.rowid"
```

---

## How Memories Are Created

There are three paths, plus built-in deduplication:

### Path 1: After a Task Completes (Automatic)

When an agent finishes a task, the system automatically saves the result using `writeOrUpdate()` -- which checks for an existing memory with the same namespace, title, and level before writing. If a duplicate exists, it updates the existing entry instead of creating a new one.

```typescript
// 1. Extract a short summary from the output
const summary = firstMeaningfulSentence(output).slice(0, 200);

// 2. Extract a medium overview
const overview = output.slice(0, 1500);

// 3. Write L0 (or update if this task was already saved)
const l0Id = await memoryStore.writeOrUpdate({
  namespace: "tasks.conv-abc123",
  title: "Fix the login bug",
  content: summary,
  level: 0,                  // L0 = Summary
  source: "builder-agent-1",
  metadata: { agentName: "Builder", conversationId: "abc123" }
});

// 4. Write L1, linked to L0 (or update if exists)
await memoryStore.writeOrUpdate({
  namespace: "tasks.conv-abc123",
  title: "Fix the login bug (overview)",
  content: overview,
  level: 1,                  // L1 = Overview
  parentId: l0Id,            // <-- links to the L0 entry
  source: "builder-agent-1",
  metadata: { agentName: "Builder", conversationId: "abc123" }
});
```

**How deduplication works:** `writeOrUpdate()` calls `findDuplicate()` which checks for an existing row matching `(namespace, title, level)`. If found, it updates the content and metadata in place. If not, it creates a new entry. This prevents the same task from creating duplicate memories when re-run.

### Path 2: Agent Calls remember() (Manual)

Any agent can save a memory at any time:

```typescript
// Short-term only (in-process Map, lost on restart):
agent.remember("api-key-location", "stored in .env.local", 60000); // 60s TTL

// Persistent (also writes to SQLite, survives restarts):
agent.remember("api-key-location", "stored in .env.local"); // no TTL = persistent
```

When there's no TTL, `remember()` fires off a write to the SQLite store in the background.

### Path 3: Write All Three Tiers at Once (Convenience)

```typescript
const { l0, l1, l2 } = await memoryStore.writeHierarchy({
  namespace: "project",
  title: "Database Migration Plan",
  summary: "Migrating from Postgres 14 to 16 with zero downtime.",
  overview: "Three-phase approach: shadow writes, dual reads, cutover...",
  fullContent: "Complete migration runbook with rollback procedures...",
  source: "oracle-agent",
});
```

This creates all three tiers with parent links already wired up.

---

## How Memories Are Retrieved

### At Task Start: Search-First Context Loading

Before every task, the system loads relevant memories into the agent's prompt. The loading strategy is **search-first**: task-relevant memories get priority, then remaining budget is filled with recent summaries.

```typescript
async function loadMemoryContext(taskDescription: string): Promise<string> {
  const ctx = new ContextManager(memoryStore, 4096);

  // Step 1: Search-first — find memories relevant to THIS task.
  // These get loaded before anything else, guaranteeing relevance.
  await ctx.loadRelevant(taskDescription, { limit: 10 });

  // Step 2: Fill remaining budget with recent L0 summaries (max 50).
  // This provides broad context without swamping the budget.
  const recentSummaries = memoryStore.listByNamespace("tasks", Level.L0).slice(0, 50);
  for (const entry of recentSummaries) {
    if (ctx.getBudget().remaining < entry.tokenCount) break;
    if (!ctx.isLoaded(entry.id)) {
      // Load into context, budget-permitting
    }
  }

  // Step 3: Render as XML for the system prompt
  return ctx.renderContext();
  // Returns: <memory>\n## tasks\n### Fix login bug [summary]\n...\n</memory>
}
```

**Why search-first matters:** The old approach loaded ALL L0 summaries first, then searched. At 100+ tasks, the summaries alone exhausted the budget, leaving no room for the search results that were actually relevant to the task. Search-first inverts this: the most relevant memories always get loaded, and broad context fills whatever space remains.

### On Demand: Drilling Down

If an agent sees an L0 summary and needs more detail:

```typescript
// "I see the login bug fix summary, show me the full overview"
const result = await contextManager.drill(l0EntryId, MemoryLevel.L1);
// Now the L1 overview is loaded into context
```

### By Search: Finding Relevant Memories

```typescript
// Keyword search (always works)
const results = await memoryStore.search({
  query: "authentication session cookie",
  namespace: "tasks",  // optional: restrict scope
  limit: 5,
});

// Semantic search (requires embedding provider)
const results = await memoryStore.search({
  query: "why does login break on Chrome?",
  semantic: true,
  minSimilarity: 0.7,
});
```

Each result includes a relevance `score` (0-1) and a `highlight` snippet.

**On keyword search quality:** The built-in keyword search uses term-matching on lowercased text -- it checks how many of the query words appear in the title + content. This is simple and fast, but it has no stemming ("running" won't match "run"), no stop-word filtering, and no TF-IDF ranking. For production systems with large memory stores, consider adding SQLite's FTS5 extension for full-text search with ranking, phrase matching, and prefix queries. The current implementation is a deliberate trade-off: it works well enough for memory stores under ~1,000 entries, which covers most agent workloads, and avoids adding FTS5 schema complexity for systems that don't need it.

---

## The Token Budget System

This is the key insight that makes the whole thing work. Every agent has a **token budget** -- a hard limit on how much memory can be loaded at once.

**Default budget: 8,192 tokens**, split like this:

| Level | Share | Tokens | Purpose |
|-------|-------|--------|---------|
| L0 Summaries | 20% | ~1,639 | Always loaded, highest priority |
| L1 Overviews | 35% | ~2,867 | Loaded when agent needs more |
| L2 Full Content | 45% | ~3,686 | Loaded for deep dives |

### How allocation works:

1. **Loading:** When an entry is loaded, its token count is deducted from its level's allocation.
2. **Borrowing:** Any level can borrow unused tokens from lower-priority levels. L0 (highest priority) can borrow from unused L1 and L2 space. L1 can borrow from unused L2 space. L2 (lowest priority) cannot borrow -- it has nowhere to take from. This means your most important summaries are never dropped just because their 20% slice ran out, as long as there's unused space in the deeper tiers.
3. **Overflow protection:** If `remaining` hits zero, new entries are skipped (returned in the `skipped` array so you know what was dropped).
4. **Eviction:** When space is needed, L2 entries are evicted first (oldest first), then L1. **L0 summaries are never auto-evicted.**

```typescript
// Token budget state at any point
{
  total: 8192,
  l0: 1639,       // 20% allocated to summaries
  l1: 2867,       // 35% allocated to overviews
  l2: 3686,       // 45% allocated to full content
  used: 3200,     // currently consumed
  remaining: 4992 // still available
}
```

This means an agent's memory footprint is predictable and bounded. You'll never blow the context window.

### Token Estimation

Token counts are estimated as `Math.ceil(content.length / 4)`. This is a deliberate trade-off:

- **Why not use a real tokenizer?** Loading a tokenizer (like `tiktoken`) adds a dependency and ~50ms latency to every write. For budget management, precision isn't critical -- we need to prevent overflow, not count exact tokens.
- **How far off is the estimate?** For English prose, the real ratio is ~4.5 chars/token, so we slightly over-count (conservative -- better to over-estimate and leave headroom than under-estimate and overflow). For code, the ratio is ~3 chars/token, so we under-count by ~25%. For non-English text, it varies widely (CJK can be 1-2 chars/token).
- **When does this matter?** If your memory is predominantly code or non-English text, consider adjusting the divisor or plugging in a real tokenizer. For mixed-content agent workloads, the 4x estimate is conservative enough to prevent overflow while being fast enough for fire-and-forget writes.

---

## Memory Maintenance

Memories accumulate over time. Without maintenance, you'll eventually have thousands of entries and the budget system alone won't save you -- you'll be spending tokens just to *skip* irrelevant results. The store provides three maintenance tools:

### Pruning: Cap Memory Count

```typescript
// Keep only the 50 most recent entries per level in the "tasks" namespace.
// Deletes everything older. Returns the count of deleted entries.
const deleted = memoryStore.prune("tasks", 50);
// e.g., deleted = 127 (pruned 127 old entries)
```

Call this periodically (after every N tasks, or on a schedule). The `maxPerLevel` threshold is per-namespace, per-level, so `prune("tasks", 50)` keeps up to 50 L0s, 50 L1s, and 50 L2s.

### Orphan Cleanup

If entries get into a bad state (parent deleted manually, database restored from backup, etc.), clean up parentless children:

```typescript
const cleaned = memoryStore.removeOrphans();
// Deletes entries whose parent_id points to a non-existent entry
```

### Stats: Know What You Have

```typescript
const stats = memoryStore.stats();
// {
//   total: 342,
//   totalTokens: 48210,
//   byNamespace: {
//     "tasks": { count: 280, tokens: 38000 },
//     "project": { count: 62, tokens: 10210 }
//   }
// }
```

Use this to decide when to prune or to monitor growth over time.

### Recommended Maintenance Strategy

For most systems, run this after every ~100 tasks or daily:

```typescript
// 1. Prune old task memories (keep last 100 per level)
memoryStore.prune("tasks", 100);

// 2. Clean up any orphans
memoryStore.removeOrphans();

// 3. Log stats for monitoring
const stats = memoryStore.stats();
console.log(`Memory: ${stats.total} entries, ~${stats.totalTokens} tokens`);
```

---

## Namespaces: Organizing Memories

Namespaces use dot-separated paths, like file directories:

```
tasks                    -- All task results
tasks.conv-abc123        -- Task results from a specific conversation
project                  -- Project-wide knowledge
system                   -- System configuration
builder                  -- Memories from the Builder agent role
scout                    -- Memories from the Scout agent role
```

Queries use prefix matching (`LIKE 'tasks%'`), so searching for `"tasks"` finds everything under it.

---

## Semantic Search (Optional)

The memory system supports **vector embeddings** for semantic search -- finding memories by meaning, not just keywords.

**How it works:**

1. When a memory is written, its content is converted to a vector (an array of 384 numbers).
2. The vector is stored in the `embedding` column and indexed in a `memory_vss` virtual table, joined to the main table via SQLite's internal integer `rowid`.
3. When searching, the query is also converted to a vector, and SQLite finds the closest matches by cosine distance.

**Setup is optional.** If you don't install the embedding library, everything falls back to keyword search automatically.

```typescript
// To enable semantic search:
// 1. Install: npm install @xenova/transformers
// 2. Create the embedder:
import { createLocalEmbedder } from "./memory/local-embedder.js";
const embedder = await createLocalEmbedder(); // Uses "Xenova/all-MiniLM-L6-v2"

// 3. Pass it when initializing the store:
await memoryStore.initialize(embedder);
```

The local embedder runs an ONNX model in-process -- no API calls, no keys, no network.

If you'd rather use OpenAI or another provider, just implement the interface:

```typescript
interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  dimension: number;  // e.g., 384 for MiniLM, 1536 for OpenAI
}
```

**Important:** The `embeddingDimension` in `MemoryStoreConfig` must match your provider's output dimension. The default is 1536 (OpenAI). If using the local MiniLM embedder, set it to 384:

```typescript
const store = new MemoryStore({
  dbPath: "./data/memory.db",
  embeddingDimension: 384,  // Must match your embedder
});
```

A mismatch here means the VSS virtual table is created with the wrong column width, and search results will be garbage.

---

## Putting It All Together: The Full Lifecycle

Here's what happens end-to-end when an agent runs a task:

```
1. User sends: "Fix the login bug"
           |
           v
2. loadMemoryContext("Fix the login bug")
   - Creates ContextManager (4096-token budget)
   - SEARCH FIRST: finds memories matching "login" and "bug"
   - THEN fills remaining budget with recent L0 summaries (max 50)
   - Renders <memory>...</memory> block
           |
           v
3. System prompt is built:
   "You are Builder agent. Here is what you know:
    <memory>
    ## tasks
    ### Added session middleware [summary]
    Set up express-session with Redis store...
    ### Fixed CORS headers [summary]
    Updated CORS config to allow credentials...
    </memory>"
           |
           v
4. Agent runs, fixes the bug, produces output
           |
           v
5. saveTaskMemory("Fix the login bug", "builder-1", output, "conv-xyz")
   - Extracts L0 summary (first sentence, max 200 chars)
   - Extracts L1 overview (first 1500 chars)
   - Dedup check: updates existing entry if same task was saved before
   - Writes both to SQLite, linked by parent_id
           |
           v
6. Next task automatically sees this memory via step 2
```

---

## How to Use This in Your Own System

The memory system is self-contained in four files. Here's how to adapt it:

### Step 1: Copy These Files

```
src/memory/
  types.ts          -- Type definitions (MemoryEntry, TokenBudget, etc.)
  store.ts          -- SQLite-backed CRUD + search + maintenance (the core)
  context.ts        -- Token budget manager + context rendering
  local-embedder.ts -- Optional: local vector embeddings
```

### Step 2: Install Dependencies

```bash
npm install better-sqlite3        # Required: SQLite driver
npm install @xenova/transformers   # Optional: local embeddings
```

### Step 3: Initialize

```typescript
import { MemoryStore } from "./memory/store.js";
import { ContextManager } from "./memory/context.js";

// Create the store
const store = new MemoryStore({
  dbPath: "./data/memory.db",
  embeddingDimension: 384,    // Match your embedding model (384 for MiniLM, 1536 for OpenAI)
  defaultBudget: 8192,        // Total tokens for memory
});

// Initialize (creates tables on first run)
await store.initialize();  // Without embedder = keyword search only

// Or with local embeddings:
import { tryCreateLocalEmbedder } from "./memory/local-embedder.js";
const embedder = await tryCreateLocalEmbedder();
await store.initialize(embedder ?? undefined);
```

### Step 4: Write Memories

```typescript
// Simple write (always creates a new entry)
const id = await store.write({
  namespace: "tasks",
  title: "Deployed v2.1",
  content: "Deployed version 2.1 with the new auth flow.",
  level: 0,  // L0 summary
  source: "deploy-bot",
});

// Write-or-update (deduplicates by namespace + title + level)
const id = await store.writeOrUpdate({
  namespace: "tasks",
  title: "Deployed v2.1",
  content: "Re-deployed v2.1 with hotfix for session timeout.",
  level: 0,
  source: "deploy-bot",
});
// If "Deployed v2.1" already exists at L0 in "tasks", updates it.
// Otherwise creates a new entry.

// Full hierarchy
await store.writeHierarchy({
  namespace: "project",
  title: "Auth System Redesign",
  summary: "Switching from JWT to session cookies for better security.",
  overview: "Three phases: cookie migration, JWT sunset, cleanup...",
  fullContent: "Complete technical spec with migration scripts...",
  source: "architect",
});
```

### Step 5: Load Context for an Agent

```typescript
// Before sending a prompt to your LLM:
const ctx = new ContextManager(store, 4096);

// Option A: Search-first (recommended for task-driven agents)
await ctx.loadRelevant("fix the payment webhook", { limit: 10 });

// Option B: Load all summaries (only for small memory stores < 50 entries)
await ctx.load({ namespaces: ["tasks", "project"], budget: 4096 });

// Get the formatted string for your system prompt
const memoryBlock = ctx.renderContext();
// Insert memoryBlock into your LLM's system prompt
```

### Step 6: Save After Task Completion

```typescript
// After your agent produces output:
const output = "Fixed the webhook by updating the endpoint URL...";

// Extract summary and overview
const summary = output.slice(0, 200);
const overview = output.slice(0, 1500);

// Write L0 (dedup-safe)
const l0 = await store.writeOrUpdate({
  namespace: "tasks",
  title: "Fix payment webhook",
  content: summary,
  level: 0,
  source: "my-agent",
});

// Write L1 linked to L0 (dedup-safe)
await store.writeOrUpdate({
  namespace: "tasks",
  title: "Fix payment webhook (overview)",
  content: overview,
  level: 1,
  parentId: l0,
  source: "my-agent",
});
```

### Step 7: Maintain Over Time

```typescript
// Run periodically (every 100 tasks, daily, etc.)
store.prune("tasks", 100);     // Keep last 100 per level
store.removeOrphans();          // Clean up broken links
const stats = store.stats();    // Monitor growth
```

---

## Quick Reference

| Operation | Method | Returns |
|-----------|--------|---------|
| Create memory | `store.write(options)` | Entry ID |
| Create or update (dedup) | `store.writeOrUpdate(options)` | Entry ID |
| Check for duplicate | `store.findDuplicate(ns, title, level)` | ID or null |
| Create all 3 tiers | `store.writeHierarchy(options)` | `{ l0, l1, l2 }` IDs |
| Read by ID | `store.read(id)` | Entry or null |
| List by namespace | `store.listByNamespace("tasks", Level.L0)` | Entry array |
| Get children | `store.getChildren(parentId)` | Entry array |
| Search | `store.search({ query, semantic })` | Results with scores |
| Update | `store.update(id, { content })` | boolean |
| Delete (+ all descendants) | `store.delete(id)` | boolean |
| Prune old entries | `store.prune(namespace, maxPerLevel)` | Count deleted |
| Remove orphans | `store.removeOrphans()` | Count deleted |
| Get stats | `store.stats()` | `{ total, totalTokens, byNamespace }` |
| Load context | `ctx.load({ namespaces, budget })` | Entries + budget |
| Drill deeper | `ctx.drill(entryId, Level.L1)` | Entries + budget |
| Find relevant | `ctx.loadRelevant(query)` | Entries + budget |
| Free space | `ctx.evict(tokensNeeded)` | Evicted entries |
| Render for prompt | `ctx.renderContext()` | `<memory>...</memory>` string |

---

## Design Decisions Worth Knowing

### Why SQLite?

Single file, zero config, fast for this workload, WAL mode handles concurrent reads. No server to run. The entire memory store is portable -- copy one file and you have everything.

### Why not just use a vector database?

Vectors are optional. Keyword search works fine for most use cases. The system degrades gracefully -- you get full functionality without any embedding provider. Adding Pinecone or Qdrant would mean an external dependency, network latency, and a separate data store to manage. For agent memory (not web-scale search), SQLite + optional VSS is the right tool.

### Why parent_id links instead of a separate hierarchy table?

Simpler. One table, one foreign key. Deleting an L0 cascades recursively via a CTE that walks all descendants. No joins needed for basic operations.

### Why estimate tokens as length/4 instead of using a real tokenizer?

Speed. `estimateTokens()` runs on every write and is called in tight loops during budget allocation. A real tokenizer adds ~50ms per call and a heavy dependency. The 4x divisor is deliberately conservative for English text (real ratio is ~4.5), meaning we slightly over-count and leave headroom. This trades precision for speed -- appropriate for budget management where the goal is "don't overflow" rather than "count exactly."

**When to upgrade:** If your content is predominantly code (real ratio ~3x, meaning you'd under-count by ~25%) or non-English (ratios vary wildly), either adjust the divisor or plug in a tokenizer at the `estimateTokens()` call site.

### Why can L0 borrow from L1/L2 but not vice versa?

Borrowing follows priority: L0 (summaries) is highest priority because it provides breadth -- the agent knowing something *exists* is more valuable than having deep detail on one thing. If L0's 20% allocation is exhausted but L1/L2 have unused space, L0 borrows it. L2 can't borrow because it's lowest priority -- if the budget is tight, deep detail should be the first thing dropped, not the last thing loaded.

### Why fire-and-forget writes from agents?

Memory saves should never block task execution. If a write fails, the task still succeeded. The agent's output is the primary artifact; memory is a bonus. The `catch(() => {})` pattern is intentional -- swallowing write errors keeps the agent running.

### Why evict L2 first?

Full content is the most expensive and least frequently needed. Summaries (L0) are the cheapest and most useful -- they're never auto-evicted because losing them means the agent forgets something existed entirely.

### Why search-first loading instead of "load all L0 then search"?

At scale, loading all L0 summaries first consumes the entire budget before the relevance search even runs. With 100 tasks averaging 50 tokens each, that's 5,000 tokens of L0 summaries alone -- exceeding a 4,096-token budget. Search-first guarantees that the memories most relevant to the current task always get loaded, and broad context fills whatever space remains.

---

## Scalability Characteristics

This system is designed for **single-agent or small-swarm workloads** (1-10 agents, up to ~10,000 memories). Here's where the boundaries are:

| Dimension | Comfortable Range | When to Upgrade |
|-----------|-------------------|-----------------|
| Memory count | Up to ~10,000 entries | Beyond 10K, keyword search slows (O(n) scan). Add FTS5. |
| Concurrent agents | Up to ~10 writing simultaneously | `better-sqlite3` is single-writer. For higher concurrency, switch to PostgreSQL. |
| Database size | Up to ~100 MB | SQLite handles this easily. Beyond 1 GB, consider archiving old memories. |
| Embedding dimension | 384 (MiniLM) recommended | 1536 (OpenAI) works but 4x the storage. Use 384 unless you need cross-lingual search. |
| Budget per agent | 4,096 - 16,384 tokens | Above 16K, loading time becomes noticeable. Keep budgets tight. |

**What this system is NOT:** It's not a replacement for a vector database in a RAG pipeline serving thousands of concurrent users. It's agent memory -- a fast, local, zero-dependency store for agents that need to remember what happened in prior sessions.
