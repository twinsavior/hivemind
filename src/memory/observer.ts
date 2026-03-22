/**
 * HIVEMIND Memory Observer
 *
 * Automatic summarization layer that compresses task results into reusable
 * memory without manual intervention. Observes completed tasks, extracts
 * key learnings as L1 entries, stores raw results as L2, and periodically
 * reflects to consolidate observations into L0 summaries.
 *
 * All analysis is heuristic (word-frequency, sentence extraction) —
 * no LLM calls — so reflection stays fast (<100ms per cycle).
 */

import type { MemoryStore } from "./store.js";
import { MemoryLevel } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ObservationConfig {
  /** Minimum result length to trigger observation (default: 200 chars) */
  minResultLength?: number;
  /** Maximum number of observations to keep per namespace (default: 50) */
  maxObservationsPerNamespace?: number;
  /** How often to run the reflector (consolidate observations), in ms (default: 300000 = 5min) */
  reflectionInterval?: number;
  /** Whether to auto-start the reflection loop (default: true) */
  autoReflect?: boolean;
}

interface ResolvedConfig {
  minResultLength: number;
  maxObservationsPerNamespace: number;
  reflectionInterval: number;
  autoReflect: boolean;
}

// ---------------------------------------------------------------------------
// Key-sentence signals — sentences matching these patterns are extracted
// ---------------------------------------------------------------------------

const KEY_SIGNALS = [
  /\bimportant\b/i,
  /\bcritical\b/i,
  /\bnote\b/i,
  /\bwarning\b/i,
  /\berror\b/i,
  /\bfail(?:ed|ure|s)?\b/i,
  /\bsuccess(?:ful(?:ly)?)?\b/i,
  /\bmust\b/i,
  /\bshould\b/i,
  /\brequire[ds]?\b/i,
  /\d+/,               // sentences containing numbers
  /\bcompleted?\b/i,
  /\bcreated?\b/i,
  /\bfixed?\b/i,
  /\bfound\b/i,
];

// Stop words excluded from frequency analysis
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "but", "and", "or", "if", "while", "although",
  "this", "that", "these", "those", "it", "its", "i", "me", "my",
  "we", "our", "you", "your", "he", "him", "his", "she", "her",
  "they", "them", "their", "what", "which", "who", "whom",
]);

// ---------------------------------------------------------------------------
// MemoryObserver
// ---------------------------------------------------------------------------

export class MemoryObserver {
  private readonly store: MemoryStore;
  private readonly config: ResolvedConfig;
  private reflectionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(store: MemoryStore, config?: ObservationConfig) {
    this.store = store;
    this.config = {
      minResultLength: config?.minResultLength ?? 200,
      maxObservationsPerNamespace: config?.maxObservationsPerNamespace ?? 50,
      reflectionInterval: config?.reflectionInterval ?? 300_000,
      autoReflect: config?.autoReflect ?? true,
    };

    if (this.config.autoReflect) {
      this.startReflectionLoop();
    }
  }

  // -----------------------------------------------------------------------
  // Observe
  // -----------------------------------------------------------------------

