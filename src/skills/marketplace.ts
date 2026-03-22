/**
 * HIVEMIND Skill Marketplace Client
 *
 * Connects to a HIVEMIND skill marketplace (self-hosted or remote) to
 * search, install, publish, update, and rate skills.
 */

import { readFile, readdir, stat, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentRole } from "./types.js";
import { SkillPackager } from "./skill-packager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketplaceConfig {
  /** Base URL of the marketplace API (e.g. "http://localhost:4100") */
  registryUrl: string;
  /** Local cache directory for downloaded packages */
  cacheDir: string;
  /** Authentication token for publishing */
  authToken?: string;
  /** Local skills directory where skills are installed */
  skillsDir?: string;
}

export interface PublishedSkill {
  name: string;
  version: string;
  description: string;
  agent: AgentRole;
  author: string;
  downloads: number;
  stars: number;
  sourceUrl: string;
  readme: string;
  publishedAt: string;
  tags: string[];
  dependencies: string[];
}

export interface SearchFilters {
  agent?: string;
  tags?: string[];
  sort?: "downloads" | "stars" | "recent" | "name";
  limit?: number;
  offset?: number;
}

export interface InstallResult {
  installed: string;
  path: string;
  version: string;
}

export interface UpdateInfo {
  name: string;
  current: string;
  latest: string;
}

// ---------------------------------------------------------------------------
// Installed skill manifest (written to .hivemind-installed.json in skill dir)
// ---------------------------------------------------------------------------

interface InstalledManifest {
  name: string;
  version: string;
  installedAt: string;
  source: string;
}

// ---------------------------------------------------------------------------
// SkillMarketplace
// ---------------------------------------------------------------------------

export class SkillMarketplace {
  private readonly config: MarketplaceConfig;
  private readonly packager: SkillPackager;
  private readonly skillsDir: string;

