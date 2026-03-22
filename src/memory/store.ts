/**
 * HIVEMIND Memory Store
 *
 * SQLite-backed hierarchical memory with vector search support.
 * Provides CRUD operations, semantic search, and the L0/L1/L2
 * progressive loading model inspired by OpenViking.
 */

import { randomUUID } from "node:crypto";
import type {
  MemoryEntry,
  MemoryLevel,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryStoreConfig,
  MemoryWriteOptions,
  MemoryUpdateOptions,
} from "./types.js";
import { MemoryLevel as Level } from "./types.js";

// ---------------------------------------------------------------------------
// Embedding provider interface (pluggable)
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  dimension: number;
}

// ---------------------------------------------------------------------------
// Database abstraction (thin wrapper around better-sqlite3 + sqlite-vss)
// ---------------------------------------------------------------------------

interface DatabaseRow {
  id: string;
  namespace: string;
  title: string;
  content: string;
  level: number;
  parent_id: string | null;
  embedding: Buffer | null;
  metadata: string;
  created_at: string;
  updated_at: string;
  token_count: number;
  source: string;
  rowid?: number;
}

interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

interface Statement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

// ---------------------------------------------------------------------------
// Memory Store
// ---------------------------------------------------------------------------

export class MemoryStore {
  private db!: Database;
  private embedder: EmbeddingProvider | null = null;
  private readonly config: Required<MemoryStoreConfig>;

  constructor(config: MemoryStoreConfig) {
    this.config = {
      dbPath: config.dbPath,
      embeddingModel: config.embeddingModel ?? "text-embedding-3-small",
      embeddingDimension: config.embeddingDimension ?? 1536,
      defaultBudget: config.defaultBudget ?? 8192,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Initialize the database, create tables, and load extensions. */
  async initialize(embedder?: EmbeddingProvider): Promise<void> {
    // Dynamic import — the consumer provides the sqlite binding
    const { default: Database } = await import("better-sqlite3");
    this.db = new Database(this.config.dbPath) as unknown as Database;
    this.embedder = embedder ?? null;

    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id            TEXT PRIMARY KEY,
        namespace     TEXT NOT NULL,
        title         TEXT NOT NULL,
        content       TEXT NOT NULL,
        level         INTEGER NOT NULL DEFAULT 0,
        parent_id     TEXT,
        embedding     BLOB,
        metadata      TEXT NOT NULL DEFAULT '{}',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        token_count   INTEGER NOT NULL DEFAULT 0,
        source        TEXT NOT NULL DEFAULT 'system',

        FOREIGN KEY (parent_id) REFERENCES memories(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
      CREATE INDEX IF NOT EXISTS idx_memories_level     ON memories(level);
      CREATE INDEX IF NOT EXISTS idx_memories_parent    ON memories(parent_id);
      CREATE INDEX IF NOT EXISTS idx_memories_source    ON memories(source);
    `);

    // Attempt to load sqlite-vss for vector search
    try {
      this.db.exec("SELECT load_extension('vss0');");
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_vss USING vss0(
          embedding(${this.config.embeddingDimension})
        );
      `);
    } catch {
      // Vector extensions not available — fall back to keyword search
      console.warn("[MemoryStore] sqlite-vss not available; semantic search disabled");
    }
  }

  /** Close the database connection. */
  close(): void {
    this.db?.close();
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  /** Create a new memory entry. Returns the assigned ID. */
  async write(options: MemoryWriteOptions): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const tokenCount = this.estimateTokens(options.content);

    let embedding: Buffer | null = null;
    if (this.embedder) {
      const vec = await this.embedder.embed(options.content);
      embedding = Buffer.from(vec.buffer);
    }

    this.db
      .prepare(
        `INSERT INTO memories (id, namespace, title, content, level, parent_id,
          embedding, metadata, created_at, updated_at, token_count, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        options.namespace,
        options.title,
        options.content,
        options.level,
        options.parentId ?? null,
        embedding,
        JSON.stringify(options.metadata ?? {}),
        now,
        now,
        tokenCount,
        options.source ?? "system",
      );

    // Index embedding for vector search using SQLite's internal integer rowid
    if (embedding) {
      try {
        const row = this.db
          .prepare("SELECT rowid FROM memories WHERE id = ?")
          .get(id) as { rowid: number } | undefined;
        if (row) {
          this.db
            .prepare("INSERT INTO memory_vss (rowid, embedding) VALUES (?, ?)")
            .run(row.rowid, embedding);
        }
      } catch {
        // VSS not available
      }
    }

    return id;
  }

  /** Read a single entry by ID. */
  read(id: string): MemoryEntry | null {
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as DatabaseRow | undefined;

    return row ? this.rowToEntry(row) : null;
  }

  /** Update an existing entry. */
  async update(id: string, options: MemoryUpdateOptions): Promise<boolean> {
    const existing = this.read(id);
    if (!existing) return false;

    const now = new Date().toISOString();
    const title = options.title ?? existing.title;
    const content = options.content ?? existing.content;
    const metadata = options.metadata
      ? JSON.stringify({ ...existing.metadata, ...options.metadata })
      : JSON.stringify(existing.metadata);
    const tokenCount = options.content
      ? this.estimateTokens(content)
      : existing.tokenCount;

    let embedding: Buffer | null = null;
    if (options.content && this.embedder) {
      const vec = await this.embedder.embed(content);
      embedding = Buffer.from(vec.buffer);
    }

    const result = this.db
      .prepare(
        `UPDATE memories
         SET title = ?, content = ?, metadata = ?, updated_at = ?,
             token_count = ?, embedding = COALESCE(?, embedding)
         WHERE id = ?`,
      )
      .run(title, content, metadata, now, tokenCount, embedding, id);

    return result.changes > 0;
  }

  /** Delete an entry and all its descendants (L0 -> L1 -> L2). */
  delete(id: string): boolean {
    // Recursive CTE finds all descendants at every depth
    this.db
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM memories WHERE parent_id = ?
           UNION ALL
           SELECT m.id FROM memories m JOIN descendants d ON m.parent_id = d.id
         )
         DELETE FROM memories WHERE id IN (SELECT id FROM descendants)`,
      )
      .run(id);

    const result = this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** List entries in a namespace, optionally filtered by level. */
  listByNamespace(
    namespace: string,
    level?: MemoryLevel,
  ): MemoryEntry[] {
    const prefix = namespace.endsWith("%") ? namespace : `${namespace}%`;

    const sql =
      level !== undefined
        ? "SELECT * FROM memories WHERE namespace LIKE ? AND level = ? ORDER BY updated_at DESC"
        : "SELECT * FROM memories WHERE namespace LIKE ? ORDER BY updated_at DESC";

    const args = level !== undefined ? [prefix, level] : [prefix];
    const rows = this.db.prepare(sql).all(...args) as DatabaseRow[];

    return rows.map((r) => this.rowToEntry(r));
  }

  /** Get all children of a parent entry. */
  getChildren(parentId: string): MemoryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM memories WHERE parent_id = ? ORDER BY level, title")
      .all(parentId) as DatabaseRow[];

    return rows.map((r) => this.rowToEntry(r));
  }

  /** Search memories by keyword or semantic similarity. */
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const limit = options.limit ?? 10;

    if (options.semantic && this.embedder) {
      return this.semanticSearch(options, limit);
    }

    return this.keywordSearch(options, limit);
  }

