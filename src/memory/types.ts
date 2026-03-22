/**
 * HIVEMIND Memory System — Type Definitions
 *
 * Implements a hierarchical memory model inspired by OpenViking:
 *   L0 — Summaries: compressed, high-level overviews (always loaded)
 *   L1 — Overviews: mid-detail expansions (loaded on demand)
 *   L2 — Full Content: raw data, complete transcripts (loaded selectively)
 *
 * This layered approach keeps the context window lean while preserving
 * the ability to drill into detail when needed.
 */

// ---------------------------------------------------------------------------
// Memory hierarchy
// ---------------------------------------------------------------------------

/** The three levels of memory granularity. */
export enum MemoryLevel {
  /** Compressed summaries — always available in context */
  L0 = 0,
  /** Mid-detail overviews — loaded on demand */
  L1 = 1,
  /** Full raw content — loaded selectively */
  L2 = 2,
}

// ---------------------------------------------------------------------------
// Core memory entry
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  /** Unique identifier */
  id: string;
  /** Hierarchical namespace (e.g., "project.tasks.sprint-12") */
  namespace: string;
  /** Short human-readable label */
  title: string;
  /** The content at this memory level */
  content: string;
  /** Which level this entry represents */
  level: MemoryLevel;
  /** Link to the parent entry (L0 -> null, L1 -> L0 id, L2 -> L1 id) */
  parentId: string | null;
  /** Vector embedding for semantic search */
  embedding: Float32Array | null;
  /** Arbitrary structured metadata */
  metadata: Record<string, unknown>;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-modified timestamp */
  updatedAt: string;
  /** Token count of `content` */
  tokenCount: number;
  /** Source attribution (skill name, agent id, user, etc.) */
  source: string;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

export interface MemoryWriteOptions {
  namespace: string;
  title: string;
  content: string;
  level: MemoryLevel;
  parentId?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface MemoryUpdateOptions {
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Query operations
// ---------------------------------------------------------------------------

export interface MemorySearchOptions {
  /** Free-text or semantic query */
  query: string;
  /** Restrict to specific namespace prefix */
  namespace?: string;
  /** Filter by memory level */
  level?: MemoryLevel;
  /** Maximum results */
  limit?: number;
  /** Minimum similarity score (0-1) for semantic search */
  minSimilarity?: number;
  /** Use vector search (true) or keyword search (false) */
  semantic?: boolean;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  /** Similarity score (1.0 = exact match) */
  score: number;
  /** Snippet with matching context highlighted */
  highlight: string;
}

// ---------------------------------------------------------------------------
// Context budget
// ---------------------------------------------------------------------------

export interface TokenBudget {
  /** Total tokens available for memory in the context window */
  total: number;
  /** Tokens allocated to L0 summaries */
  l0: number;
  /** Tokens allocated to L1 overviews */
  l1: number;
  /** Tokens allocated to L2 full content */
  l2: number;
  /** Tokens currently used */
  used: number;
  /** Tokens remaining */
  remaining: number;
}

export interface ContextLoadRequest {
  /** Namespaces to load (loads L0 by default) */
  namespaces: string[];
  /** Specific entry IDs to expand to L1 or L2 */
  expand?: { id: string; level: MemoryLevel }[];
  /** Token budget constraint */
  budget: number;
}

export interface ContextLoadResult {
  /** Entries loaded into context, ordered by relevance */
  entries: MemoryEntry[];
  /** Budget accounting */
  budget: TokenBudget;
  /** Entry IDs that were requested but skipped due to budget */
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Store configuration
// ---------------------------------------------------------------------------

export interface MemoryStoreConfig {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Embedding model identifier (e.g., "text-embedding-3-small") */
  embeddingModel?: string;
  /** Embedding vector dimension */
  embeddingDimension?: number;
  /** Default token budget for context loading */
  defaultBudget?: number;
}
