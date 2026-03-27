/**
 * HIVEMIND Skill Pack Manager
 *
 * Manages external skill packs installed from git repositories.
 * Packs are cloned into ~/.hivemind/skills/<pack-name>/
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface SkillPack {
  name: string;
  gitUrl: string;
  localPath: string;
  version?: string;
  skillCount: number;
  installedAt: string;
  updatedAt: string;
}

export interface PackManifest {
  packs: Record<
    string,
    {
      gitUrl: string;
      installedAt: string;
      updatedAt: string;
    }
  >;
}

export class SkillPackManager {
  private readonly baseDir: string;
  private readonly manifestPath: string;

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ||
      path.join(process.env["HOME"] || "", ".hivemind", "skills");
    this.manifestPath = path.join(this.baseDir, "manifest.json");
  }

  /** Ensure base directory exists */
  private ensureBaseDir(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /** Load or create manifest */
  private loadManifest(): PackManifest {
    if (fs.existsSync(this.manifestPath)) {
      return JSON.parse(fs.readFileSync(this.manifestPath, "utf-8")) as PackManifest;
    }
    return { packs: {} };
  }

  /** Save manifest */
  private saveManifest(manifest: PackManifest): void {
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2));
  }

  /** Extract pack name from git URL */
  private getPackName(gitUrl: string): string {
    // https://github.com/garrytan/gstack -> gstack
    // https://github.com/someone/marketing-skills.git -> marketing-skills
    const match = gitUrl.match(/\/([^/]+?)(\.git)?$/);
    return match?.[1] ?? "unknown-pack";
  }

  /** Count SKILL.md files recursively */
  private countSkills(dir: string): number {
    let count = 0;
    const scan = (d: string): void => {
      for (const entry of fs.readdirSync(d)) {
        const full = path.join(d, entry);
        if (entry === "node_modules" || entry === ".git") continue;
        if (fs.statSync(full).isDirectory()) {
          scan(full);
        } else if (entry === "SKILL.md") {
          count++;
        }
      }
    };
    scan(dir);
    return count;
  }

  /** Read version from a pack directory (VERSION file or package.json) */
  private readVersion(packPath: string): string | undefined {
    const versionFile = path.join(packPath, "VERSION");
    const packageJson = path.join(packPath, "package.json");
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, "utf-8").trim();
    }
    if (fs.existsSync(packageJson)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJson, "utf-8")) as Record<string, unknown>;
        if (typeof pkg["version"] === "string") return pkg["version"];
      } catch {
        /* ignore */
      }
    }
    return undefined;
  }

  /** Install a skill pack from a git URL */
  async add(gitUrl: string, name?: string): Promise<SkillPack> {
    this.ensureBaseDir();
    const packName = name || this.getPackName(gitUrl);
    const packPath = path.join(this.baseDir, packName);

    if (fs.existsSync(packPath)) {
      throw new Error(
        `Pack "${packName}" already installed at ${packPath}. Use 'skills update ${packName}' to update.`,
      );
    }

    // Clone the repo
    try {
      execSync(`git clone "${gitUrl}" "${packPath}"`, {
        stdio: "pipe",
        timeout: 60000,
      });
    } catch (err: unknown) {
      throw new Error(
        `Failed to clone ${gitUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const version = this.readVersion(packPath);
    const skillCount = this.countSkills(packPath);
    const now = new Date().toISOString();

    // Update manifest
    const manifest = this.loadManifest();
    manifest.packs[packName] = {
      gitUrl,
      installedAt: now,
      updatedAt: now,
    };
    this.saveManifest(manifest);

    // Run setup script if it exists
    const setupScript = path.join(packPath, "setup");
    if (fs.existsSync(setupScript)) {
      try {
        execSync(`chmod +x "${setupScript}" && "${setupScript}"`, {
          cwd: packPath,
          stdio: "pipe",
          timeout: 120000,
        });
      } catch {
        // Setup is optional -- don't fail the install
      }
    }

    return {
      name: packName,
      gitUrl,
      localPath: packPath,
      version,
      skillCount,
      installedAt: now,
      updatedAt: now,
    };
  }

  /** Update a skill pack (or all packs) */
  async update(packName?: string): Promise<SkillPack[]> {
    const manifest = this.loadManifest();
    const packsToUpdate = packName
      ? [packName]
      : Object.keys(manifest.packs);

    const results: SkillPack[] = [];

    for (const name of packsToUpdate) {
      const packInfo = manifest.packs[name];
      if (!packInfo) {
        throw new Error(
          `Pack "${name}" not found. Run 'skills list' to see installed packs.`,
        );
      }

      const packPath = path.join(this.baseDir, name);
      if (!fs.existsSync(packPath)) {
        throw new Error(
          `Pack directory missing: ${packPath}. Re-install with 'skills add ${packInfo.gitUrl}'`,
        );
      }

      try {
        execSync("git pull --ff-only", {
          cwd: packPath,
          stdio: "pipe",
          timeout: 30000,
        });
      } catch (err: unknown) {
        throw new Error(
          `Failed to update ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const version = this.readVersion(packPath);
      const now = new Date().toISOString();
      manifest.packs[name]!.updatedAt = now;

      results.push({
        name,
        gitUrl: packInfo.gitUrl,
        localPath: packPath,
        version,
        skillCount: this.countSkills(packPath),
        installedAt: packInfo.installedAt,
        updatedAt: now,
      });
    }

    this.saveManifest(manifest);
    return results;
  }

  /** List all installed packs */
  list(): SkillPack[] {
    const manifest = this.loadManifest();
    const results: SkillPack[] = [];

    for (const [name, info] of Object.entries(manifest.packs)) {
      const packPath = path.join(this.baseDir, name);
      let version: string | undefined;
      let skillCount = 0;

      if (fs.existsSync(packPath)) {
        version = this.readVersion(packPath);
        skillCount = this.countSkills(packPath);
      }

      results.push({
        name,
        gitUrl: info.gitUrl,
        localPath: packPath,
        version,
        skillCount,
        installedAt: info.installedAt,
        updatedAt: info.updatedAt,
      });
    }

    return results;
  }

  /** Remove a skill pack */
  async remove(packName: string): Promise<void> {
    const manifest = this.loadManifest();
    if (!manifest.packs[packName]) {
      throw new Error(`Pack "${packName}" not found.`);
    }

    const packPath = path.join(this.baseDir, packName);
    if (fs.existsSync(packPath)) {
      fs.rmSync(packPath, { recursive: true, force: true });
    }

    delete manifest.packs[packName];
    this.saveManifest(manifest);
  }

  /** Get the base directory path */
  getBaseDir(): string {
    return this.baseDir;
  }
}