  // -----------------------------------------------------------------------
  // Hierarchical helpers
  // -----------------------------------------------------------------------

  /**
   * Write a full hierarchy: provide L0 summary, L1 overview, and L2 full content
   * for a single logical memory. Returns all three IDs.
   */
  async writeHierarchy(options: {
    namespace: string;
    title: string;
    summary: string;
    overview: string;
    fullContent: string;
    metadata?: Record<string, unknown>;
    source?: string;
  }): Promise<{ l0: string; l1: string; l2: string }> {
    const l0 = await this.write({
      namespace: options.namespace,
      title: options.title,
      content: options.summary,
      level: Level.L0,
      metadata: options.metadata,
      source: options.source,
    });

    const l1 = await this.write({
      namespace: options.namespace,
      title: `${options.title} (overview)`,
      content: options.overview,
      level: Level.L1,
      parentId: l0,
      metadata: options.metadata,
      source: options.source,
    });

    const l2 = await this.write({
      namespace: options.namespace,
      title: `${options.title} (full)`,
      content: options.fullContent,
      level: Level.L2,
      parentId: l1,
      metadata: options.metadata,
      source: options.source,
    });

    return { l0, l1, l2 };
  }

  // -----------------------------------------------------------------------
  // Maintenance
  // -----------------------------------------------------------------------

  /**
   * Check for an existing memory with the same namespace, title, and level.
   * Returns the existing entry ID if found, null otherwise.
   * Use before write() to avoid duplicates.
   */
  findDuplicate(
    namespace: string,
    title: string,
    level: MemoryLevel,
  ): string | null {
    const row = this.db
      .prepare(
        "SELECT id FROM memories WHERE namespace = ? AND title = ? AND level = ? LIMIT 1",
      )
      .get(namespace, title, level) as { id: string } | undefined;

    return row?.id ?? null;
  }

  /**
   * Write a memory, updating if a duplicate (same namespace + title + level) exists.
   * Returns the entry ID (existing or new).
   */
  async writeOrUpdate(options: MemoryWriteOptions): Promise<string> {
    const existing = this.findDuplicate(
      options.namespace,
      options.title,
      options.level,
    );

    if (existing) {
      await this.update(existing, {
        content: options.content,
        metadata: options.metadata,
      });
      return existing;
    }

    return this.write(options);
  }