  constructor(config: MarketplaceConfig) {
    this.config = config;
    this.packager = new SkillPackager();
    this.skillsDir = config.skillsDir ?? resolve("skills");
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  /**
   * Search the marketplace for skills matching a query and/or filters.
   */
  async search(query?: string, filters?: SearchFilters): Promise<PublishedSkill[]> {
    const url = new URL("/api/skills/search", this.config.registryUrl);

    if (query) url.searchParams.set("q", query);
    if (filters?.agent) url.searchParams.set("agent", filters.agent);
    if (filters?.tags?.length) url.searchParams.set("tags", filters.tags.join(","));
    if (filters?.sort) url.searchParams.set("sort", filters.sort);
    if (filters?.limit) url.searchParams.set("limit", String(filters.limit));
    if (filters?.offset) url.searchParams.set("offset", String(filters.offset));

    const response = await this.fetch(url.toString());
    const data = (await response.json()) as { skills: PublishedSkill[] };
    return data.skills;
  }

  // -----------------------------------------------------------------------
  // Install
  // -----------------------------------------------------------------------

  /**
   * Install a skill from the marketplace into the local skills/ directory.
   */
  async install(name: string, version?: string): Promise<InstallResult> {
    // Check if already installed
    const existingDir = join(this.skillsDir, name);
    try {
      const s = await stat(existingDir);
      if (s.isDirectory()) {
        throw new Error(`Skill "${name}" is already installed at ${existingDir}. Uninstall first or use update.`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    // Download the skill package
    const downloadUrl = new URL(`/api/skills/${encodeURIComponent(name)}/download`, this.config.registryUrl);
    if (version) downloadUrl.searchParams.set("version", version);

    const response = await this.fetch(downloadUrl.toString());

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Skill "${name}" not found in the marketplace`);
      }
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Cache the package
    await mkdir(this.config.cacheDir, { recursive: true });
    const cacheFile = join(this.config.cacheDir, `${name}-${version ?? "latest"}.hmpkg`);
    await writeFile(cacheFile, buffer);

    // Unpack into skills directory
    await mkdir(this.skillsDir, { recursive: true });
    const installedPath = await this.packager.unpack(buffer, this.skillsDir);

    // Read the manifest to get the version
    const manifest = await this.packager.readManifest(buffer);

    // Write the installed manifest for tracking
    const installedManifest: InstalledManifest = {
      name: manifest.name,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      source: this.config.registryUrl,
    };
    await writeFile(
      join(installedPath, ".hivemind-installed.json"),
      JSON.stringify(installedManifest, null, 2),
    );

    return {
      installed: manifest.name,
      path: installedPath,
      version: manifest.version,
    };
  }

  // -----------------------------------------------------------------------
  // Publish
  // -----------------------------------------------------------------------

  /**
   * Publish a local skill to the marketplace.
   * Requires an auth token in the config.
   */
  async publish(skillPath: string): Promise<{ published: string; version: string }> {
    if (!this.config.authToken) {
      throw new Error("Authentication token required for publishing. Set authToken in marketplace config.");
    }

    // Validate the skill first
    const validation = await this.packager.validate(skillPath);
    if (!validation.valid || !validation.metadata) {
      throw new Error(`Cannot publish invalid skill:\n  ${validation.errors.join("\n  ")}`);
    }

    // Package it
    const packageData = await this.packager.pack(skillPath);

    // Upload to marketplace
    const url = new URL("/api/skills/publish", this.config.registryUrl);

    const response = await this.fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Skill-Name": validation.metadata.name,
        "X-Skill-Version": validation.metadata.version,
      },
      body: packageData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Publish failed: ${response.status} ${body}`);
    }

    const result = (await response.json()) as { name: string; version: string };
    return { published: result.name, version: result.version };
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  /**
   * Check for updates to locally installed skills.
   */
  async checkUpdates(): Promise<UpdateInfo[]> {
    const updates: UpdateInfo[] = [];
    const installed = await this.listInstalled();

    for (const skill of installed) {
      try {
        const remote = await this.details(skill.name);
        if (remote && remote.version !== skill.version) {
          updates.push({
            name: skill.name,
            current: skill.version,
            latest: remote.version,
          });
        }
      } catch {
        // Skip skills that aren't in the marketplace (local-only)
      }
    }

    return updates;
  }

  /**
   * Update a specific skill (or all if name is omitted).
   */
  async update(name?: string): Promise<InstallResult[]> {
    const updates = await this.checkUpdates();
    const toUpdate = name ? updates.filter((u) => u.name === name) : updates;
    const results: InstallResult[] = [];

    for (const update of toUpdate) {
      // Uninstall old version
      await this.uninstall(update.name);
      // Install new version
      const result = await this.install(update.name, update.latest);
      results.push(result);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Uninstall
  // -----------------------------------------------------------------------

  /**
   * Uninstall a locally installed skill.
   */
  async uninstall(name: string): Promise<boolean> {
    const skillDir = join(this.skillsDir, name);

    try {
      const s = await stat(skillDir);
      if (!s.isDirectory()) return false;
    } catch {
      return false;
    }

    await rm(skillDir, { recursive: true, force: true });
    return true;
  }

  // -----------------------------------------------------------------------
  // Details
  // -----------------------------------------------------------------------

  /**
   * Get full details for a specific skill from the marketplace.
   */
  async details(name: string): Promise<PublishedSkill | null> {
    const url = new URL(`/api/skills/${encodeURIComponent(name)}`, this.config.registryUrl);

    try {
      const response = await this.fetch(url.toString());
      if (!response.ok) return null;
      return (await response.json()) as PublishedSkill;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Rate
  // -----------------------------------------------------------------------

  /**
   * Rate a skill on the marketplace (1-5 stars).
   */
  async rate(name: string, stars: number): Promise<void> {
    if (stars < 1 || stars > 5 || !Number.isInteger(stars)) {
      throw new Error("Rating must be an integer between 1 and 5");
    }

    const url = new URL(`/api/skills/${encodeURIComponent(name)}/rate`, this.config.registryUrl);

    const response = await this.fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars }),
    });

    if (!response.ok) {
      throw new Error(`Rating failed: ${response.status}`);
    }
  }

  // -----------------------------------------------------------------------
  // Featured / Popular / Recent
  // -----------------------------------------------------------------------

  async featured(): Promise<PublishedSkill[]> {
    const url = new URL("/api/skills/featured", this.config.registryUrl);
    const response = await this.fetch(url.toString());
    const data = (await response.json()) as { skills: PublishedSkill[] };
    return data.skills;
  }

  async popular(limit = 20): Promise<PublishedSkill[]> {
    const url = new URL("/api/skills/popular", this.config.registryUrl);
    url.searchParams.set("limit", String(limit));
    const response = await this.fetch(url.toString());
    const data = (await response.json()) as { skills: PublishedSkill[] };
    return data.skills;
  }

  async recent(limit = 20): Promise<PublishedSkill[]> {
    const url = new URL("/api/skills/recent", this.config.registryUrl);
    url.searchParams.set("limit", String(limit));
    const response = await this.fetch(url.toString());
    const data = (await response.json()) as { skills: PublishedSkill[] };
    return data.skills;
  }

  // -----------------------------------------------------------------------
  // Local helpers
  // -----------------------------------------------------------------------

  /**
   * List all locally installed marketplace skills (those with .hivemind-installed.json).
   */
  async listInstalled(): Promise<InstalledManifest[]> {
    const installed: InstalledManifest[] = [];

    try {
      const entries = await readdir(this.skillsDir);

      for (const entry of entries) {
        const manifestPath = join(this.skillsDir, entry, ".hivemind-installed.json");
        try {
          const raw = await readFile(manifestPath, "utf-8");
          const manifest = JSON.parse(raw) as InstalledManifest;
          installed.push(manifest);
        } catch {
          // Not a marketplace-installed skill, skip
        }
      }
    } catch {
      // Skills dir doesn't exist
    }

    return installed;
  }

  /**
   * Check if a specific skill is installed locally.
   */
  async isInstalled(name: string): Promise<boolean> {
    const skillDir = join(this.skillsDir, name);
    try {
      const s = await stat(skillDir);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // HTTP helper
  // -----------------------------------------------------------------------

  private async fetch(url: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    };

    if (this.config.authToken) {
      headers["Authorization"] = `Bearer ${this.config.authToken}`;
    }

    const response = await globalThis.fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    return response;
  }
}
