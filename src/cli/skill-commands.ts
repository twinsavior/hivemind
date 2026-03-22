/**
 * HIVEMIND Skill CLI Commands
 *
 * Provides marketplace-powered skill management:
 *   hivemind skill search <query>
 *   hivemind skill install <name> [--version x.y.z]
 *   hivemind skill publish <path>
 *   hivemind skill list [--remote]
 *   hivemind skill update [name]
 *   hivemind skill uninstall <name>
 *   hivemind skill info <name>
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { info, success, warn, error, spinner, table, log } from "./index.js";
import { SkillMarketplace } from "../skills/marketplace.js";
import { SkillPackager } from "../skills/skill-packager.js";
import type { MarketplaceConfig } from "../skills/marketplace.js";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getMarketplaceConfig(): MarketplaceConfig {
  const home = homedir();
  const configPath = path.join(home, ".hivemind", "marketplace.json");

  let registryUrl = "http://localhost:4100";
  let authToken: string | undefined;

  // Try to read config from file
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      if (typeof raw["registryUrl"] === "string") registryUrl = raw["registryUrl"];
      if (typeof raw["authToken"] === "string") authToken = raw["authToken"];
    }
  } catch {
    // Use defaults
  }

  // Environment variables override file config
  if (process.env["HIVEMIND_REGISTRY_URL"]) {
    registryUrl = process.env["HIVEMIND_REGISTRY_URL"];
  }
  if (process.env["HIVEMIND_AUTH_TOKEN"]) {
    authToken = process.env["HIVEMIND_AUTH_TOKEN"];
  }

  return {
    registryUrl,
    cacheDir: path.join(home, ".hivemind", "skill-cache"),
    authToken,
    skillsDir: path.resolve("skills"),
  };
}

function getMarketplace(): SkillMarketplace {
  return new SkillMarketplace(getMarketplaceConfig());
}

// ---------------------------------------------------------------------------
// skill search <query>
// ---------------------------------------------------------------------------

interface SkillSearchOptions {
  agent?: string;
  tags?: string;
  limit?: string;
}

export async function skillSearchCommand(
  query: string,
  options: SkillSearchOptions,
): Promise<void> {
  const marketplace = getMarketplace();
  const s = spinner(`Searching marketplace for "${query}"...`);

  try {
    const skills = await marketplace.search(query, {
      agent: options.agent,
      tags: options.tags?.split(",").map((t) => t.trim()),
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    });

    if (skills.length === 0) {
      s.succeed("Search complete");
      warn(`No skills found matching "${query}"`);
      info("Try a broader search term or check the marketplace URL in your config.");
      return;
    }

    s.succeed(`Found ${skills.length} skill${skills.length === 1 ? "" : "s"}`);
    log("");

    table(
      ["Name", "Version", "Agent", "Stars", "Downloads", "Description"],
      skills.map((skill) => [
        skill.name,
        skill.version,
        skill.agent,
        String(skill.stars),
        String(skill.downloads),
        skill.description.length > 50
          ? skill.description.slice(0, 47) + "..."
          : skill.description,
      ]),
    );

    log("");
    info('Run "hivemind skill install <name>" to install a skill');
  } catch (err) {
    s.fail("Search failed");
    error((err as Error).message);
    info("Is the marketplace server running? Check your registry URL.");
  }
}

// ---------------------------------------------------------------------------
// skill install <name>
// ---------------------------------------------------------------------------

interface SkillInstallOptions {
  version?: string;
  from?: string;
}

export async function skillInstallCommand(
  name: string,
  options: SkillInstallOptions,
): Promise<void> {
  const marketplace = getMarketplace();

  // If --from is a local path or git URL, delegate to the original skillAddCommand behavior
  if (options.from) {
    const source = options.from;
    const s = spinner(`Installing skill "${name}" from ${source}...`);
    const skillsDir = path.resolve("skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    const targetDir = path.join(skillsDir, name);

    if (fs.existsSync(targetDir)) {
      s.fail(`Skill "${name}" is already installed at ${targetDir}`);
      return;
    }

    try {
      if (source.startsWith("http://") || source.startsWith("https://") || source.startsWith("git@")) {
        s.update(`Cloning ${source}...`);
        const { spawnSync } = await import("child_process");
        const result = spawnSync("git", ["clone", "--depth", "1", source, targetDir], { stdio: "pipe" });
        if (result.status !== 0) {
          throw new Error(result.stderr?.toString().trim() || `git clone exited with code ${result.status}`);
        }
      } else if (fs.existsSync(source)) {
        s.update(`Copying from ${source}...`);
        fs.cpSync(source, targetDir, { recursive: true });
      } else {
        throw new Error(`Source not found: ${source}`);
      }

      s.succeed(`Skill "${name}" installed from ${source}`);
      info(`Skill directory: ${targetDir}/`);
    } catch (err) {
      s.fail(`Failed: ${(err as Error).message}`);
    }
    return;
  }

  // Install from marketplace
  const s = spinner(`Installing "${name}" from marketplace...`);

  try {
    const result = await marketplace.install(name, options.version);
    s.succeed(`Skill "${result.installed}" v${result.version} installed`);
    info(`Path: ${result.path}`);
    info("The skill is now available to your agents.");
  } catch (err) {
    s.fail(`Install failed`);
    error((err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// skill publish <path>
// ---------------------------------------------------------------------------

export async function skillPublishCommand(skillPath: string): Promise<void> {
  const marketplace = getMarketplace();
  const packager = new SkillPackager();
  const resolvedPath = path.resolve(skillPath);

  // Validate first
  const s = spinner("Validating skill...");

  const validation = await packager.validate(resolvedPath);

  if (validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      warn(w);
    }
  }

  if (!validation.valid) {
    s.fail("Skill validation failed");
    for (const e of validation.errors) {
      error(`  ${e}`);
    }
    return;
  }

  s.succeed(`Validation passed: ${validation.metadata!.name} v${validation.metadata!.version}`);

  // Publish
  const ps = spinner("Publishing to marketplace...");

  try {
    const result = await marketplace.publish(resolvedPath);
    ps.succeed(`Published "${result.published}" v${result.version}`);
    info("Your skill is now available in the marketplace!");
  } catch (err) {
    ps.fail("Publish failed");
    error((err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// skill list [--remote]
// ---------------------------------------------------------------------------

interface SkillListExtendedOptions {
  remote?: boolean;
  available?: boolean;
}

export async function skillListExtendedCommand(options: SkillListExtendedOptions): Promise<void> {
  if (options.remote || options.available) {
    // List from marketplace
    const marketplace = getMarketplace();
    const s = spinner("Fetching skills from marketplace...");

    try {
      const skills = await marketplace.popular(30);
      s.succeed(`${skills.length} skills available in marketplace`);
      log("");

      table(
        ["Name", "Version", "Agent", "Stars", "Downloads", "Author"],
        skills.map((skill) => [
          skill.name,
          skill.version,
          skill.agent,
          String(skill.stars),
          String(skill.downloads),
          skill.author,
        ]),
      );

      log("");
      info('Run "hivemind skill install <name>" to install a skill');
    } catch (err) {
      s.fail("Failed to fetch remote skills");
      error((err as Error).message);
      info("Is the marketplace server running?");
    }
    return;
  }

  // List locally installed skills
  const skillsDir = path.resolve("skills");
  if (!fs.existsSync(skillsDir)) {
    warn("No skills directory found. Run 'hivemind init' first.");
    return;
  }

  const entries = fs.readdirSync(skillsDir).filter((entry) => {
    return fs.statSync(path.join(skillsDir, entry)).isDirectory();
  });

  if (entries.length === 0) {
    info('No skills installed. Run "hivemind skill add <name>" to install one.');
    return;
  }

  const rows: string[][] = [];

  for (const entry of entries) {
    const skillDir = path.join(skillsDir, entry);
    let version = "-";
    let agent = "-";
    let source = "local";

    // Try to read version from installed manifest
    const manifestPath = path.join(skillDir, ".hivemind-installed.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        version = manifest.version ?? "-";
        source = "marketplace";
      } catch {
        // Skip
      }
    }

    // Try to read metadata from SKILL.md or any .md
    for (const mdFile of ["SKILL.md", ...fs.readdirSync(skillDir).filter((f) => f.endsWith(".md"))]) {
      const mdPath = path.join(skillDir, mdFile);
      if (!fs.existsSync(mdPath)) continue;
      try {
        const content = fs.readFileSync(mdPath, "utf-8");
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          const verMatch = fmMatch[1]!.match(/version:\s*["']?(.+?)["']?\s*$/m);
          const agentMatch = fmMatch[1]!.match(/agent:\s*["']?(.+?)["']?\s*$/m);
          if (verMatch?.[1]) version = verMatch[1];
          if (agentMatch?.[1]) agent = agentMatch[1];
          break;
        }
      } catch {
        // Skip
      }
    }

    rows.push([entry, version, agent, source]);
  }

  table(
    ["Name", "Version", "Agent", "Source"],
    rows,
  );
}

// ---------------------------------------------------------------------------
// skill update [name]
// ---------------------------------------------------------------------------

export async function skillUpdateCommand(name?: string): Promise<void> {
  const marketplace = getMarketplace();

  const s = spinner("Checking for updates...");

  try {
    const updates = await marketplace.checkUpdates();

    if (name) {
      const specific = updates.filter((u) => u.name === name);
      if (specific.length === 0) {
        s.succeed(`"${name}" is up to date`);
        return;
      }
    }

    if (updates.length === 0) {
      s.succeed("All skills are up to date");
      return;
    }

    s.succeed(`Found ${updates.length} update${updates.length === 1 ? "" : "s"}`);
    log("");

    table(
      ["Name", "Current", "Latest"],
      updates.map((u) => [u.name, u.current, u.latest]),
    );
    log("");

    // Perform updates
    const us = spinner("Updating skills...");
    const results = await marketplace.update(name);

    us.succeed(`Updated ${results.length} skill${results.length === 1 ? "" : "s"}`);
    for (const r of results) {
      info(`  ${r.installed} -> v${r.version}`);
    }
  } catch (err) {
    s.fail("Update check failed");
    error((err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// skill uninstall <name>
// ---------------------------------------------------------------------------

export async function skillUninstallCommand(name: string): Promise<void> {
  const marketplace = getMarketplace();
  const s = spinner(`Uninstalling "${name}"...`);

  try {
    const removed = await marketplace.uninstall(name);
    if (removed) {
      s.succeed(`Skill "${name}" uninstalled`);
    } else {
      s.fail(`Skill "${name}" is not installed`);
    }
  } catch (err) {
    s.fail(`Uninstall failed`);
    error((err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// skill info <name>
// ---------------------------------------------------------------------------

export async function skillInfoCommand(name: string): Promise<void> {
  const marketplace = getMarketplace();

  // First check if it's installed locally
  const skillsDir = path.resolve("skills");
  const localDir = path.join(skillsDir, name);
  const isLocal = fs.existsSync(localDir);

  // Try to fetch from marketplace
  const s = spinner(`Fetching info for "${name}"...`);

  try {
    const details = await marketplace.details(name);

    if (details) {
      s.succeed(`Skill: ${details.name}`);
      log("");
      log(`  Version:      ${details.version}`);
      log(`  Agent:        ${details.agent}`);
      log(`  Author:       ${details.author}`);
      log(`  Description:  ${details.description}`);
      log(`  Downloads:    ${details.downloads}`);
      log(`  Stars:        ${details.stars}`);
      log(`  Tags:         ${details.tags.join(", ") || "none"}`);
      log(`  Published:    ${details.publishedAt}`);
      log(`  Dependencies: ${details.dependencies.length > 0 ? details.dependencies.join(", ") : "none"}`);
      log(`  Installed:    ${isLocal ? "yes (" + localDir + ")" : "no"}`);

      if (details.readme) {
        log("");
        log("  --- README ---");
        // Show first 20 lines of readme
        const lines = details.readme.split("\n").slice(0, 20);
        for (const line of lines) {
          log(`  ${line}`);
        }
        if (details.readme.split("\n").length > 20) {
          log("  ... (truncated)");
        }
      }
    } else if (isLocal) {
      s.succeed(`Skill: ${name} (local only)`);
      log("");
      log(`  Path: ${localDir}`);
      log("  This skill is not published to the marketplace.");

      // Read local metadata
      for (const mdFile of ["SKILL.md", ...fs.readdirSync(localDir).filter((f) => f.endsWith(".md"))]) {
        const mdPath = path.join(localDir, mdFile);
        if (!fs.existsSync(mdPath)) continue;
        try {
          const content = fs.readFileSync(mdPath, "utf-8");
          const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (fmMatch) {
            log(`  Metadata from ${mdFile}:`);
            for (const line of fmMatch[1]!.trim().split("\n")) {
              log(`    ${line}`);
            }
            break;
          }
        } catch {
          // Skip
        }
      }
    } else {
      s.fail(`Skill "${name}" not found locally or in marketplace`);
    }
  } catch {
    // Marketplace unreachable — fall back to local info
    if (isLocal) {
      s.succeed(`Skill: ${name} (local)`);
      log(`  Path: ${localDir}`);
      warn("Could not reach marketplace for additional details.");
    } else {
      s.fail(`Skill "${name}" not found and marketplace is unreachable`);
    }
  }
}
