/**
 * HIVEMIND Skill Packager
 *
 * Packages skills into distributable archives (zip), validates skill
 * structure before publishing, and unpacks downloaded skill packages
 * into the local skills/ directory.
 */

import { readFile, readdir, stat, writeFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, basename, extname, relative, sep } from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parse as parseYaml } from "yaml";
import type { AgentRole, SkillMetadata } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_AGENTS: Set<string> = new Set([
  "scout",
  "builder",
  "communicator",
  "monitor",
  "analyst",
  "coordinator",
]);

const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Patterns that should never appear in skill instructions.
 * Blocks common prompt injection / dangerous system patterns.
 */
const DANGEROUS_PATTERNS = [
  /process\.exit/i,
  /child_process/i,
  /require\s*\(\s*['"]fs['"]\s*\)/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /rm\s+-rf\s+\//i,
  /sudo\s+/i,
  /chmod\s+777/i,
  /\/etc\/passwd/i,
  /\/etc\/shadow/i,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata?: SkillMetadata;
}

export interface PackageManifest {
  name: string;
  version: string;
  agent: AgentRole;
  description: string;
  author: string;
  tags: string[];
  dependencies: string[];
  files: string[];
  checksum: string;
  packedAt: string;
}

/**
 * A simple JSON-based archive format.
 * We avoid tar dependencies: the archive is a gzipped JSON blob
 * containing file paths and base64-encoded contents, plus the manifest.
 */
interface PackageArchive {
  manifest: PackageManifest;
  files: Array<{
    path: string;
    content: string; // base64
  }>;
}

// ---------------------------------------------------------------------------
// SkillPackager
// ---------------------------------------------------------------------------

export class SkillPackager {
  /**
   * Validate a skill directory before packaging/publishing.
   * Checks for valid frontmatter, valid agent role, semver version,
   * and scans instructions for dangerous patterns.
   */
  async validate(skillDir: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const resolvedDir = resolve(skillDir);

    // Check directory exists
    try {
      const dirStat = await stat(resolvedDir);
      if (!dirStat.isDirectory()) {
        return { valid: false, errors: [`${resolvedDir} is not a directory`], warnings };
      }
    } catch {
      return { valid: false, errors: [`Directory not found: ${resolvedDir}`], warnings };
    }

    // Find the primary skill file (SKILL.md or any .md with frontmatter)
    const skillFile = await this.findPrimarySkillFile(resolvedDir);

    if (!skillFile) {
      return {
        valid: false,
        errors: ["No skill Markdown file found. Skill directory must contain a .md file with YAML frontmatter."],
        warnings,
      };
    }

    // Parse and validate frontmatter
    let content: string;
    try {
      content = await readFile(skillFile, "utf-8");
    } catch {
      return { valid: false, errors: [`Cannot read skill file: ${skillFile}`], warnings };
    }

    const fmMatch = content.match(FRONTMATTER_RE);
    if (!fmMatch) {
      errors.push("Skill file must contain YAML frontmatter delimited by ---");
      return { valid: false, errors, warnings };
    }

    const [, frontmatterRaw, instructions] = fmMatch;

    let rawMeta: Record<string, unknown>;
    try {
      rawMeta = parseYaml(frontmatterRaw!) as Record<string, unknown>;
    } catch (err) {
      errors.push(`Invalid YAML frontmatter: ${(err as Error).message}`);
      return { valid: false, errors, warnings };
    }

    // Validate required fields
    if (typeof rawMeta["name"] !== "string" || rawMeta["name"].trim() === "") {
      errors.push("'name' is required and must be a non-empty string");
    } else if (!/^[a-z0-9-]+$/.test(rawMeta["name"])) {
      errors.push("'name' must be kebab-case (lowercase alphanumeric + hyphens)");
    }

    if (typeof rawMeta["version"] !== "string" || !SEMVER_RE.test(rawMeta["version"])) {
      errors.push("'version' must be a valid semver string (e.g. 1.0.0)");
    }

    if (typeof rawMeta["agent"] !== "string" || !VALID_AGENTS.has(rawMeta["agent"])) {
      errors.push(`'agent' must be one of: ${[...VALID_AGENTS].join(", ")}`);
    }

    if (typeof rawMeta["description"] !== "string" || rawMeta["description"].trim() === "") {
      errors.push("'description' is required");
    }

    if (!Array.isArray(rawMeta["triggers"]) || rawMeta["triggers"].length === 0) {
      errors.push("'triggers' must be a non-empty array of strings");
    }

    // Warnings for recommended fields
    if (!rawMeta["author"]) {
      warnings.push("'author' is recommended for published skills");
    }

    if (!rawMeta["tags"] || !Array.isArray(rawMeta["tags"]) || rawMeta["tags"].length === 0) {
      warnings.push("'tags' is recommended for discoverability");
    }

    // Scan instructions for dangerous patterns
    if (instructions) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(instructions)) {
          errors.push(`Instructions contain potentially dangerous pattern: ${pattern.source}`);
        }
      }
    }

    // Build metadata if valid
    let metadata: SkillMetadata | undefined;
    if (errors.length === 0) {
      metadata = {
        name: rawMeta["name"] as string,
        version: rawMeta["version"] as string,
        agent: rawMeta["agent"] as AgentRole,
        description: rawMeta["description"] as string,
        triggers: rawMeta["triggers"] as string[],
        dependencies: (rawMeta["dependencies"] as string[]) ?? [],
        requiredSecrets: (rawMeta["requiredSecrets"] as string[]) ?? [],
        timeout: (rawMeta["timeout"] as number) ?? 300,
        tags: (rawMeta["tags"] as string[]) ?? [],
        author: (rawMeta["author"] as string) ?? "unknown",
      };
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      metadata,
    };
  }

  /**
   * Package a skill directory into a distributable Buffer (gzipped JSON archive).
   * Validates the skill first — throws if invalid.
   */
  async pack(skillDir: string): Promise<Buffer> {
    const resolvedDir = resolve(skillDir);

    // Validate first
    const validation = await this.validate(resolvedDir);
    if (!validation.valid || !validation.metadata) {
      throw new Error(`Cannot pack invalid skill: ${validation.errors.join("; ")}`);
    }

    // Collect all files in the skill directory
    const files = await this.collectFiles(resolvedDir);

    const archiveFiles: PackageArchive["files"] = [];
    for (const filePath of files) {
      const content = await readFile(filePath);
      archiveFiles.push({
        path: relative(resolvedDir, filePath),
        content: content.toString("base64"),
      });
    }

    // Build manifest
    const manifest: PackageManifest = {
      name: validation.metadata.name,
      version: validation.metadata.version,
      agent: validation.metadata.agent,
      description: validation.metadata.description,
      author: validation.metadata.author ?? "unknown",
      tags: validation.metadata.tags ?? [],
      dependencies: validation.metadata.dependencies ?? [],
      files: archiveFiles.map((f) => f.path),
      checksum: "",
      packedAt: new Date().toISOString(),
    };

    // Create the archive
    const archive: PackageArchive = { manifest, files: archiveFiles };
    const jsonPayload = JSON.stringify(archive);

    // Compute checksum over the JSON payload
    manifest.checksum = createHash("sha256").update(jsonPayload).digest("hex");

    // Re-serialize with checksum
    const finalPayload = JSON.stringify({ ...archive, manifest });

    // Gzip compress
    return await this.gzipCompress(Buffer.from(finalPayload, "utf-8"));
  }

  /**
   * Unpack a skill package (gzipped archive) into a target directory.
   * Returns the path to the installed skill directory.
   */
  async unpack(data: Buffer, targetDir: string): Promise<string> {
    // Decompress
    const decompressed = await this.gzipDecompress(data);
    const archive: PackageArchive = JSON.parse(decompressed.toString("utf-8"));

    if (!archive.manifest?.name) {
      throw new Error("Invalid skill package: missing manifest");
    }

    const skillDir = join(resolve(targetDir), archive.manifest.name);

    // Create the skill directory
    await mkdir(skillDir, { recursive: true });

    // Write all files
    for (const file of archive.files) {
      const filePath = join(skillDir, file.path);
      const resolvedPath = resolve(filePath);
      const resolvedDir = resolve(skillDir);
      if (!resolvedPath.startsWith(resolvedDir + sep)) {
        throw new Error(`Path traversal detected: ${file.path}`);
      }
      const fileDir = join(filePath, "..");
      await mkdir(fileDir, { recursive: true });
      await writeFile(filePath, Buffer.from(file.content, "base64"));
    }

    return skillDir;
  }

  /**
   * Extract just the manifest from a package without fully unpacking.
   */
  async readManifest(data: Buffer): Promise<PackageManifest> {
    const decompressed = await this.gzipDecompress(data);
    const archive: PackageArchive = JSON.parse(decompressed.toString("utf-8"));

    if (!archive.manifest?.name) {
      throw new Error("Invalid skill package: missing manifest");
    }

    return archive.manifest;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Find the primary skill .md file in a directory (SKILL.md preferred). */
  private async findPrimarySkillFile(dir: string): Promise<string | null> {
    // Prefer SKILL.md
    const skillMd = join(dir, "SKILL.md");
    try {
      const s = await stat(skillMd);
      if (s.isFile()) return skillMd;
    } catch {
      // Not found, look for any .md with frontmatter
    }

    const entries = await readdir(dir);
    for (const entry of entries) {
      if (extname(entry) !== ".md") continue;
      if (entry === "SKILL_DESIGN_GUIDE.md") continue;

      const fullPath = join(dir, entry);
      const s = await stat(fullPath);
      if (!s.isFile()) continue;

      const content = await readFile(fullPath, "utf-8");
      if (FRONTMATTER_RE.test(content)) {
        return fullPath;
      }
    }

    return null;
  }

  /** Recursively collect all files in a directory. */
  private async collectFiles(dir: string): Promise<string[]> {
    const result: string[] = [];
    const entries = await readdir(dir);

    for (const entry of entries) {
      // Skip hidden files and common junk
      if (entry.startsWith(".") || entry === "node_modules") continue;

      const fullPath = join(dir, entry);
      const s = await stat(fullPath);

      if (s.isDirectory()) {
        const nested = await this.collectFiles(fullPath);
        result.push(...nested);
      } else if (s.isFile()) {
        // Skip very large files (> 1MB)
        if (s.size > 1_048_576) continue;
        result.push(fullPath);
      }
    }

    return result;
  }

  /** Gzip compress a buffer. */
  private gzipCompress(input: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gzip = createGzip();
      const source = Readable.from(input);
      const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });

      pipeline(source, gzip, sink)
        .then(() => resolve(Buffer.concat(chunks)))
        .catch(reject);
    });
  }

  /** Gzip decompress a buffer. */
  private gzipDecompress(input: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gunzip = createGunzip();
      const source = Readable.from(input);
      const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });

      pipeline(source, gunzip, sink)
        .then(() => resolve(Buffer.concat(chunks)))
        .catch(reject);
    });
  }
}
