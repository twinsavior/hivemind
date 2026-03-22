/**
 * HIVEMIND Skill Loader
 *
 * Loads skill definitions from Markdown files with YAML frontmatter,
 * validates their structure, registers them with the orchestrator,
 * and watches the filesystem for hot-reload.
 */

import { readFile, readdir, stat, watch } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SkillDefinition, SkillMetadata, AgentRole } from "./types.js";
import { SkillRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_AGENTS: Set<AgentRole> = new Set([
  "scout",
  "builder",
  "communicator",
  "monitor",
  "analyst",
  "coordinator",
]);

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class SkillValidationError extends Error {
  constructor(
    public readonly path: string,
    public readonly issues: string[],
  ) {
    super(`Invalid skill at ${path}: ${issues.join("; ")}`);
    this.name = "SkillValidationError";
  }
}

function validateMetadata(raw: Record<string, unknown>): string[] {
  const issues: string[] = [];

  if (typeof raw["name"] !== "string" || raw["name"].trim() === "") {
    issues.push("'name' is required and must be a non-empty string");
  } else if (!/^[a-z0-9-]+$/.test(raw["name"])) {
    issues.push("'name' must be kebab-case (lowercase alphanumeric + hyphens)");
  }

  if (typeof raw["version"] !== "string" || !/^\d+\.\d+\.\d+/.test(raw["version"])) {
    issues.push("'version' must be a valid semver string");
  }

  if (typeof raw["agent"] !== "string" || !VALID_AGENTS.has(raw["agent"] as AgentRole)) {
    issues.push(`'agent' must be one of: ${[...VALID_AGENTS].join(", ")}`);
  }

  if (typeof raw["description"] !== "string" || raw["description"].trim() === "") {
    issues.push("'description' is required");
  }

  if (!Array.isArray(raw["triggers"]) || raw["triggers"].length === 0) {
    issues.push("'triggers' must be a non-empty array of strings");
  }

  if (raw["timeout"] !== undefined && (typeof raw["timeout"] !== "number" || raw["timeout"] <= 0)) {
    issues.push("'timeout' must be a positive number");
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function parseSkillFile(filePath: string, content: string): SkillDefinition {
  const match = content.match(FRONTMATTER_RE);

  if (!match) {
    throw new SkillValidationError(filePath, [
      "File must contain YAML frontmatter delimited by ---",
    ]);
  }

  const [, frontmatterRaw, instructions] = match;

  let rawMeta: Record<string, unknown>;
  try {
    rawMeta = parseYaml(frontmatterRaw!) as Record<string, unknown>;
  } catch (err) {
    throw new SkillValidationError(filePath, [
      `Invalid YAML frontmatter: ${(err as Error).message}`,
    ]);
  }

  const issues = validateMetadata(rawMeta);
  if (issues.length > 0) {
    throw new SkillValidationError(filePath, issues);
  }

  const metadata: SkillMetadata = {
    name: rawMeta["name"] as string,
    version: rawMeta["version"] as string,
    agent: rawMeta["agent"] as AgentRole,
    description: rawMeta["description"] as string,
    triggers: rawMeta["triggers"] as string[],
    dependencies: (rawMeta["dependencies"] as string[]) ?? [],
    requiredSecrets: (rawMeta["requiredSecrets"] as string[]) ?? [],
    timeout: (rawMeta["timeout"] as number) ?? 300,
    tags: (rawMeta["tags"] as string[]) ?? [],
    author: (rawMeta["author"] as string) ?? "hivemind",
  };

  return {
    metadata,
    instructions: instructions!.trim(),
    sourcePath: resolve(filePath),
    contentHash: hashContent(content),
    loadedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface LoaderOptions {
  /** Directories to scan for skill files */
  skillDirs: string[];
  /** Whether to watch for changes and hot-reload */
  watch?: boolean;
  /** Callback invoked on load errors (default: console.error) */
  onError?: (error: Error) => void;
}

export class SkillLoader {
  private readonly registry: SkillRegistry;
  private readonly options: LoaderOptions;
  private readonly abortController = new AbortController();
  private readonly onError: (error: Error) => void;

  constructor(registry: SkillRegistry, options: LoaderOptions) {
    this.registry = registry;
    this.options = options;
    this.onError = options.onError ?? ((e) => console.error("[SkillLoader]", e.message));
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Scan all configured directories and load every .md skill file. */
  async loadAll(): Promise<SkillDefinition[]> {
    const loaded: SkillDefinition[] = [];

    for (const dir of this.options.skillDirs) {
      const skills = await this.loadDirectory(dir);
      loaded.push(...skills);
    }

    if (this.options.watch) {
      this.startWatching();
    }

    return loaded;
  }

  /** Load a single skill file by path. */
  async loadFile(filePath: string): Promise<SkillDefinition | null> {
    try {
      const content = await readFile(filePath, "utf-8");
      const skill = parseSkillFile(filePath, content);

      // Skip if content hasn't changed (same hash already registered)
      const existing = this.registry.get(skill.metadata.name);
      if (existing && existing.contentHash === skill.contentHash) {
        return existing;
      }

      this.registry.register(skill);
      return skill;
    } catch (err) {
      this.onError(err as Error);
      return null;
    }
  }

  /** Stop watching for file changes and release resources. */
  stop(): void {
    this.abortController.abort();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async loadDirectory(dir: string): Promise<SkillDefinition[]> {
    const loaded: SkillDefinition[] = [];

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      this.onError(new Error(`Skill directory not found: ${dir}`));
      return loaded;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const info = await stat(fullPath);

      if (info.isDirectory()) {
        // Recurse into subdirectories
        const nested = await this.loadDirectory(fullPath);
        loaded.push(...nested);
      } else if (info.isFile() && extname(entry) === ".md") {
        const skill = await this.loadFile(fullPath);
        if (skill) loaded.push(skill);
      }
    }

    return loaded;
  }

  private startWatching(): void {
    for (const dir of this.options.skillDirs) {
      this.watchDirectory(dir).catch(this.onError);
    }
  }

  private async watchDirectory(dir: string): Promise<void> {
    try {
      const watcher = watch(dir, {
        recursive: true,
        signal: this.abortController.signal,
      });

      for await (const event of watcher) {
        if (event.filename && extname(event.filename) === ".md") {
          const filePath = join(dir, event.filename);

          try {
            await stat(filePath);
            // File exists — load or reload
            const skill = await this.loadFile(filePath);
            if (skill) {
              console.log(`[SkillLoader] Reloaded: ${skill.metadata.name}`);
            }
          } catch {
            // File was deleted — unregister by scanning for orphans
            this.registry.pruneBySourceDir(dir);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        this.onError(err as Error);
      }
    }
  }
}
