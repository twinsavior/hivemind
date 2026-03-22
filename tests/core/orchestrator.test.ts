import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "../../src/core/orchestrator.js";
import {
  BaseAgent,
  type ThinkResult,
  type ActResult,
  type Observation,
} from "../../src/agents/base-agent.js";

/** Minimal agent for orchestrator tests. */
class StubAgent extends BaseAgent {
  executeDelay = 0;

  constructor(id: string, role: string) {
    super({ id, name: id, role, version: "1.0.0" });
  }

  async think(): Promise<ThinkResult> {
    return { reasoning: "stub", plan: [], toolCalls: [], confidence: 1 };
  }

  async act(): Promise<ActResult> {
    if (this.executeDelay > 0) {
      await new Promise((r) => setTimeout(r, this.executeDelay));
    }
    return { toolResults: [], output: { agent: this.identity.id } };
  }

  async observe(): Promise<Observation[]> {
    return [];
  }

  async report() {
    return { agent: this.identity.id, done: true };
  }
}

describe("Orchestrator", () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    orchestrator = new Orchestrator(4, 60_000);
  });

  afterEach(async () => {
    await orchestrator.stop();
  });

  describe("agent registration", () => {
    it("registers and lists agents", () => {
      const scout = new StubAgent("scout-1", "research");
      const builder = new StubAgent("builder-1", "engineering");

      orchestrator.register(scout);
      orchestrator.register(builder);

      const status = orchestrator.getAgentStatus();
      expect(status).toHaveLength(2);
      expect(status.map((s) => s.id)).toContain("scout-1");
      expect(status.map((s) => s.id)).toContain("builder-1");
    });

    it("unregisters agents cleanly", () => {
      const agent = new StubAgent("temp-1", "research");
      orchestrator.register(agent);
      orchestrator.unregister("temp-1");

      expect(orchestrator.getAgentStatus()).toHaveLength(0);
    });
  });

  describe("role-based routing", () => {
    it("finds agents by role", () => {
      const scout = new StubAgent("scout-1", "research");
      const builder = new StubAgent("builder-1", "engineering");

      orchestrator.register(scout);
      orchestrator.register(builder);

      const found = orchestrator.findAgentByRole("engineering");
      expect(found?.agent.identity.id).toBe("builder-1");
    });

    it("returns undefined for unknown roles", () => {
      const scout = new StubAgent("scout-1", "research");
      orchestrator.register(scout);

      expect(orchestrator.findAgentByRole("unknown")).toBeUndefined();
    });

    it("finds agents by capability", () => {
      const scout = new StubAgent("scout-1", "research");
      (scout as any).capabilities = [
        { name: "web_search", description: "search", parameters: {} },
      ];
      orchestrator.register(scout);

      const found = orchestrator.findAgentByCapability("web_search");
      expect(found?.agent.identity.id).toBe("scout-1");
    });
  });

  describe("task delegation", () => {
    it("routes delegated tasks from scout to builder", async () => {
      const scout = new StubAgent("scout-1", "research");
      const builder = new StubAgent("builder-1", "engineering");

      orchestrator.register(scout);
      orchestrator.register(builder);
      orchestrator.start();

      const delegationRouted = vi.fn();
      orchestrator.on("delegation:routed", delegationRouted);

      // Scout delegates to engineering role
      scout.delegate("engineering", { spec: "build feature X" }, "needs code changes");

      // Give the event loop a tick
      await new Promise((r) => setTimeout(r, 50));

      expect(delegationRouted).toHaveBeenCalledOnce();
      expect(delegationRouted.mock.calls[0][0]).toMatchObject({
        from: "scout-1",
        to: "builder-1",
      });
    });

    it("emits delegation:failed for unknown roles", async () => {
      const scout = new StubAgent("scout-1", "research");
      orchestrator.register(scout);

      const failed = vi.fn();
      orchestrator.on("delegation:failed", failed);

      scout.delegate("nonexistent", {}, "test");

      await new Promise((r) => setTimeout(r, 10));

      expect(failed).toHaveBeenCalledOnce();
      expect(failed.mock.calls[0][0].targetRole).toBe("nonexistent");
    });
  });

  describe("inter-agent messaging", () => {
    it("routes messages between agents by ID", () => {
      const a = new StubAgent("agent-a", "research");
      const b = new StubAgent("agent-b", "engineering");

      const received = vi.fn();
      b.on("message:received", received);

      orchestrator.register(a);
      orchestrator.register(b);

      a.sendMessage("agent-b", "query", { question: "status?" });

      expect(received).toHaveBeenCalledOnce();
      expect(received.mock.calls[0][0].payload).toEqual({ question: "status?" });
    });

    it("routes messages by role as fallback", () => {
      const a = new StubAgent("agent-a", "research");
      const b = new StubAgent("agent-b", "engineering");

      const received = vi.fn();
      b.on("message:received", received);

      orchestrator.register(a);
      orchestrator.register(b);

      a.sendMessage("engineering", "query", { data: 1 });

      expect(received).toHaveBeenCalledOnce();
    });

    it("broadcasts to all except sender", () => {
      const a = new StubAgent("agent-a", "research");
      const b = new StubAgent("agent-b", "engineering");
      const c = new StubAgent("agent-c", "monitor");

      const bReceived = vi.fn();
      const cReceived = vi.fn();
      b.on("message:received", bReceived);
      c.on("message:received", cReceived);

      orchestrator.register(a);
      orchestrator.register(b);
      orchestrator.register(c);

      a.sendMessage("all", "broadcast", { alert: "heads up" });

      expect(bReceived).toHaveBeenCalledOnce();
      expect(cReceived).toHaveBeenCalledOnce();
    });
  });

  describe("task assignment", () => {
    it("assigns tasks directly to agents", async () => {
      const agent = new StubAgent("worker-1", "engineering");
      orchestrator.register(agent);

      const completed = vi.fn();
      orchestrator.on("task:completed", completed);

      // Access private enqueue via deploySwarm which uses it
      orchestrator.start();
      const deployment = await orchestrator.deploySwarm("test objective", ["worker-1"]);

      // Wait for tasks to complete
      await new Promise((r) => setTimeout(r, 200));

      expect(deployment.status).toBe("active");
    });
  });

  describe("swarm deployment", () => {
    it("decomposes objective into subtasks", async () => {
      const a = new StubAgent("a-1", "research");
      const b = new StubAgent("b-1", "engineering");

      orchestrator.register(a);
      orchestrator.register(b);
      orchestrator.start();

      const queued = vi.fn();
      orchestrator.on("task:queued", queued);

      await orchestrator.deploySwarm("build a feature", ["a-1", "b-1"]);

      // Root task + 4 subtasks from decompose()
      expect(queued.mock.calls.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("dynamic agent spawning (#9)", () => {
    it("spawns agents from registered factories", () => {
      orchestrator.registerFactory("research", (id) => new StubAgent(id ?? "scout-new", "research"));

      const agentId = orchestrator.spawnAgent("research");
      expect(agentId).toBe("scout-new");

      const status = orchestrator.getAgentStatus();
      expect(status).toHaveLength(1);
      expect(status[0].id).toBe("scout-new");
    });

    it("spawns agents with custom IDs", () => {
      orchestrator.registerFactory("engineering", (id) => new StubAgent(id ?? "b-new", "engineering"));

      const agentId = orchestrator.spawnAgent("engineering", "builder-custom-42");
      expect(agentId).toBe("builder-custom-42");
    });

    it("throws when no factory is registered", () => {
      expect(() => orchestrator.spawnAgent("unknown")).toThrow("No factory registered");
    });

    it("throws when at capacity", () => {
      // maxConcurrent is 4
      orchestrator.registerFactory("research", (id) => new StubAgent(id ?? `s-${Date.now()}`, "research"));

      orchestrator.spawnAgent("research", "a1");
      orchestrator.spawnAgent("research", "a2");
      orchestrator.spawnAgent("research", "a3");
      orchestrator.spawnAgent("research", "a4");

      expect(() => orchestrator.spawnAgent("research", "a5")).toThrow("at capacity");
    });

    it("despawns idle agents", () => {
      orchestrator.registerFactory("research", (id) => new StubAgent(id ?? "temp", "research"));
      orchestrator.spawnAgent("research", "temp-agent");

      expect(orchestrator.despawnAgent("temp-agent")).toBe(true);
      expect(orchestrator.getAgentStatus()).toHaveLength(0);
    });
  });

  describe("config enforcement (#2)", () => {
    it("applies config limits", () => {
      orchestrator.applyConfig({
        maxConcurrentAgents: 2,
        taskTimeout: 60_000,
        healthCheckInterval: 10_000,
      });

      orchestrator.registerFactory("research", (id) => new StubAgent(id ?? "s", "research"));
      orchestrator.spawnAgent("research", "a1");
      orchestrator.spawnAgent("research", "a2");

      expect(() => orchestrator.spawnAgent("research", "a3")).toThrow("at capacity");
    });

    it("emits config:applied event", () => {
      const handler = vi.fn();
      orchestrator.on("config:applied", handler);

      orchestrator.applyConfig({ maxConcurrentAgents: 16 });
      expect(handler).toHaveBeenCalledOnce();
    });
  });
});
