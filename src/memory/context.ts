/**
 * HIVEMIND Context Window Manager
 *
 * Manages what memory is loaded into an agent's context window using
 * progressive loading: L0 summaries are always present, L1 overviews
 * are loaded on demand, and L2 full content is loaded selectively.
 *
 * Tracks token budgets to prevent context overflow.
 */

import type {
  MemoryEntry,
  MemoryLevel,
  TokenBudget,
  ContextLoadRequest,
  ContextLoadResult,
} from "./types.js";
import { MemoryLevel as Level } from "./types.js";
import { MemoryStore } from "./store.js";

// ---------------------------------------------------------------------------
// Budget defaults
// ---------------------------------------------------------------------------

const DEFAULT_BUDGET = 8192;

/** Allocation ratios when no explicit per-level budgets are given. */
const LEVEL_RATIOS = {
  [Level.L0]: 0.2, // 20% for summaries
  [Level.L1]: 0.35, // 35% for overviews
  [Level.L2]: 0.45, // 45% for full content
} as const;

// ---------------------------------------------------------------------------
// Context Manager
// ---------------------------------------------------------------------------

export class ContextManager {
  private readonly store: MemoryStore;
  private readonly loadedEntries = new Map<string, MemoryEntry>();
  private tokenBudget: TokenBudget;

