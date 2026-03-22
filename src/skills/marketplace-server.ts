/**
 * HIVEMIND Marketplace Server
 *
 * A lightweight Express router that serves as a self-hostable skill marketplace.
 * Can be mounted on the existing dashboard server OR run standalone.
 *
 * Uses SQLite (better-sqlite3) for persistence. The database auto-initializes
 * its schema on first run.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { SkillPackager } from "./skill-packager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketplaceServerConfig {
  /** Directory where published skill packages are stored on disk */
  skillsDir: string;
  /** Path to the SQLite database file */
  dbPath: string;
  /** Optional authentication secret for publish endpoints */
  authSecret?: string;
}

interface SkillRow {
  name: string;
  version: string;
  description: string;
  agent: string;
  author: string;
  downloads: number;
  stars: number;
  star_count: number;
  readme: string;
  source_path: string;
  published_at: string;
  tags: string;         // JSON array stored as text
  dependencies: string; // JSON array stored as text
  featured: number;     // 0 or 1
}

interface RatingRow {
  skill_name: string;
  user_id: string;
  stars: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Schema initialization
// ---------------------------------------------------------------------------

function initializeDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      name          TEXT PRIMARY KEY,
      version       TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      agent         TEXT NOT NULL DEFAULT 'builder',
      author        TEXT NOT NULL DEFAULT 'unknown',
      downloads     INTEGER NOT NULL DEFAULT 0,
      stars         REAL NOT NULL DEFAULT 0,
      star_count    INTEGER NOT NULL DEFAULT 0,
      readme        TEXT NOT NULL DEFAULT '',
      source_path   TEXT NOT NULL DEFAULT '',
      published_at  TEXT NOT NULL DEFAULT (datetime('now')),
      tags          TEXT NOT NULL DEFAULT '[]',
      dependencies  TEXT NOT NULL DEFAULT '[]',
      featured      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ratings (
      skill_name  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      stars       INTEGER NOT NULL CHECK(stars >= 1 AND stars <= 5),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (skill_name, user_id),
      FOREIGN KEY (skill_name) REFERENCES skills(name) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_skills_agent ON skills(agent);
    CREATE INDEX IF NOT EXISTS idx_skills_downloads ON skills(downloads DESC);
    CREATE INDEX IF NOT EXISTS idx_skills_stars ON skills(stars DESC);
    CREATE INDEX IF NOT EXISTS idx_skills_published_at ON skills(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_skills_featured ON skills(featured);
  `);
}

// ---------------------------------------------------------------------------
// Helper: format skill row to API response
// ---------------------------------------------------------------------------

function formatSkill(row: SkillRow): Record<string, unknown> {
  return {
    name: row.name,
    version: row.version,
    description: row.description,
    agent: row.agent,
    author: row.author,
    downloads: row.downloads,
    stars: Math.round(row.stars * 10) / 10,
    starCount: row.star_count,
    readme: row.readme,
    sourceUrl: `/api/skills/${row.name}/download`,
    publishedAt: row.published_at,
    tags: JSON.parse(row.tags) as string[],
    dependencies: JSON.parse(row.dependencies) as string[],
    featured: row.featured === 1,
  };
}

// ---------------------------------------------------------------------------
// Auth middleware helper
// ---------------------------------------------------------------------------

function checkAuth(
  req: Request,
  res: Response,
  authSecret?: string,
): boolean {
  if (!authSecret) return true; // No auth configured — open access

  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;

  if (token !== authSecret) {
    res.status(401).json({ error: "Unauthorized. Provide a valid Bearer token." });
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Create the marketplace Express router.
 *
 * Mount it on your Express app:
 *   app.use('/api/marketplace', createMarketplaceRouter({ ... }));
 *
 * Or for compatibility with the registry's /api/skills/* paths:
 *   app.use('/api/skills', createMarketplaceRouter({ ... }));
 */
export function createMarketplaceRouter(config: MarketplaceServerConfig): Router {
  const router = Router();
  const packager = new SkillPackager();

  // Ensure directories exist
  const skillsDir = resolve(config.skillsDir);
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(resolve(config.dbPath, ".."), { recursive: true });

  // Initialize database
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initializeDatabase(db);

  // Prepare statements
  const stmts = {
    searchAll: db.prepare(`
      SELECT * FROM skills
      ORDER BY downloads DESC
      LIMIT ? OFFSET ?
    `),

    searchByQuery: db.prepare(`
      SELECT * FROM skills
      WHERE name LIKE ? OR description LIKE ? OR tags LIKE ?
      ORDER BY downloads DESC
      LIMIT ? OFFSET ?
    `),

    searchByAgent: db.prepare(`
      SELECT * FROM skills
      WHERE agent = ?
      ORDER BY downloads DESC
      LIMIT ? OFFSET ?
    `),

    searchByQueryAndAgent: db.prepare(`
      SELECT * FROM skills
      WHERE (name LIKE ? OR description LIKE ? OR tags LIKE ?)
        AND agent = ?
      ORDER BY downloads DESC
      LIMIT ? OFFSET ?
    `),

    getByName: db.prepare(`SELECT * FROM skills WHERE name = ?`),

    insertSkill: db.prepare(`
      INSERT INTO skills (name, version, description, agent, author, readme, source_path, tags, dependencies, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET
        version = excluded.version,
        description = excluded.description,
        agent = excluded.agent,
        author = excluded.author,
        readme = excluded.readme,
        source_path = excluded.source_path,
        tags = excluded.tags,
        dependencies = excluded.dependencies,
        published_at = datetime('now')
    `),

    incrementDownloads: db.prepare(`
      UPDATE skills SET downloads = downloads + 1 WHERE name = ?
    `),

    upsertRating: db.prepare(`
      INSERT INTO ratings (skill_name, user_id, stars)
      VALUES (?, ?, ?)
      ON CONFLICT(skill_name, user_id) DO UPDATE SET stars = excluded.stars, created_at = datetime('now')
    `),

    computeStars: db.prepare(`
      SELECT AVG(stars) as avg_stars, COUNT(*) as count
      FROM ratings WHERE skill_name = ?
    `),

    updateStars: db.prepare(`
      UPDATE skills SET stars = ?, star_count = ? WHERE name = ?
    `),

    getFeatured: db.prepare(`
      SELECT * FROM skills WHERE featured = 1 ORDER BY downloads DESC LIMIT ?
    `),

    getPopular: db.prepare(`
      SELECT * FROM skills ORDER BY downloads DESC LIMIT ?
    `),

    getRecent: db.prepare(`
      SELECT * FROM skills ORDER BY published_at DESC LIMIT ?
    `),

    deleteSkill: db.prepare(`DELETE FROM skills WHERE name = ?`),
  };

  // -----------------------------------------------------------------------
  // GET /search?q=...&agent=...&tags=...&sort=...&limit=...&offset=...
  // -----------------------------------------------------------------------

  router.get("/search", (req: Request, res: Response) => {
    try {
      const q = req.query["q"] as string | undefined;
      const agent = req.query["agent"] as string | undefined;
      const tagsParam = req.query["tags"] as string | undefined;
      const limit = Math.min(parseInt(req.query["limit"] as string) || 50, 100);
      const offset = parseInt(req.query["offset"] as string) || 0;

      let rows: SkillRow[];

      if (q && agent) {
        const pattern = `%${q}%`;
        rows = stmts.searchByQueryAndAgent.all(pattern, pattern, pattern, agent, limit, offset) as SkillRow[];
      } else if (q) {
        const pattern = `%${q}%`;
        rows = stmts.searchByQuery.all(pattern, pattern, pattern, limit, offset) as SkillRow[];
      } else if (agent) {
        rows = stmts.searchByAgent.all(agent, limit, offset) as SkillRow[];
      } else {
        rows = stmts.searchAll.all(limit, offset) as SkillRow[];
      }

      // Filter by tags if provided
      if (tagsParam) {
        const filterTags = new Set(tagsParam.split(",").map((t) => t.trim().toLowerCase()));
        rows = rows.filter((row) => {
          const skillTags = JSON.parse(row.tags) as string[];
          return skillTags.some((t) => filterTags.has(t.toLowerCase()));
        });
      }

      res.json({ skills: rows.map(formatSkill), total: rows.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // -----------------------------------------------------------------------
  // GET /:name — skill details + readme
  // -----------------------------------------------------------------------

  router.get("/featured", (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query["limit"] as string) || 10;
      const rows = stmts.getFeatured.all(limit) as SkillRow[];
      res.json({ skills: rows.map(formatSkill) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/popular", (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query["limit"] as string) || 20;
      const rows = stmts.getPopular.all(limit) as SkillRow[];
      res.json({ skills: rows.map(formatSkill) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/recent", (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query["limit"] as string) || 20;
      const rows = stmts.getRecent.all(limit) as SkillRow[];
      res.json({ skills: rows.map(formatSkill) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/:name", (req: Request, res: Response) => {
    try {
      const row = stmts.getByName.get(req.params["name"]) as SkillRow | undefined;
      if (!row) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }
      res.json(formatSkill(row));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // -----------------------------------------------------------------------
  // GET /:name/download — download skill package
  // -----------------------------------------------------------------------

  router.get("/:name/download", (req: Request, res: Response) => {
    try {
      const row = stmts.getByName.get(req.params["name"]) as SkillRow | undefined;
      if (!row) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }

      const packagePath = join(skillsDir, `${row.name}-${row.version}.hmpkg`);
      if (!existsSync(packagePath)) {
        res.status(404).json({ error: "Skill package file not found on server" });
        return;
      }

      // Increment download count
      stmts.incrementDownloads.run(row.name);

      const data = readFileSync(packagePath);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${row.name}-${row.version}.hmpkg"`);
      res.setHeader("Content-Length", data.length);
      res.send(data);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // -----------------------------------------------------------------------
  // POST /publish — upload a new skill (authenticated)
  // -----------------------------------------------------------------------

  router.post("/publish", async (req: Request, res: Response) => {
    try {
      if (!checkAuth(req, res, config.authSecret)) return;

      // Read the raw body as a buffer (with 50MB size limit)
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const MAX_BODY_SIZE = 50 * 1024 * 1024; // 50MB
      let aborted = false;
      for await (const chunk of req) {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        totalBytes += buf.length;
        if (totalBytes > MAX_BODY_SIZE) {
          aborted = true;
          req.destroy();
          break;
        }
        chunks.push(buf);
      }
      if (aborted) {
        res.status(413).json({ error: "Payload too large. Maximum size is 50MB." });
        return;
      }
      const packageData = Buffer.concat(chunks);

      if (packageData.length === 0) {
        res.status(400).json({ error: "Empty request body. Send a skill package (.hmpkg)." });
        return;
      }

      // Extract and validate the manifest
      let manifest;
      try {
        manifest = await packager.readManifest(packageData);
      } catch (err) {
        res.status(400).json({ error: `Invalid skill package: ${(err as Error).message}` });
        return;
      }

      // Unpack temporarily to read the full README
      const tmpDir = join(skillsDir, ".tmp-publish-" + Date.now());
      let readme = "";
      try {
        mkdirSync(tmpDir, { recursive: true });
        const unpackedDir = await packager.unpack(packageData, tmpDir);

        // Try to read README or SKILL.md for the readme field
        for (const readmeFile of ["README.md", "SKILL.md", "readme.md"]) {
          const readmePath = join(unpackedDir, readmeFile);
          if (existsSync(readmePath)) {
            readme = readFileSync(readmePath, "utf-8");
            break;
          }
        }
      } catch {
        // Non-fatal: readme is optional
      } finally {
        // Clean up tmp dir
        try {
          const { rmSync } = await import("node:fs");
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }

      // Save the package file
      const packagePath = join(skillsDir, `${manifest.name}-${manifest.version}.hmpkg`);
      writeFileSync(packagePath, packageData);

      // Upsert into database
      stmts.insertSkill.run(
        manifest.name,
        manifest.version,
        manifest.description,
        manifest.agent,
        manifest.author,
        readme,
        packagePath,
        JSON.stringify(manifest.tags),
        JSON.stringify(manifest.dependencies),
      );

      res.status(201).json({
        name: manifest.name,
        version: manifest.version,
        message: `Skill "${manifest.name}" v${manifest.version} published successfully`,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // -----------------------------------------------------------------------
  // POST /:name/rate — rate a skill
  // -----------------------------------------------------------------------

  router.post("/:name/rate", (req: Request, res: Response) => {
    try {
      const name = req.params["name"];
      const row = stmts.getByName.get(name) as SkillRow | undefined;
      if (!row) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }

      const { stars } = req.body as { stars?: number };
      if (!stars || stars < 1 || stars > 5 || !Number.isInteger(stars)) {
        res.status(400).json({ error: "Stars must be an integer between 1 and 5" });
        return;
      }

      // Use IP or auth token as user identifier for simplicity
      const userId =
        (req.headers["authorization"]?.slice(7)) ??
        req.ip ??
        "anonymous";

      stmts.upsertRating.run(name, userId, stars);

      // Recompute average stars for the skill
      const agg = stmts.computeStars.get(name) as { avg_stars: number | null; count: number };
      const avgStars = agg.avg_stars ?? 0;
      stmts.updateStars.run(avgStars, agg.count, name);

      res.json({
        name,
        stars: Math.round(avgStars * 10) / 10,
        totalRatings: agg.count,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /:name — remove a skill from the marketplace (authenticated)
  // -----------------------------------------------------------------------

  router.delete("/:name", (req: Request, res: Response) => {
    try {
      if (!checkAuth(req, res, config.authSecret)) return;

      const name = req.params["name"];
      const row = stmts.getByName.get(name) as SkillRow | undefined;
      if (!row) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }

      // Remove package file
      const packagePath = join(skillsDir, `${row.name}-${row.version}.hmpkg`);
      try {
        const { unlinkSync } = require("node:fs") as typeof import("node:fs");
        if (existsSync(packagePath)) unlinkSync(packagePath);
      } catch {
        // Non-fatal
      }

      stmts.deleteSkill.run(name);
      res.json({ deleted: name });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Standalone server (for running the marketplace independently)
// ---------------------------------------------------------------------------

export async function startStandaloneMarketplace(options: {
  port?: number;
  skillsDir?: string;
  dbPath?: string;
  authSecret?: string;
}): Promise<void> {
  const { default: express } = await import("express");

  const port = options.port ?? 4100;
  const skillsDir = resolve(options.skillsDir ?? "./marketplace-skills");
  const dbPath = resolve(options.dbPath ?? "./marketplace.db");

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // CORS for local development
  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (_req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  const router = createMarketplaceRouter({
    skillsDir,
    dbPath,
    authSecret: options.authSecret,
  });

  app.use("/api/skills", router);

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "hivemind-marketplace", timestamp: Date.now() });
  });

  app.listen(port, () => {
    console.log(`[Marketplace] HIVEMIND Skill Marketplace running on http://localhost:${port}`);
    console.log(`[Marketplace] Skills directory: ${skillsDir}`);
    console.log(`[Marketplace] Database: ${dbPath}`);
    console.log(`[Marketplace] Auth: ${options.authSecret ? "enabled" : "disabled (open access)"}`);
  });
}
