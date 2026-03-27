import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

// Mock child_process at the module level for ESM compatibility
vi.mock("node:child_process", () => {
  const actual = vi.importActual("node:child_process");
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

import { spawn } from "node:child_process";

import {
  isFirstRun,
  getDefaultProfile,
  getHivemindHome,
  getProfilePath,
  normalizeProfile,
  loadProfile,
  loadProfileOrDefault,
  saveProfile,
  detectProviderStatuses,
  generatePersonalizedConfig,
  ensurePersonalizedConfig,
  buildFirstTaskSuggestion,
  runOnboarding,
  DEFAULT_AGENT_ORDER,
  type HivemindProfile,
  type RunOnboardingOptions,
  type AgentId,
  type UserRole,
  type ProjectStage,
  type WorkStyle,
  type PersonalityStyle,
} from "../../src/cli/onboarding.js";

const mockedSpawn = vi.mocked(spawn);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a temp directory that auto-cleans after each test. */
let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hivemind-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

/** Build a minimal valid profile for tests. */
function buildProfile(overrides: Partial<HivemindProfile> = {}): HivemindProfile {
  const base = getDefaultProfile("TestUser");
  return { ...base, ...overrides };
}

/** Create a mock child process that emits data and closes. */
function mockSpawnResult(stdout: string, exitCode: number, error?: Error): any {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.stdio = ["ignore", "pipe", "pipe"];

  // Schedule events on next tick so listeners can attach
  process.nextTick(() => {
    if (error) {
      child.emit("error", error);
      return;
    }
    child.stdout.emit("data", Buffer.from(stdout));
    child.emit("close", exitCode);
  });

  return child;
}

/**
 * Simulate user input for the onboarding flow.
 * Writes answers to the input stream with small delays between each line
 * so that each line arrives AFTER the corresponding rl.question() call.
 * (node:readline/promises requires data to arrive after question() is called.)
 */
function createInputStream(answers: string[]): PassThrough {
  const stream = new PassThrough();
  let i = 0;
  const interval = setInterval(() => {
    if (i < answers.length) {
      stream.write(answers[i] + "\n");
      i++;
    } else {
      clearInterval(interval);
      // End the stream after all answers are consumed
      stream.end();
    }
  }, 30);
  return stream;
}

// ─── getHivemindHome / getProfilePath ────────────────────────────────────────

describe("getHivemindHome", () => {
  it("returns ~/.hivemind for a given home dir", () => {
    expect(getHivemindHome("/home/test")).toBe(path.join("/home/test", ".hivemind"));
  });

  it("defaults to os.homedir()", () => {
    expect(getHivemindHome()).toBe(path.join(os.homedir(), ".hivemind"));
  });
});

describe("getProfilePath", () => {
  it("returns profile.json inside .hivemind", () => {
    expect(getProfilePath("/home/test")).toBe(
      path.join("/home/test", ".hivemind", "profile.json"),
    );
  });
});

// ─── isFirstRun ──────────────────────────────────────────────────────────────

describe("isFirstRun", () => {
  it("returns true when profile does not exist", () => {
    const tmp = makeTmpDir();
    const fakePath = path.join(tmp, ".hivemind", "profile.json");
    expect(isFirstRun(fakePath)).toBe(true);
  });

  it("returns false when profile exists", () => {
    const tmp = makeTmpDir();
    const hivemindDir = path.join(tmp, ".hivemind");
    fs.mkdirSync(hivemindDir, { recursive: true });
    const profilePath = path.join(hivemindDir, "profile.json");
    fs.writeFileSync(profilePath, JSON.stringify(getDefaultProfile("User")), "utf8");
    expect(isFirstRun(profilePath)).toBe(false);
  });
});

// ─── getDefaultProfile ───────────────────────────────────────────────────────

describe("getDefaultProfile", () => {
  it("returns a valid profile structure", () => {
    const profile = getDefaultProfile("Alice");
    expect(profile.version).toBe(1);
    expect(profile.user.name).toBe("Alice");
    expect(profile.user.role).toBe("founder");
    expect(profile.user.projectStage).toBe("idea");
    expect(profile.user.workStyle).toBe("balanced");
    expect(profile.cofounder.name).toBe("Nova");
    expect(profile.cofounder.personality).toBe("direct");
    expect(profile.cofounder.emoji).toBe("\u{1F41D}");
  });

  it("has valid timestamps", () => {
    const profile = getDefaultProfile("Bob");
    expect(profile.createdAt).toBeTruthy();
    expect(profile.updatedAt).toBeTruthy();
    expect(() => new Date(profile.createdAt)).not.toThrow();
    expect(() => new Date(profile.updatedAt)).not.toThrow();
  });

  it("includes all six agents", () => {
    const profile = getDefaultProfile("Charlie");
    for (const agentId of DEFAULT_AGENT_ORDER) {
      expect(profile.agents[agentId]).toBeDefined();
      expect(profile.agents[agentId].id).toBe(agentId);
      expect(profile.agents[agentId].name).toBeTruthy();
      expect(profile.agents[agentId].roleLabel).toBeTruthy();
    }
  });

  it("nova-1 defaults to Nova with bee emoji", () => {
    const profile = getDefaultProfile();
    expect(profile.agents["nova-1"].name).toBe("Nova");
    expect(profile.agents["nova-1"].icon).toBe("\u{1F41D}");
  });

  it("uses environment USER when no name provided", () => {
    const profile = getDefaultProfile();
    expect(typeof profile.user.name).toBe("string");
    expect(profile.user.name.length).toBeGreaterThan(0);
  });
});

// ─── normalizeProfile ────────────────────────────────────────────────────────

describe("normalizeProfile", () => {
  it("returns a valid profile from null input", () => {
    const profile = normalizeProfile(null);
    expect(profile.version).toBe(1);
    expect(profile.user.role).toBe("founder");
    expect(profile.user.workStyle).toBe("balanced");
    expect(profile.cofounder.name).toBe("Nova");
  });

  it("returns a valid profile from undefined input", () => {
    const profile = normalizeProfile(undefined);
    expect(profile.version).toBe(1);
  });

  it("preserves valid user fields", () => {
    const profile = normalizeProfile({
      user: {
        name: "Dana",
        role: "developer",
        project: "My App",
        projectStage: "mvp",
        workStyle: "hands-on",
      },
    });
    expect(profile.user.name).toBe("Dana");
    expect(profile.user.role).toBe("developer");
    expect(profile.user.project).toBe("My App");
    expect(profile.user.projectStage).toBe("mvp");
    expect(profile.user.workStyle).toBe("hands-on");
  });

  it("normalizes legacy 'hybrid' workStyle to 'balanced'", () => {
    const profile = normalizeProfile({
      user: { workStyle: "hybrid" as WorkStyle },
    });
    expect(profile.user.workStyle).toBe("balanced");
  });

  it("falls back to defaults for invalid role", () => {
    const profile = normalizeProfile({
      user: { role: "invalid-role" as UserRole },
    });
    expect(profile.user.role).toBe("founder");
  });

  it("falls back to defaults for invalid projectStage", () => {
    const profile = normalizeProfile({
      user: { projectStage: "invalid-stage" as ProjectStage },
    });
    expect(profile.user.projectStage).toBe("idea");
  });

  it("falls back to defaults for invalid workStyle", () => {
    const profile = normalizeProfile({
      user: { workStyle: "random" as WorkStyle },
    });
    expect(profile.user.workStyle).toBe("balanced");
  });

  it("handles legacy projectDescription field", () => {
    const profile = normalizeProfile({
      user: { projectDescription: "Legacy project desc" } as any,
    });
    expect(profile.user.project).toBe("Legacy project desc");
  });

  it("preserves cofounder settings", () => {
    const profile = normalizeProfile({
      cofounder: {
        name: "Atlas",
        personality: "warm",
        emoji: "\u{1F9E0}",
      },
    });
    expect(profile.cofounder.name).toBe("Atlas");
    expect(profile.cofounder.personality).toBe("warm");
    expect(profile.cofounder.personalityLabel).toBe("Warm & encouraging");
    expect(profile.cofounder.emoji).toBe("\u{1F9E0}");
  });

  it("falls back to direct personality for unknown personality value", () => {
    const profile = normalizeProfile({
      cofounder: { personality: "unknown" as PersonalityStyle },
    });
    expect(profile.cofounder.personality).toBe("direct");
  });

  it("syncs cofounder name and emoji to nova-1 agent", () => {
    const profile = normalizeProfile({
      cofounder: {
        name: "Kai",
        emoji: "\u{26A1}",
      },
    });
    expect(profile.agents["nova-1"].name).toBe("Kai");
    expect(profile.agents["nova-1"].icon).toBe("\u{26A1}");
  });

  it("preserves custom agent names", () => {
    const profile = normalizeProfile({
      agents: {
        "scout-1": { name: "Sherlock" },
      } as any,
    });
    expect(profile.agents["scout-1"].name).toBe("Sherlock");
  });

  it("trims names with whitespace", () => {
    const profile = normalizeProfile({
      user: { name: "  Spaced Name  " },
    });
    expect(profile.user.name).toBe("Spaced Name");
  });

  it("uses default name for empty/whitespace-only user name", () => {
    const profile = normalizeProfile({
      user: { name: "   " },
    });
    expect(profile.user.name.length).toBeGreaterThan(0);
  });

  it("truncates long icon strings to 2 characters", () => {
    const profile = normalizeProfile({
      agents: {
        "scout-1": { icon: "ABCDE" },
      } as any,
    });
    expect(profile.agents["scout-1"].icon.length).toBeLessThanOrEqual(2);
  });

  it("sets updatedAt to a recent timestamp", () => {
    const before = new Date().toISOString();
    const profile = normalizeProfile(null);
    const after = new Date().toISOString();
    expect(profile.updatedAt >= before).toBe(true);
    expect(profile.updatedAt <= after).toBe(true);
  });
});

// ─── loadProfile / saveProfile ───────────────────────────────────────────────

describe("loadProfile", () => {
  it("returns null when file does not exist", () => {
    const tmp = makeTmpDir();
    const fakePath = path.join(tmp, "nope.json");
    expect(loadProfile(fakePath)).toBeNull();
  });

  it("returns null for corrupted JSON", () => {
    const tmp = makeTmpDir();
    const profilePath = path.join(tmp, "profile.json");
    fs.writeFileSync(profilePath, "not valid json {{{", "utf8");
    expect(loadProfile(profilePath)).toBeNull();
  });

  it("loads and normalizes a valid profile", () => {
    const tmp = makeTmpDir();
    const profilePath = path.join(tmp, "profile.json");
    const original = getDefaultProfile("LoadTest");
    fs.writeFileSync(profilePath, JSON.stringify(original), "utf8");
    const loaded = loadProfile(profilePath);
    expect(loaded).not.toBeNull();
    expect(loaded!.user.name).toBe("LoadTest");
    expect(loaded!.version).toBe(1);
  });
});

describe("loadProfileOrDefault", () => {
  it("returns default profile when file does not exist", () => {
    const tmp = makeTmpDir();
    const fakePath = path.join(tmp, "nope.json");
    const profile = loadProfileOrDefault(fakePath);
    expect(profile.version).toBe(1);
    expect(profile.cofounder.name).toBe("Nova");
  });
});

describe("saveProfile", () => {
  it("creates directory structure and writes profile", () => {
    const tmp = makeTmpDir();
    const profilePath = path.join(tmp, "sub", "dir", "profile.json");
    const profile = getDefaultProfile("SaveTest");
    const saved = saveProfile(profile, profilePath);

    expect(fs.existsSync(profilePath)).toBe(true);
    expect(saved.user.name).toBe("SaveTest");

    const raw = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    expect(raw.user.name).toBe("SaveTest");
  });

  it("round-trips: save then load returns equivalent profile", () => {
    const tmp = makeTmpDir();
    const profilePath = path.join(tmp, "profile.json");
    const original = getDefaultProfile("RoundTrip");
    original.user.role = "developer";
    original.user.project = "Test Project";
    original.cofounder.name = "Atlas";

    saveProfile(original, profilePath);
    const loaded = loadProfile(profilePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.user.name).toBe("RoundTrip");
    expect(loaded!.user.role).toBe("developer");
    expect(loaded!.user.project).toBe("Test Project");
    expect(loaded!.cofounder.name).toBe("Atlas");
  });

  it("preserves original createdAt on re-save", () => {
    const tmp = makeTmpDir();
    const profilePath = path.join(tmp, "profile.json");
    const original = getDefaultProfile("Preserve");
    const firstSave = saveProfile(original, profilePath);
    const firstCreatedAt = firstSave.createdAt;

    const updated = { ...firstSave, user: { ...firstSave.user, name: "Updated" } };
    const secondSave = saveProfile(updated, profilePath);

    expect(secondSave.createdAt).toBe(firstCreatedAt);
    expect(secondSave.user.name).toBe("Updated");
  });

  it("writes pretty-printed JSON with trailing newline", () => {
    const tmp = makeTmpDir();
    const profilePath = path.join(tmp, "profile.json");
    saveProfile(getDefaultProfile("Pretty"), profilePath);
    const raw = fs.readFileSync(profilePath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.split("\n").length).toBeGreaterThan(5);
  });
});

// ─── detectProviderStatuses ──────────────────────────────────────────────────

describe("detectProviderStatuses", () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  it("detects both providers as installed", async () => {
    mockedSpawn.mockImplementation((command: string) => {
      if (command === "claude") return mockSpawnResult("claude-code 1.0.0", 0);
      if (command === "codex") return mockSpawnResult("codex 0.5.0", 0);
      return mockSpawnResult("", 1);
    });

    const statuses = await detectProviderStatuses();
    expect(statuses).toHaveLength(2);

    const claude = statuses.find((s) => s.id === "claude-code");
    expect(claude).toBeDefined();
    expect(claude!.installed).toBe(true);
    expect(claude!.detail).toContain("claude-code 1.0.0");

    const codex = statuses.find((s) => s.id === "codex");
    expect(codex).toBeDefined();
    expect(codex!.installed).toBe(true);
    expect(codex!.detail).toContain("codex 0.5.0");
  });

  it("reports missing when command not found (ENOENT)", async () => {
    mockedSpawn.mockImplementation(() => {
      const err = new Error("spawn claude ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      return mockSpawnResult("", 1, err);
    });

    const statuses = await detectProviderStatuses();
    for (const status of statuses) {
      expect(status.installed).toBe(false);
      expect(status.detail).toBe("Not installed");
    }
  });

  it("reports not ready when command fails with non-ENOENT error", async () => {
    mockedSpawn.mockImplementation(() => {
      return mockSpawnResult("", 1, new Error("Something went wrong"));
    });

    const statuses = await detectProviderStatuses();
    for (const status of statuses) {
      expect(status.installed).toBe(false);
      expect(status.detail).toBe("Not ready");
    }
  });

  it("includes install and login commands", async () => {
    mockedSpawn.mockImplementation(() => mockSpawnResult("", 1, new Error("ENOENT")));

    const statuses = await detectProviderStatuses();
    const claude = statuses.find((s) => s.id === "claude-code")!;
    expect(claude.installCommand).toContain("@anthropic-ai/claude-code");
    expect(claude.loginCommand).toBe("claude login");

    const codex = statuses.find((s) => s.id === "codex")!;
    expect(codex.installCommand).toContain("@openai/codex");
    expect(codex.loginCommand).toBe("codex auth");
  });

  it("returns exactly two statuses (claude-code and codex)", async () => {
    mockedSpawn.mockImplementation(() => mockSpawnResult("v1.0", 0));
    const statuses = await detectProviderStatuses();
    expect(statuses).toHaveLength(2);
    const ids = statuses.map((s) => s.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("codex");
  });

  it("compacts whitespace in version output", async () => {
    mockedSpawn.mockImplementation(() => mockSpawnResult("  version  1.0.0  \n  build 42  ", 0));
    const statuses = await detectProviderStatuses();
    for (const status of statuses) {
      expect(status.detail).toBe("version 1.0.0 build 42");
    }
  });
});

// ─── generatePersonalizedConfig ──────────────────────────────────────────────

describe("generatePersonalizedConfig", () => {
  it("generates valid YAML-like config string", () => {
    const profile = buildProfile({ user: { ...getDefaultProfile().user, name: "ConfigUser", project: "My SaaS" } });
    const config = generatePersonalizedConfig(profile);

    expect(config).toContain("# HIVEMIND Configuration");
    expect(config).toContain('operatorName: "ConfigUser"');
    expect(config).toContain('cofounderName: "Nova"');
    expect(config).toContain('role: "founder"');
    expect(config).toContain('stage: "idea"');
    expect(config).toContain("dashboard:");
    expect(config).toContain("port: 4000");
    expect(config).toContain("storage:");
  });

  it("slugifies project name for the config name field", () => {
    const profile = buildProfile({
      user: { ...getDefaultProfile().user, project: "My Super Project!!" },
    });
    const config = generatePersonalizedConfig(profile);
    expect(config).toContain('name: "my-super-project"');
  });

  it("escapes special characters in YAML strings", () => {
    const profile = buildProfile({
      user: { ...getDefaultProfile().user, name: 'User "With" Quotes' },
    });
    const config = generatePersonalizedConfig(profile);
    expect(config).toContain('operatorName: "User \\"With\\" Quotes"');
  });

  it("includes all six agent entries", () => {
    const profile = buildProfile();
    const config = generatePersonalizedConfig(profile);
    expect(config).toContain("coordinator:");
    expect(config).toContain("scout:");
    expect(config).toContain("builder:");
    expect(config).toContain("sentinel:");
    expect(config).toContain("oracle:");
    expect(config).toContain("courier:");
  });

  it("uses custom cofounder name in coordinator agent", () => {
    const profile = buildProfile();
    profile.cofounder.name = "Aria";
    profile.agents["nova-1"] = { ...profile.agents["nova-1"], name: "Aria" };
    const config = generatePersonalizedConfig(profile);
    expect(config).toContain('name: "Aria"');
  });

  it("handles empty project gracefully", () => {
    const profile = buildProfile({
      user: { ...getDefaultProfile().user, project: "" },
    });
    const config = generatePersonalizedConfig(profile);
    expect(config).toContain('name: "hivemind-project"');
  });
});

// ─── ensurePersonalizedConfig ────────────────────────────────────────────────

describe("ensurePersonalizedConfig", () => {
  it("writes config file when it does not exist", () => {
    const tmp = makeTmpDir();
    const configPath = path.join(tmp, "hivemind.yaml");
    const profile = buildProfile();

    const result = ensurePersonalizedConfig(profile, configPath);
    expect(result).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);
    const content = fs.readFileSync(configPath, "utf8");
    expect(content).toContain("# HIVEMIND Configuration");
  });

  it("does not overwrite existing config", () => {
    const tmp = makeTmpDir();
    const configPath = path.join(tmp, "hivemind.yaml");
    fs.writeFileSync(configPath, "existing: true", "utf8");

    const result = ensurePersonalizedConfig(buildProfile(), configPath);
    expect(result).toBe(false);
    const content = fs.readFileSync(configPath, "utf8");
    expect(content).toBe("existing: true");
  });

  it("creates parent directories as needed", () => {
    const tmp = makeTmpDir();
    const configPath = path.join(tmp, "deep", "nested", "hivemind.yaml");

    ensurePersonalizedConfig(buildProfile(), configPath);
    expect(fs.existsSync(configPath)).toBe(true);
  });
});

// ─── buildFirstTaskSuggestion ────────────────────────────────────────────────

describe("buildFirstTaskSuggestion", () => {
  it("includes project description and stage label", () => {
    const profile = buildProfile({
      user: {
        ...getDefaultProfile().user,
        project: "AI chatbot",
        projectStage: "mvp",
        role: "developer",
      },
    });
    const suggestion = buildFirstTaskSuggestion(profile);
    expect(suggestion).toContain("AI chatbot");
    expect(suggestion).toContain("Building the MVP");
    expect(suggestion).toContain("Developer");
  });

  it("includes role label for founder", () => {
    const profile = buildProfile({
      user: { ...getDefaultProfile().user, role: "founder" },
    });
    const suggestion = buildFirstTaskSuggestion(profile);
    expect(suggestion).toContain("Founder / CEO");
  });

  it("includes stage label for production", () => {
    const profile = buildProfile({
      user: { ...getDefaultProfile().user, projectStage: "production" },
    });
    const suggestion = buildFirstTaskSuggestion(profile);
    expect(suggestion).toContain("Live in production");
  });

  it("includes stage label for beta", () => {
    const profile = buildProfile({
      user: { ...getDefaultProfile().user, projectStage: "beta" },
    });
    const suggestion = buildFirstTaskSuggestion(profile);
    expect(suggestion).toContain("In beta / testing");
  });

  it("includes stage label for idea", () => {
    const profile = buildProfile({
      user: { ...getDefaultProfile().user, projectStage: "idea" },
    });
    const suggestion = buildFirstTaskSuggestion(profile);
    expect(suggestion).toContain("Just an idea");
  });

  it("uses all specified roles", () => {
    const roles: Array<{ role: UserRole; label: string }> = [
      { role: "founder", label: "Founder / CEO" },
      { role: "developer", label: "Developer" },
      { role: "designer", label: "Designer" },
      { role: "pm", label: "Product Manager" },
      { role: "student", label: "Student / Learner" },
      { role: "hobbyist", label: "Hobbyist / Maker" },
    ];
    for (const { role, label } of roles) {
      const profile = buildProfile({ user: { ...getDefaultProfile().user, role } });
      const suggestion = buildFirstTaskSuggestion(profile);
      expect(suggestion).toContain(label);
    }
  });

  it("mentions highest-leverage moves", () => {
    const profile = buildProfile();
    const suggestion = buildFirstTaskSuggestion(profile);
    expect(suggestion).toContain("highest-leverage moves");
  });

  it("falls back to a generic project label when project is blank", () => {
    const profile = buildProfile({
      user: { ...getDefaultProfile().user, project: "   " },
    });
    const suggestion = buildFirstTaskSuggestion(profile);
    expect(suggestion).toContain("my project");
  });
});

// ─── runOnboarding (full flow simulation) ────────────────────────────────────

describe("runOnboarding", () => {
  beforeEach(() => {
    // Mock spawn so provider detection doesn't actually run CLI commands
    mockedSpawn.mockReset();
    mockedSpawn.mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      process.nextTick(() => {
        child.stdout.emit("data", Buffer.from("mock-version 1.0"));
        child.emit("close", 0);
      });
      return child;
    });
  });

  it("runs full onboarding flow with default answers", async () => {
    const tmp = makeTmpDir();
    const homeDir = path.join(tmp, "home");
    const cwd = path.join(tmp, "project");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });

    const output = new PassThrough();
    output.resume(); // drain output to prevent backpressure

    // All empty answers = accept all defaults
    // Phase 1: name, role(menu), project, stage(menu), workStyle(menu)
    // Phase 2: cofounder name(menu), personality(menu), emoji(menu)
    const input = createInputStream(["", "", "", "", "", "", "", ""]);
    const profilePath = path.join(homeDir, ".hivemind", "profile.json");
    const configPath = path.join(cwd, "hivemind.yaml");

    const profile = await runOnboarding({
      cwd,
      homeDir,
      profilePath,
      configPath,
      input,
      output,
    });

    expect(profile.version).toBe(1);
    expect(profile.user.role).toBe("founder");
    expect(profile.cofounder.name).toBe("Nova");
    expect(profile.cofounder.personality).toBe("direct");
    expect(fs.existsSync(profilePath)).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("runs full onboarding flow with custom answers", async () => {
    const tmp = makeTmpDir();
    const homeDir = path.join(tmp, "home");
    const cwd = path.join(tmp, "project");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });

    const output = new PassThrough();
    output.resume(); // drain output

    // Phase 1: name="Alice", role=2(developer), project="My App", stage=2(mvp), workStyle=1(hands-on)
    // Phase 2: cofounder=3(Kai), personality=4(casual), emoji=3(lightning)
    const input = createInputStream([
      "Alice",  // name
      "2",      // role: Developer
      "My App", // project
      "2",      // stage: Building the MVP
      "1",      // workStyle: Hands-on
      "3",      // cofounder: Kai
      "4",      // personality: Casual & fun
      "3",      // emoji: Lightning
    ]);
    const profilePath = path.join(homeDir, ".hivemind", "profile.json");
    const configPath = path.join(cwd, "hivemind.yaml");

    const profile = await runOnboarding({
      cwd,
      homeDir,
      profilePath,
      configPath,
      input,
      output,
    });

    expect(profile.user.name).toBe("Alice");
    expect(profile.user.role).toBe("developer");
    expect(profile.user.project).toBe("My App");
    expect(profile.user.projectStage).toBe("mvp");
    expect(profile.user.workStyle).toBe("hands-on");
    expect(profile.cofounder.name).toBe("Kai");
    expect(profile.cofounder.personality).toBe("casual");
    expect(profile.cofounder.emoji).toBe("\u{26A1}");
    expect(profile.agents["nova-1"].name).toBe("Kai");
  });

  it("writes output to the provided stream", async () => {
    const tmp = makeTmpDir();
    const homeDir = path.join(tmp, "home");
    const cwd = path.join(tmp, "project");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });

    const output = new PassThrough();
    const outputText: string[] = [];
    output.on("data", (chunk) => outputText.push(chunk.toString()));

    const input = createInputStream(["", "", "", "", "", "", "", ""]);

    await runOnboarding({
      cwd,
      homeDir,
      profilePath: path.join(homeDir, ".hivemind", "profile.json"),
      configPath: path.join(cwd, "hivemind.yaml"),
      input,
      output,
    });

    const fullOutput = outputText.join("");
    // Should contain the HIVEMIND banner
    expect(fullOutput).toContain("HIVEMIND");
    // Should contain step headers
    expect(fullOutput).toContain("Step 1 of 4");
    expect(fullOutput).toContain("Step 2 of 4");
    expect(fullOutput).toContain("Step 3 of 4");
    expect(fullOutput).toContain("Step 4 of 4");
    // Should contain tool detection (phase 3)
    expect(fullOutput).toContain("Scanning your system");
    // Should contain profile saved message
    expect(fullOutput).toContain("Profile saved");
  });

  it("does not overwrite existing hivemind.yaml", async () => {
    const tmp = makeTmpDir();
    const homeDir = path.join(tmp, "home");
    const cwd = path.join(tmp, "project");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });

    const configPath = path.join(cwd, "hivemind.yaml");
    fs.writeFileSync(configPath, "existing: config\n", "utf8");

    const output = new PassThrough();
    output.resume(); // drain output
    const input = createInputStream(["", "", "", "", "", "", "", ""]);

    await runOnboarding({
      cwd,
      homeDir,
      profilePath: path.join(homeDir, ".hivemind", "profile.json"),
      configPath,
      input,
      output,
    });

    const content = fs.readFileSync(configPath, "utf8");
    expect(content).toBe("existing: config\n");
  });

  it("saves profile to the specified profilePath", async () => {
    const tmp = makeTmpDir();
    const homeDir = path.join(tmp, "home");
    const cwd = path.join(tmp, "project");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });

    const output = new PassThrough();
    output.resume(); // drain output
    const input = createInputStream(["CustomUser", "", "", "", "", "", "", ""]);
    const profilePath = path.join(homeDir, "custom", "profile.json");

    await runOnboarding({
      cwd,
      homeDir,
      profilePath,
      configPath: path.join(cwd, "hivemind.yaml"),
      input,
      output,
    });

    expect(fs.existsSync(profilePath)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    expect(saved.user.name).toBe("CustomUser");
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles special characters in user name", () => {
    const profile = normalizeProfile({
      user: { name: "O'Brien-Smith" },
    });
    expect(profile.user.name).toBe("O'Brien-Smith");
    const config = generatePersonalizedConfig(profile);
    expect(config).toContain("O'Brien-Smith");
  });

  it("handles unicode characters in project name", () => {
    const profile = normalizeProfile({
      user: { project: "Projet fran\u00e7ais \u{1F680}" },
    });
    expect(profile.user.project).toBe("Projet fran\u00e7ais \u{1F680}");
  });

  it("handles very long project name in config", () => {
    const longName = "A".repeat(500);
    const profile = buildProfile({
      user: { ...getDefaultProfile().user, project: longName },
    });
    const config = generatePersonalizedConfig(profile);
    expect(config).toContain(longName);
  });

  it("normalizeProfile with empty agents record", () => {
    const profile = normalizeProfile({
      agents: {} as any,
    });
    for (const agentId of DEFAULT_AGENT_ORDER) {
      expect(profile.agents[agentId]).toBeDefined();
      expect(profile.agents[agentId].id).toBe(agentId);
    }
  });

  it("saveProfile to read-only dir does not silently succeed", () => {
    // Use a path with a reserved device name that can't be a directory on Windows,
    // and /proc/0/ which is not writable on Linux/macOS
    const impossiblePath = process.platform === "win32"
      ? "\\\\.\\.\\NUL\\impossible\\profile.json"
      : "/proc/0/impossible/profile.json";
    expect(() => saveProfile(getDefaultProfile(), impossiblePath)).toThrow();
  });

  it("loadProfile handles empty file as corrupted", () => {
    const tmp = makeTmpDir();
    const profilePath = path.join(tmp, "profile.json");
    fs.writeFileSync(profilePath, "", "utf8");
    expect(loadProfile(profilePath)).toBeNull();
  });

  it("DEFAULT_AGENT_ORDER contains exactly six agents", () => {
    expect(DEFAULT_AGENT_ORDER).toHaveLength(6);
    expect(DEFAULT_AGENT_ORDER).toContain("nova-1");
    expect(DEFAULT_AGENT_ORDER).toContain("scout-1");
    expect(DEFAULT_AGENT_ORDER).toContain("builder-1");
    expect(DEFAULT_AGENT_ORDER).toContain("sentinel-1");
    expect(DEFAULT_AGENT_ORDER).toContain("oracle-1");
    expect(DEFAULT_AGENT_ORDER).toContain("courier-1");
  });

  it("backslashes in names are escaped in YAML config", () => {
    const profile = buildProfile({
      user: { ...getDefaultProfile().user, name: 'Path\\User' },
    });
    const config = generatePersonalizedConfig(profile);
    expect(config).toContain('operatorName: "Path\\\\User"');
  });
});