  constructor(store: MemoryStore, totalBudget?: number) {
    this.store = store;
    const total = totalBudget ?? DEFAULT_BUDGET;
    this.tokenBudget = this.createBudget(total);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Get the current token budget state. */
  getBudget(): Readonly<TokenBudget> {
    return { ...this.tokenBudget };
  }

  /** Get all entries currently loaded in context. */
  getLoadedEntries(): MemoryEntry[] {
    return [...this.loadedEntries.values()];
  }

  /** Check if a specific entry is loaded. */
  isLoaded(entryId: string): boolean {
    return this.loadedEntries.has(entryId);
  }

  /**
   * Load memory into the context window according to the request.
   *
   * 1. Always loads L0 summaries for requested namespaces
   * 2. Expands specific entries to L1 or L2 if budget allows
   * 3. Returns what was loaded and what was skipped
   */
  async load(request: ContextLoadRequest): Promise<ContextLoadResult> {
    const budget = this.createBudget(request.budget);
    const loaded: MemoryEntry[] = [];
    const skipped: string[] = [];

    // Phase 1: Load L0 summaries for all requested namespaces
    for (const ns of request.namespaces) {
      const summaries = this.store.listByNamespace(ns, Level.L0);

      for (const entry of summaries) {
        if (this.tryAllocate(budget, entry, Level.L0)) {
          this.loadedEntries.set(entry.id, entry);
          loaded.push(entry);
        } else {
          skipped.push(entry.id);
        }
      }
    }

    // Phase 2: Expand specific entries to deeper levels
    if (request.expand) {
      for (const { id, level } of request.expand) {
        const expandedEntries = await this.expandEntry(id, level, budget);

        for (const entry of expandedEntries) {
          if (this.tryAllocate(budget, entry, entry.level)) {
            this.loadedEntries.set(entry.id, entry);
            loaded.push(entry);
          } else {
            skipped.push(entry.id);
          }
        }
      }
    }

    this.tokenBudget = budget;

    return { entries: loaded, budget, skipped };
  }

  /**
   * Expand a loaded entry to a deeper level.
   * If the entry is at L0, loads its L1 children.
   * If at L1, loads its L2 children.
   */
  async drill(entryId: string, targetLevel: MemoryLevel): Promise<ContextLoadResult> {
    const entry = this.loadedEntries.get(entryId) ?? this.store.read(entryId);

    if (!entry) {
      return {
        entries: [],
        budget: this.tokenBudget,
        skipped: [entryId],
      };
    }

    const children = this.store.getChildren(entryId);
    const targetChildren = children.filter((c) => c.level === targetLevel);

    const loaded: MemoryEntry[] = [];
    const skipped: string[] = [];

    for (const child of targetChildren) {
      if (this.tryAllocate(this.tokenBudget, child, child.level)) {
        this.loadedEntries.set(child.id, child);
        loaded.push(child);
      } else {
        skipped.push(child.id);
      }
    }

    return { entries: loaded, budget: this.tokenBudget, skipped };
  }

  /**
   * Evict entries to free up tokens. Evicts L2 first, then L1.
   * Never evicts L0 summaries automatically.
   */
  evict(targetFreeTokens: number): MemoryEntry[] {
    const evicted: MemoryEntry[] = [];
    let freed = 0;

    // Sort by level descending (L2 first), then by oldest first
    const candidates = [...this.loadedEntries.values()]
      .filter((e) => e.level > Level.L0) // Never auto-evict L0
      .sort((a, b) => {
        if (b.level !== a.level) return b.level - a.level;
        return a.updatedAt.localeCompare(b.updatedAt);
      });

    for (const entry of candidates) {
      if (freed >= targetFreeTokens) break;

      this.loadedEntries.delete(entry.id);
      this.deallocate(entry);
      evicted.push(entry);
      freed += entry.tokenCount;
    }

    return evicted;
  }

  /**
   * Load relevant memories using semantic search, respecting the budget.
   * Useful for loading context related to a user query.
   */
  async loadRelevant(
    query: string,
    options?: { namespace?: string; limit?: number },
  ): Promise<ContextLoadResult> {
    const limit = options?.limit ?? 5;
    const results = await this.store.search({
      query,
      namespace: options?.namespace,
      semantic: true,
      limit,
    });

    const loaded: MemoryEntry[] = [];
    const skipped: string[] = [];

    for (const result of results) {
      const entry = result.entry;

      if (this.loadedEntries.has(entry.id)) {
        loaded.push(entry); // Already loaded
        continue;
      }

      if (this.tryAllocate(this.tokenBudget, entry, entry.level)) {
        this.loadedEntries.set(entry.id, entry);
        loaded.push(entry);
      } else {
        skipped.push(entry.id);
      }
    }

    return { entries: loaded, budget: this.tokenBudget, skipped };
  }

  /**
   * Load specific memory entries into context, allocating from the
   * EXISTING budget without resetting. Use for backfilling additional
   * entries after loadRelevant().
   */
  loadEntries(entries: MemoryEntry[]): MemoryEntry[] {
    const loaded: MemoryEntry[] = [];
    for (const entry of entries) {
      if (this.loadedEntries.has(entry.id)) continue;
      if (this.tryAllocate(this.tokenBudget, entry, entry.level)) {
        this.loadedEntries.set(entry.id, entry);
        loaded.push(entry);
      } else {
        break; // Budget exhausted
      }
    }
    return loaded;
  }

  /** Clear all loaded entries and reset the budget. */
  reset(newBudget?: number): void {
    this.loadedEntries.clear();
    this.tokenBudget = this.createBudget(newBudget ?? this.tokenBudget.total);
  }

  /**
   * Build a formatted context string from all loaded entries,
   * suitable for injection into an agent's system prompt.
   */
  renderContext(): string {
    const entries = this.getLoadedEntries();

    if (entries.length === 0) return "";

    const sections: string[] = ["<memory>"];

    // Group by namespace
    const byNamespace = new Map<string, MemoryEntry[]>();
    for (const entry of entries) {
      const group = byNamespace.get(entry.namespace) ?? [];
      group.push(entry);
      byNamespace.set(entry.namespace, group);
    }

    for (const [ns, group] of byNamespace) {
      sections.push(`\n## ${ns}`);

      // Sort within group: L0 first, then L1, then L2
      group.sort((a, b) => a.level - b.level);

      for (const entry of group) {
        const levelTag = ["summary", "overview", "detail"][entry.level];
        sections.push(`\n### ${entry.title} [${levelTag}]`);
        sections.push(entry.content);
      }
    }

    sections.push("\n</memory>");
    return sections.join("\n");
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private createBudget(total: number): TokenBudget {
    return {
      total,
      l0: Math.floor(total * LEVEL_RATIOS[Level.L0]),
      l1: Math.floor(total * LEVEL_RATIOS[Level.L1]),
      l2: Math.floor(total * LEVEL_RATIOS[Level.L2]),
      used: 0,
      remaining: total,
    };
  }

  private tryAllocate(
    budget: TokenBudget,
    entry: MemoryEntry,
    level: MemoryLevel,
  ): boolean {
    const tokens = entry.tokenCount;

    if (tokens > budget.remaining) return false;

    const levelKey = (["l0", "l1", "l2"] as const)[level];
    const levelBudget = budget[levelKey];
    const levelUsed = this.getLevelUsage(level);

    if (levelUsed + tokens > levelBudget) {
      // Try to borrow from lower-priority levels
      if (!this.canBorrow(budget, level, tokens - (levelBudget - levelUsed))) {
        return false;
      }
    }

    budget.used += tokens;
    budget.remaining -= tokens;
    return true;
  }

  private deallocate(entry: MemoryEntry): void {
    this.tokenBudget.used -= entry.tokenCount;
    this.tokenBudget.remaining += entry.tokenCount;
  }

  private getLevelUsage(level: MemoryLevel): number {
    let total = 0;
    for (const entry of this.loadedEntries.values()) {
      if (entry.level === level) total += entry.tokenCount;
    }
    return total;
  }

  private canBorrow(
    budget: TokenBudget,
    level: MemoryLevel,
    needed: number,
  ): boolean {
    // Any level can borrow from lower-priority (higher-numbered) levels' unused allocation.
    // Priority: L0 (highest) > L1 > L2 (lowest).
    // L0 can borrow from unused L1 + L2 space.
    // L1 can borrow from unused L2 space.
    // L2 has nowhere to borrow from.
    if (level === Level.L2) return false; // L2 is lowest priority, can't borrow

    let available = 0;
    for (let l = Level.L2; l > level; l--) {
      const key = (["l0", "l1", "l2"] as const)[l];
      const used = this.getLevelUsage(l as MemoryLevel);
      available += budget[key] - used;
    }

    return available >= needed;
  }

  private async expandEntry(
    id: string,
    targetLevel: MemoryLevel,
    budget: TokenBudget,
  ): Promise<MemoryEntry[]> {
    const children = this.store.getChildren(id);
    return children.filter((c) => c.level === targetLevel);
  }
}
