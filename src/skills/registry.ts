/**
 * HIVEMIND Skill Registry
 *
 * Central registry for skill definitions. Supports local registration,
 * remote marketplace discovery, dependency resolution, and query-based
 * lookups by agent type, tags, or free-text search.
 */

import type {
  SkillDefinition,
  SkillQuery,
  SkillSource,
  AgentRole,
} from "./types.js";

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

export class DependencyCycleError extends Error {
  constructor(public readonly chain: string[]) {
    super(`Dependency cycle detected: ${chain.join(" -> ")}`);
    this.name = "DependencyCycleError";
  }
}

export class MissingDependencyError extends Error {
  constructor(
    public readonly skill: string,
    public readonly missing: string,
  ) {
    super(`Skill "${skill}" depends on "${missing}" which is not registered`);
    this.name = "MissingDependencyError";
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();
  private readonly sources: SkillSource[] = [];

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /** Register or update a skill definition. */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.metadata.name, skill);
  }

  /** Remove a skill by name. */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /** Remove skills whose sourcePath is no longer under `dir`. */
  pruneBySourceDir(dir: string): string[] {
    const removed: string[] = [];

    for (const [name, skill] of this.skills) {
      if (skill.sourcePath.startsWith(dir)) {
        // We only prune if the file truly no longer exists on disk.
        // The loader is responsible for checking before calling this.
        this.skills.delete(name);
        removed.push(name);
      }
    }

    return removed;
  }

  // -----------------------------------------------------------------------
  // Lookup
  // -----------------------------------------------------------------------

  /** Retrieve a single skill by exact name. */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /** Return all registered skills. */
  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  /** Query skills by agent type, tags, or free-text search. */
  query(q: SkillQuery): SkillDefinition[] {
    let results = this.list();

    if (q.name) {
      const n = q.name.toLowerCase();
      results = results.filter((s) => s.metadata.name.includes(n));
    }

    if (q.agent) {
      results = results.filter((s) => s.metadata.agent === q.agent);
    }

    if (q.tags && q.tags.length > 0) {
      const tagSet = new Set(q.tags.map((t) => t.toLowerCase()));
      results = results.filter((s) =>
        s.metadata.tags?.some((t) => tagSet.has(t.toLowerCase())),
      );
    }

    if (q.search) {
      const terms = q.search.toLowerCase().split(/\s+/);
      results = results.filter((s) => {
        const haystack = [
          s.metadata.name,
          s.metadata.description,
          ...s.metadata.triggers,
          ...(s.metadata.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();

        return terms.every((term) => haystack.includes(term));
      });
    }

    return results;
  }

  /** Find skills whose triggers match a user prompt. */
  matchTriggers(prompt: string): SkillDefinition[] {
    const lower = prompt.toLowerCase();

    return this.list().filter((skill) =>
      skill.metadata.triggers.some((trigger) => lower.includes(trigger.toLowerCase())),
    );
  }

  // -----------------------------------------------------------------------
  // Dependency resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve the full dependency tree for a skill, returning an ordered list
   * where dependencies appear before dependents (topological sort).
   *
   * Throws `MissingDependencyError` if a dependency is not registered.
   * Throws `DependencyCycleError` if a cycle is detected.
   */
  resolveDependencies(name: string): SkillDefinition[] {
    const ordered: SkillDefinition[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (current: string, chain: string[]): void => {
      if (visited.has(current)) return;

      if (visiting.has(current)) {
        throw new DependencyCycleError([...chain, current]);
      }

      const skill = this.skills.get(current);
      if (!skill) {
        throw new MissingDependencyError(chain[chain.length - 1] ?? current, current);
      }

      visiting.add(current);

      for (const dep of skill.metadata.dependencies ?? []) {
        visit(dep, [...chain, current]);
      }

      visiting.delete(current);
      visited.add(current);
      ordered.push(skill);
    };

    visit(name, []);
    return ordered;
  }

  // -----------------------------------------------------------------------
  // Sources (local + remote marketplace)
  // -----------------------------------------------------------------------

  /** Register a skill source for discovery. */
  addSource(source: SkillSource): void {
    this.sources.push(source);
  }

  /** List configured sources. */
  getSources(): readonly SkillSource[] {
    return this.sources;
  }

  /**
   * Discover skills from all registered remote sources.
   * Returns metadata only — caller must install before use.
   */
  async discoverRemote(query?: string): Promise<RemoteSkillEntry[]> {
    const results: RemoteSkillEntry[] = [];

    for (const source of this.sources) {
      if (source.kind !== "remote") continue;

      try {
        const url = new URL("/api/skills/search", source.location);
        if (query) url.searchParams.set("q", query);

        const response = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) continue;

        const data = (await response.json()) as { skills: RemoteSkillEntry[] };
        results.push(...data.skills);
      } catch {
        // Silently skip unreachable marketplaces
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /** Summary counts by agent type. */
  stats(): Record<AgentRole | "total", number> {
    const counts: Record<string, number> = { total: this.skills.size };

    for (const skill of this.skills.values()) {
      counts[skill.metadata.agent] = (counts[skill.metadata.agent] ?? 0) + 1;
    }

    return counts as Record<AgentRole | "total", number>;
  }
}

// ---------------------------------------------------------------------------
// Remote marketplace types
// ---------------------------------------------------------------------------

export interface RemoteSkillEntry {
  name: string;
  version: string;
  description: string;
  agent: AgentRole;
  downloads: number;
  author: string;
  sourceUrl: string;
}
