import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  updateEnvFile,
  updateYamlConnector,
  updateYamlOwnerIds,
} from "../../../src/modules/discord/config-writer.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-discord-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── .env file tests ──────────────────────────────────────────────────────────

describe("updateEnvFile", () => {
  it("creates .env file if it does not exist", () => {
    const envPath = path.join(tmpDir, ".env");
    updateEnvFile(envPath, "DISCORD_BOT_TOKEN", "test-token-123");

    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("DISCORD_BOT_TOKEN=test-token-123");
  });

  it("appends a new key to existing .env", () => {
    const envPath = path.join(tmpDir, ".env");
    fs.writeFileSync(envPath, "EXISTING_KEY=value\n", "utf-8");

    updateEnvFile(envPath, "DISCORD_BOT_TOKEN", "new-token");

    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("EXISTING_KEY=value");
    expect(content).toContain("DISCORD_BOT_TOKEN=new-token");
  });

  it("updates an existing key in .env", () => {
    const envPath = path.join(tmpDir, ".env");
    fs.writeFileSync(envPath, "DISCORD_BOT_TOKEN=old-token\nOTHER=val\n", "utf-8");

    updateEnvFile(envPath, "DISCORD_BOT_TOKEN", "new-token");

    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("DISCORD_BOT_TOKEN=new-token");
    expect(content).not.toContain("old-token");
    expect(content).toContain("OTHER=val");
  });

  it("preserves comments in .env", () => {
    const envPath = path.join(tmpDir, ".env");
    fs.writeFileSync(envPath, "# This is a comment\nKEY=val\n", "utf-8");

    updateEnvFile(envPath, "NEW_KEY", "new-val");

    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("# This is a comment");
    expect(content).toContain("KEY=val");
    expect(content).toContain("NEW_KEY=new-val");
  });
});

// ── YAML connector tests ─────────────────────────────────────────────────────

describe("updateYamlConnector", () => {
  it("adds a connector to empty connectors array", () => {
    const yamlPath = path.join(tmpDir, "hivemind.yaml");
    fs.writeFileSync(yamlPath, "name: hivemind\nconnectors: []\n", "utf-8");

    updateYamlConnector(yamlPath, {
      type: "discord",
      name: "discord",
      config: { token: "$DISCORD_BOT_TOKEN", guildIds: ["123"] },
    });

    const content = fs.readFileSync(yamlPath, "utf-8");
    expect(content).toContain("discord");
    expect(content).toContain("$DISCORD_BOT_TOKEN");
  });

  it("replaces an existing connector with same name", () => {
    const yamlPath = path.join(tmpDir, "hivemind.yaml");
    fs.writeFileSync(
      yamlPath,
      'name: hivemind\nconnectors:\n  - type: discord\n    name: discord\n    config:\n      token: old-token\n',
      "utf-8",
    );

    updateYamlConnector(yamlPath, {
      type: "discord",
      name: "discord",
      config: { token: "$DISCORD_BOT_TOKEN", guildIds: ["456"] },
    });

    const content = fs.readFileSync(yamlPath, "utf-8");
    expect(content).toContain("$DISCORD_BOT_TOKEN");
    expect(content).not.toContain("old-token");
    expect(content).toContain("456");
  });

  it("adds a second connector without removing existing ones", () => {
    const yamlPath = path.join(tmpDir, "hivemind.yaml");
    fs.writeFileSync(
      yamlPath,
      'name: hivemind\nconnectors:\n  - type: slack\n    name: slack\n    config:\n      token: slack-token\n',
      "utf-8",
    );

    updateYamlConnector(yamlPath, {
      type: "discord",
      name: "discord",
      config: { token: "$DISCORD_BOT_TOKEN" },
    });

    const content = fs.readFileSync(yamlPath, "utf-8");
    expect(content).toContain("slack");
    expect(content).toContain("discord");
  });
});

// ── YAML ownerIds tests ──────────────────────────────────────────────────────

describe("updateYamlOwnerIds", () => {
  it("creates security.ownerIds section if missing", () => {
    const yamlPath = path.join(tmpDir, "hivemind.yaml");
    fs.writeFileSync(yamlPath, "name: hivemind\n", "utf-8");

    updateYamlOwnerIds(yamlPath, "discord", ["123456789"]);

    const content = fs.readFileSync(yamlPath, "utf-8");
    expect(content).toContain("security");
    expect(content).toContain("ownerIds");
    expect(content).toContain("123456789");
  });

  it("updates existing ownerIds for a connector", () => {
    const yamlPath = path.join(tmpDir, "hivemind.yaml");
    fs.writeFileSync(
      yamlPath,
      'name: hivemind\nsecurity:\n  ownerIds:\n    discord:\n      - "old-id"\n',
      "utf-8",
    );

    updateYamlOwnerIds(yamlPath, "discord", ["new-id-123"]);

    const content = fs.readFileSync(yamlPath, "utf-8");
    expect(content).toContain("new-id-123");
    expect(content).not.toContain("old-id");
  });

  it("preserves other connector ownerIds", () => {
    const yamlPath = path.join(tmpDir, "hivemind.yaml");
    fs.writeFileSync(
      yamlPath,
      'name: hivemind\nsecurity:\n  ownerIds:\n    slack:\n      - "USLACK123"\n',
      "utf-8",
    );

    updateYamlOwnerIds(yamlPath, "discord", ["DDISCORD456"]);

    const content = fs.readFileSync(yamlPath, "utf-8");
    expect(content).toContain("USLACK123");
    expect(content).toContain("DDISCORD456");
  });
});