  /**
   * Observe a completed task and extract key learnings.
   * Called automatically after each agent task completion.
   * Creates L2 (raw) entries with the full result,
   * and L1 (working) entries with extracted key points.
   */
  async observe(
    agentId: string,
    task: string,
    result: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (result.length < this.config.minResultLength) return;

    const namespace = `observations.${agentId}`;
    const now = new Date().toISOString();
    const taskPreview = task.length > 120 ? task.slice(0, 120) + "..." : task;

    // --- L2: Store full raw result ---
    const l2Id = await this.store.write({
      namespace,
      title: `Observation: ${taskPreview}`,
      content: result,
      level: MemoryLevel.L2,
      metadata: {
        ...metadata,
        agentId,
        task,
        resultLength: result.length,
        observedAt: now,
        reflected: false,
      },
      source: `observer:${agentId}`,
    });

    // --- L1: Extract and store key points ---
    const keyPoints = this.extractKeyPoints(result);
    if (keyPoints.length > 0) {
      await this.store.write({
        namespace,
        title: `Key points: ${taskPreview}`,
        content: keyPoints.join("\n"),
        level: MemoryLevel.L1,
        parentId: l2Id,
        metadata: {
          ...metadata,
          agentId,
          task,
          pointCount: keyPoints.length,
          observedAt: now,
        },
        source: `observer:${agentId}`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Reflect
  // -----------------------------------------------------------------------

  /**
   * Reflect on accumulated observations and create L0 summaries.
   * Groups related observations, identifies patterns, and creates
   * concise summary entries that agents can quickly consume.
   * Uses heuristic text analysis (no LLM calls) for efficiency.
   */
  async reflect(): Promise<{ summarized: number; pruned: number }> {
    let summarized = 0;
    let pruned = 0;

    // Discover all observation namespaces
    const stats = this.store.stats();
    const observationNamespaces = Object.keys(stats.byNamespace).filter((ns) =>
      ns.startsWith("observations."),
    );

    for (const namespace of observationNamespaces) {
      // Get unprocessed L2 observations
      const allL2 = this.store.listByNamespace(namespace, MemoryLevel.L2);
      const unprocessed = allL2.filter(
        (entry) => !(entry.metadata as Record<string, unknown>)?.["reflected"],
      );

      if (unprocessed.length < 5) continue;

      // Extract agent ID from namespace
      const agentId = namespace.replace("observations.", "");

      // Gather all observation content for theme analysis
      const allContent = unprocessed.map((e) => e.content);
      const themes = this.findThemes(allContent);

      // Extract recent task descriptions
      const recentTasks = unprocessed
        .slice(0, 5)
        .map((e) => {
          const meta = e.metadata as Record<string, unknown>;
          const task = (meta?.["task"] as string) ?? e.title;
          return task.length > 80 ? task.slice(0, 80) + "..." : task;
        });

      // Build L0 summary content
      const summaryContent = [
        `${agentId} has completed ${unprocessed.length} tasks.`,
        themes.length > 0
          ? `Key patterns: ${themes.join(", ")}.`
          : "No strong recurring patterns detected.",
        `Recent focus: ${recentTasks.join("; ")}.`,
      ].join(" ");

      // Write or update the L0 summary
      await this.store.writeOrUpdate({
        namespace,
        title: `Summary: ${agentId} observations`,
        content: summaryContent,
        level: MemoryLevel.L0,
        metadata: {
          agentId,
          observationCount: unprocessed.length,
          themes,
          lastReflection: new Date().toISOString(),
        },
        source: `observer:${agentId}`,
      });
      summarized++;

      // Mark processed observations
      for (const entry of unprocessed) {
        await this.store.update(entry.id, {
          metadata: { reflected: true },
        });
      }

      // Prune old observations beyond the cap
      const prunedCount = this.store.prune(
        namespace,
        this.config.maxObservationsPerNamespace,
      );
      pruned += prunedCount;
    }

    return { summarized, pruned };
  }

  // -----------------------------------------------------------------------
  // Reflection loop
  // -----------------------------------------------------------------------

  /** Start the automatic reflection loop. */
  startReflectionLoop(): void {
    if (this.reflectionTimer) return;
    this.reflectionTimer = setInterval(() => {
      this.reflect().catch(() => {
        // Reflection is best-effort — swallow errors to keep the loop alive
      });
    }, this.config.reflectionInterval);

    // Allow the process to exit even if the timer is still active
    if (this.reflectionTimer && typeof this.reflectionTimer === "object" && "unref" in this.reflectionTimer) {
      this.reflectionTimer.unref();
    }
  }

  /** Stop the reflection loop. */
  stopReflectionLoop(): void {
    if (this.reflectionTimer) {
      clearInterval(this.reflectionTimer);
      this.reflectionTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /** Get observation stats. */
  getStats(): {
    totalObservations: number;
    totalSummaries: number;
    namespaces: string[];
  } {
    const storeStats = this.store.stats();
    const namespaces = Object.keys(storeStats.byNamespace).filter((ns) =>
      ns.startsWith("observations."),
    );

    let totalObservations = 0;
    let totalSummaries = 0;

    for (const ns of namespaces) {
      const l2 = this.store.listByNamespace(ns, MemoryLevel.L2);
      totalObservations += l2.length;

      const l0 = this.store.listByNamespace(ns, MemoryLevel.L0);
      totalSummaries += l0.length;
    }

    return { totalObservations, totalSummaries, namespaces };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Extract key sentences from a result string.
   * Picks the first sentence, the last sentence, and any sentence
   * that matches a key-signal pattern.
   */
  private extractKeyPoints(text: string): string[] {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    if (sentences.length === 0) return [];

    const selected = new Set<string>();

    // Always include first sentence (context/intro)
    selected.add(sentences[0]!);

    // Always include last sentence (conclusion/result)
    if (sentences.length > 1) {
      selected.add(sentences[sentences.length - 1]!);
    }

    // Include sentences matching key signals
    for (const sentence of sentences) {
      if (selected.size >= 10) break; // cap key points
      for (const signal of KEY_SIGNALS) {
        if (signal.test(sentence)) {
          selected.add(sentence);
          break;
        }
      }
    }

    return [...selected];
  }

  /**
   * Find common themes across multiple observation texts using
   * word-frequency analysis. Returns the top recurring meaningful words.
   */
  private findThemes(texts: string[]): string[] {
    const freq = new Map<string, number>();

    for (const text of texts) {
      // Get unique words per document (so a word repeated in one doc
      // doesn't dominate — we want cross-document frequency)
      const words = new Set(
        text
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
      );

      for (const word of words) {
        freq.set(word, (freq.get(word) ?? 0) + 1);
      }
    }

    // A theme must appear in at least 30% of the documents (min 2)
    const threshold = Math.max(2, Math.floor(texts.length * 0.3));

    return [...freq.entries()]
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word);
  }
}