  /**
   * Prune old memories beyond a count threshold per namespace+level.
   * Keeps the most recent `maxPerLevel` entries, deletes the rest.
   * Returns the number of entries deleted.
   */
  prune(namespace: string, maxPerLevel: number = 50): number {
    let deleted = 0;

    for (const level of [Level.L0, Level.L1, Level.L2]) {
      const rows = this.db
        .prepare(
          `SELECT id FROM memories
           WHERE namespace LIKE ? AND level = ?
           ORDER BY updated_at DESC
           LIMIT -1 OFFSET ?`,
        )
        .all(`${namespace}%`, level, maxPerLevel) as { id: string }[];

      for (const row of rows) {
        this.delete(row.id);
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Remove orphaned entries -- children whose parent no longer exists.
   * Returns the number of entries deleted.
   */
  removeOrphans(): number {
    const result = this.db
      .prepare(
        `DELETE FROM memories
         WHERE parent_id IS NOT NULL
         AND parent_id NOT IN (SELECT id FROM memories)`,
      )
      .run();

    return result.changes;
  }

  /** Get total memory count and token usage by namespace. */
  stats(): { total: number; totalTokens: number; byNamespace: Record<string, { count: number; tokens: number }> } {
    const rows = this.db
      .prepare(
        `SELECT namespace, COUNT(*) as count, SUM(token_count) as tokens
         FROM memories GROUP BY namespace`,
      )
      .all() as { namespace: string; count: number; tokens: number }[];

    const byNamespace: Record<string, { count: number; tokens: number }> = {};
    let total = 0;
    let totalTokens = 0;

    for (const row of rows) {
      byNamespace[row.namespace] = { count: row.count, tokens: row.tokens };
      total += row.count;
      totalTokens += row.tokens;
    }

    return { total, totalTokens, byNamespace };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async semanticSearch(
    options: MemorySearchOptions,
    limit: number,
  ): Promise<MemorySearchResult[]> {
    if (!this.embedder) return [];

    const queryVec = await this.embedder.embed(options.query);
    const queryBuf = Buffer.from(queryVec.buffer);

    try {
      const rows = this.db
        .prepare(
          `SELECT m.*, v.distance
           FROM memory_vss v
           JOIN memories m ON m.rowid = v.rowid
           WHERE vss_search(v.embedding, ?)
           ORDER BY v.distance ASC
           LIMIT ?`,
        )
        .all(queryBuf, limit) as (DatabaseRow & { distance: number })[];

      const minSim = options.minSimilarity ?? 0;

      return rows
        .map((r) => {
          const score = 1 - r.distance; // cosine distance -> similarity
          return {
            entry: this.rowToEntry(r),
            score,
            highlight: this.extractHighlight(r.content, options.query),
          };
        })
        .filter((r) => r.score >= minSim);
    } catch {
      // Fall back to keyword search if VSS fails
      return this.keywordSearch(options, limit);
    }
  }

  private keywordSearch(
    options: MemorySearchOptions,
    limit: number,
  ): MemorySearchResult[] {
    const terms = options.query.toLowerCase().split(/\s+/).filter(Boolean);

    let sql = "SELECT * FROM memories WHERE 1=1";
    const params: unknown[] = [];

    if (options.namespace) {
      sql += " AND namespace LIKE ?";
      params.push(`${options.namespace}%`);
    }

    if (options.level !== undefined) {
      sql += " AND level = ?";
      params.push(options.level);
    }

    sql += " ORDER BY updated_at DESC LIMIT ?";
    params.push(limit * 5); // Over-fetch, then rank

    const rows = this.db.prepare(sql).all(...params) as DatabaseRow[];

    return rows
      .map((r) => {
        const text = `${r.title} ${r.content}`.toLowerCase();
        const matchCount = terms.filter((t) => text.includes(t)).length;
        const score = terms.length > 0 ? matchCount / terms.length : 0;

        return {
          entry: this.rowToEntry(r),
          score,
          highlight: this.extractHighlight(r.content, options.query),
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private rowToEntry(row: DatabaseRow): MemoryEntry {
    return {
      id: row.id,
      namespace: row.namespace,
      title: row.title,
      content: row.content,
      level: row.level as MemoryLevel,
      parentId: row.parent_id,
      embedding: row.embedding
        ? new Float32Array(row.embedding.buffer)
        : null,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tokenCount: row.token_count,
      source: row.source,
    };
  }

  private extractHighlight(content: string, query: string): string {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const sentences = content.split(/[.!?\n]+/).filter((s) => s.trim());

    for (const sentence of sentences) {
      if (terms.some((t) => sentence.toLowerCase().includes(t))) {
        const trimmed = sentence.trim();
        return trimmed.length > 200 ? trimmed.slice(0, 200) + "..." : trimmed;
      }
    }

    return content.slice(0, 200) + (content.length > 200 ? "..." : "");
  }

  /** Rough token count estimate (~4 chars per token). */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
