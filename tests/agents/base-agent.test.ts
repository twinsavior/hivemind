import { describe, it, expect, vi } from "vitest";
import {
  BaseAgent,
  type AgentIdentity,
  type ThinkResult,
  type ActResult,
  type Observation,
  type AgentMessage,
} from "../../src/agents/base-agent.js";

/** Minimal concrete agent for testing the base class. */
class TestAgent extends BaseAgent {
  thinkFn = vi.fn<[unknown], Promise<ThinkResult>>();
  actFn = vi.fn<[ThinkResult], Promise<ActResult>>();
  observeFn = vi.fn<[Record<string, unknown>], Promise<Observation[]>>();
  reportFn = vi.fn<[], Promise<Record<string, unknown>>>();

  constructor(id = "test-1") {
    super({ id, name: "Test", role: "testing", version: "1.0.0" });
  }

  async think(input: unknown) {
    return this.thinkFn(input);
  }
  async act(plan: ThinkResult) {
    return this.actFn(plan);
  }
  async observe(ctx: Record<string, unknown>) {
    return this.observeFn(ctx);
  }
  async report() {
    return this.reportFn();
  }
}

describe("BaseAgent", () => {
  // -------------------------------------------------------------------
  // State machine transitions
  // -------------------------------------------------------------------

  describe("state machine", () => {
    it("starts in idle state", () => {
      const agent = new TestAgent();
      expect(agent.getState()).toBe("idle");
    });

    it("transitions through think → act → report on execute()", async () => {
      const agent = new TestAgent();
      const states: string[] = [];

      agent.on("state:change", (e) => states.push(e.to));

      agent.thinkFn.mockResolvedValue({
        reasoning: "test",
        plan: [],
        toolCalls: [],
        confidence: 1,
      });
      agent.actFn.mockResolvedValue({
        toolResults: [],
        output: null,
        nextAction: "report",
      });
      agent.reportFn.mockResolvedValue({ done: true });

      await agent.execute("task");

      expect(states).toEqual(["thinking", "acting", "idle"]);
      expect(agent.getState()).toBe("idle");
    });

    it("enters waiting state when act returns observe", async () => {
      const agent = new TestAgent();
      const states: string[] = [];
      agent.on("state:change", (e) => states.push(e.to));

      agent.thinkFn.mockResolvedValue({
        reasoning: "test",
        plan: [],
        toolCalls: [],
        confidence: 1,
      });
      agent.actFn.mockResolvedValue({
        toolResults: [],
        output: null,
        nextAction: "observe",
      });
      agent.observeFn.mockResolvedValue([]);
      agent.reportFn.mockResolvedValue({ done: true });

      await agent.execute("task");

      expect(states).toContain("waiting");
    });

    it("transitions to error on think failure", async () => {
      const agent = new TestAgent();
      agent.thinkFn.mockRejectedValue(new Error("boom"));

      await expect(agent.execute("task")).rejects.toThrow("boom");
      expect(agent.getState()).toBe("error");
    });

    it("recovers from error state on next execute", async () => {
      const agent = new TestAgent();
      agent.thinkFn.mockRejectedValueOnce(new Error("boom"));

      await expect(agent.execute("task")).rejects.toThrow();
      expect(agent.getState()).toBe("error");

      // Second call should reset and succeed
      agent.thinkFn.mockResolvedValue({
        reasoning: "ok",
        plan: [],
        toolCalls: [],
        confidence: 1,
      });
      agent.actFn.mockResolvedValue({ toolResults: [], output: null });
      agent.reportFn.mockResolvedValue({ recovered: true });

      const result = await agent.execute("task2");
      expect(result).toEqual({ recovered: true });
      expect(agent.getState()).toBe("idle");
    });
  });

  // -------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------

  describe("memory", () => {
    it("stores and recalls values", () => {
      const agent = new TestAgent();
      (agent as any).remember("key1", "value1");
      expect((agent as any).recall("key1")).toBe("value1");
    });

    it("expires entries after TTL", () => {
      const agent = new TestAgent();
      (agent as any).remember("temp", "data", 1); // 1ms TTL

      // Force expiry by backdating the timestamp
      const entry = (agent as any).memory.get("temp");
      entry.timestamp = Date.now() - 100;
      expect((agent as any).recall("temp")).toBeUndefined();
    });

    it("prunes expired entries", () => {
      const agent = new TestAgent();
      (agent as any).remember("a", 1, 1);
      (agent as any).remember("b", 2); // No TTL

      // Force expiry
      const entry = (agent as any).memory.get("a");
      entry.timestamp = Date.now() - 100;

      const pruned = (agent as any).pruneMemory();
      expect(pruned).toBe(1);
      expect((agent as any).recall("a")).toBeUndefined();
      expect((agent as any).recall("b")).toBe(2);
    });
  });

  // -------------------------------------------------------------------
  // Delegation & messaging
  // -------------------------------------------------------------------

  describe("delegation", () => {
    it("emits delegate event with correct message", () => {
      const agent = new TestAgent();
      const handler = vi.fn();
      agent.on("delegate", handler);

      agent.delegate("engineering", { task: "build X" }, "needs code");

      expect(handler).toHaveBeenCalledOnce();
      const msg: AgentMessage = handler.mock.calls[0][0];
      expect(msg.from).toBe("test-1");
      expect(msg.to).toBe("engineering");
      expect(msg.type).toBe("task");
      expect(msg.payload).toMatchObject({
        task: { task: "build X" },
        reason: "needs code",
        delegatedBy: "test-1",
      });
    });

    it("sends and receives messages", () => {
      const agent = new TestAgent();
      const handler = vi.fn();
      agent.on("message:received", handler);

      const msg: AgentMessage = {
        from: "other-agent",
        to: "test-1",
        type: "result",
        payload: { data: 42 },
        timestamp: Date.now(),
        correlationId: "test-corr",
      };

      agent.receiveMessage(msg);

      expect(handler).toHaveBeenCalledWith(msg);
      expect((agent as any).inbox).toHaveLength(1);
    });

    it("hasCapability checks registered capabilities", () => {
      const agent = new TestAgent();
      (agent as any).capabilities = [
        { name: "web_search", description: "search", parameters: {} },
      ];

      expect(agent.hasCapability("web_search")).toBe(true);
      expect(agent.hasCapability("deploy")).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------

  describe("healthCheck", () => {
    it("returns agent status snapshot", () => {
      const agent = new TestAgent();
      const health = agent.healthCheck();

      expect(health.id).toBe("test-1");
      expect(health.state).toBe("idle");
      expect(health.memorySize).toBe(0);
      expect(health.taskCount).toBe(0);
    });
  });
});
