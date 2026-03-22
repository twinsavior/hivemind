import { describe, it, expect, beforeEach, vi } from "vitest";

// Prevent SessionManager from reading/writing ~/.hivemind/sessions.json
// so tests are fully isolated from disk state and from each other.
vi.mock("node:fs", () => ({
  existsSync: () => false,
  readFileSync: () => "{}",
  writeFileSync: () => {},
  mkdirSync: () => {},
}));

import { SessionManager, extractSessionId } from "../../src/core/session-manager.js";

describe("SessionManager", () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager({ maxTasksPerSession: 5 });
  });

  describe("getSession", () => {
    it("creates a new session on first access", () => {
      const session = sm.getSession("scout-1");

      expect(session.agentId).toBe("scout-1");
      expect(session.sessionId).toBeNull();
      expect(session.taskCount).toBe(0);
      expect(session.tokenUsage).toEqual({ input: 0, output: 0, cached: 0 });
    });

    it("returns the same session on repeated access", () => {
      const s1 = sm.getSession("scout-1");
      const s2 = sm.getSession("scout-1");
      expect(s1).toBe(s2);
    });
  });

  describe("getResumeId", () => {
    it("returns null when no session exists", () => {
      expect(sm.getResumeId("unknown")).toBeNull();
    });

    it("returns session ID after updateSession", () => {
      sm.updateSession("scout-1", "sess-abc");
      expect(sm.getResumeId("scout-1")).toBe("sess-abc");
    });

    it("resets after hitting maxTasks", () => {
      for (let i = 0; i < 5; i++) {
        sm.updateSession("scout-1", "sess-abc");
      }
      // 5 tasks = maxTasks, should reset
      expect(sm.getResumeId("scout-1")).toBeNull();
    });

    it("resets after staleness (30+ min)", () => {
      sm.updateSession("scout-1", "sess-abc");

      // Simulate staleness by modifying lastActive
      const session = sm.getSession("scout-1");
      session.lastActive = Date.now() - 31 * 60 * 1000;

      expect(sm.getResumeId("scout-1")).toBeNull();
    });
  });

  describe("token tracking", () => {
    it("accumulates token usage", () => {
      sm.updateTokenUsage("scout-1", { input: 100, output: 50 });
      sm.updateTokenUsage("scout-1", { input: 200, output: 75, cached: 30 });

      const session = sm.getSession("scout-1");
      expect(session.tokenUsage).toEqual({ input: 300, output: 125, cached: 30 });
    });

    it("reports context usage percentage", () => {
      expect(sm.getContextUsagePercent("unknown")).toBe(0);

      sm.updateTokenUsage("scout-1", { input: 90_000, output: 45_000 });
      const pct = sm.getContextUsagePercent("scout-1");
      expect(pct).toBe(75); // 135000 / 180000 = 75%
    });

    it("detects when summarization is needed", () => {
      expect(sm.needsSummarization("scout-1")).toBe(false);

      sm.updateSession("scout-1", "sess-1");
      sm.updateTokenUsage("scout-1", { input: 100_000, output: 40_000 });

      expect(sm.needsSummarization("scout-1")).toBe(true);
    });

    it("skips summarization when already in progress", () => {
      sm.updateSession("scout-1", "sess-1");
      sm.updateTokenUsage("scout-1", { input: 100_000, output: 40_000 });
      const session = sm.getSession("scout-1");
      session.summarizing = true;

      expect(sm.needsSummarization("scout-1")).toBe(false);
    });
  });

  describe("carryover summary", () => {
    it("stores and consumes carryover", () => {
      sm.setCarryoverSummary("scout-1", "Previous context summary");

      const summary = sm.consumeCarryoverSummary("scout-1");
      expect(summary).toBe("Previous context summary");

      // Second consume returns null (already consumed)
      expect(sm.consumeCarryoverSummary("scout-1")).toBeNull();
    });

    it("returns null for agents without carryover", () => {
      expect(sm.consumeCarryoverSummary("unknown")).toBeNull();
    });
  });

  describe("reset", () => {
    it("resets a single session", () => {
      sm.updateSession("scout-1", "sess-1");
      sm.updateTokenUsage("scout-1", { input: 1000 });

      sm.resetSession("scout-1");
      const session = sm.getSession("scout-1");

      expect(session.sessionId).toBeNull();
      expect(session.taskCount).toBe(0);
      expect(session.tokenUsage).toEqual({ input: 0, output: 0, cached: 0 });
    });

    it("resets all sessions", () => {
      sm.updateSession("a", "sess-a");
      sm.updateSession("b", "sess-b");

      sm.resetAll();

      expect(sm.getResumeId("a")).toBeNull();
      expect(sm.getResumeId("b")).toBeNull();
    });
  });

  describe("getStats", () => {
    it("returns stats for all sessions", () => {
      sm.updateSession("scout-1", "sess-1");
      sm.updateSession("builder-1", "sess-2");

      const stats = sm.getStats();
      expect(stats).toHaveLength(2);
      expect(stats.map((s) => s.agentId).sort()).toEqual(["builder-1", "scout-1"]);
    });
  });
});

describe("extractSessionId", () => {
  it("extracts from result message", () => {
    const output = '{"type":"result","session_id":"sess-xyz-123","cost":0.01}';
    expect(extractSessionId(output)).toBe("sess-xyz-123");
  });

  it("extracts from multi-line output", () => {
    const output = [
      '{"type":"assistant","content":"hello"}',
      '{"type":"result","session_id":"sess-abc","cost":0.02}',
    ].join("\n");
    expect(extractSessionId(output)).toBe("sess-abc");
  });

  it("extracts from top-level session_id", () => {
    const output = '{"session_id":"sess-top"}';
    expect(extractSessionId(output)).toBe("sess-top");
  });

  it("returns null for output without session ID", () => {
    expect(extractSessionId('{"type":"result"}')).toBeNull();
    expect(extractSessionId("not json at all")).toBeNull();
    expect(extractSessionId("")).toBeNull();
  });
});
