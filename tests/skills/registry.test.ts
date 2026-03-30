import { describe, it, expect } from "vitest";
import {
  SkillRegistry,
  DependencyCycleError,
  MissingDependencyError,
} from "../../src/skills/registry.js";
import type { SkillDefinition, AgentRole } from "../../src/skills/types.js";

function makeSkill(
  name: string,
  opts: { agent?: AgentRole; tags?: string[]; triggers?: string[]; dependencies?: string[]; optional?: boolean } = {},
): SkillDefinition {
  return {
    metadata: {
      name,
      version: "1.0.0",
      agent: opts.agent ?? "scout",
      description: `Skill ${name}`,
      triggers: opts.triggers ?? [name],
      dependencies: opts.dependencies ?? [],
      requiredSecrets: [],
      timeout: 300,
      tags: opts.tags ?? [],
      author: "test",
      optional: opts.optional,
    },
    instructions: `Instructions for ${name}`,
    sourcePath: `/skills/${name}.md`,
    contentHash: "abc123",
    loadedAt: new Date(),
  };
}

describe("SkillRegistry", () => {
  describe("CRUD", () => {
    it("registers and retrieves skills", () => {
      const reg = new SkillRegistry();
      const skill = makeSkill("web-search");

      reg.register(skill);

      expect(reg.get("web-search")).toBe(skill);
      expect(reg.list()).toHaveLength(1);
    });

    it("unregisters skills", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("a"));
      reg.register(makeSkill("b"));

      expect(reg.unregister("a")).toBe(true);
      expect(reg.list()).toHaveLength(1);
      expect(reg.unregister("nonexistent")).toBe(false);
    });

    it("updates skills on re-register", () => {
      const reg = new SkillRegistry();
      const v1 = makeSkill("x");
      const v2 = makeSkill("x");
      v2.metadata.version = "2.0.0";

      reg.register(v1);
      reg.register(v2);

      expect(reg.get("x")?.metadata.version).toBe("2.0.0");
      expect(reg.list()).toHaveLength(1);
    });
  });

  describe("query", () => {
    it("filters by agent role", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("a", { agent: "scout" }));
      reg.register(makeSkill("b", { agent: "builder" }));
      reg.register(makeSkill("c", { agent: "scout" }));

      const results = reg.query({ agent: "scout" });
      expect(results).toHaveLength(2);
    });

    it("filters by tags", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("a", { tags: ["web", "research"] }));
      reg.register(makeSkill("b", { tags: ["code", "deploy"] }));

      const results = reg.query({ tags: ["web"] });
      expect(results).toHaveLength(1);
      expect(results[0].metadata.name).toBe("a");
    });

    it("searches by free text", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("web-search", { tags: ["research"] }));
      reg.register(makeSkill("deploy-app", { tags: ["deploy"] }));

      const results = reg.query({ search: "web" });
      expect(results).toHaveLength(1);
    });

    it("matches triggers against prompts", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("search", { triggers: ["search for", "look up"] }));
      reg.register(makeSkill("deploy", { triggers: ["deploy to", "ship it"] }));

      const matches = reg.matchTriggers("can you search for something");
      expect(matches).toHaveLength(1);
      expect(matches[0].metadata.name).toBe("search");
    });
  });

  describe("dependency resolution", () => {
    it("resolves linear dependency chains", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("a"));
      reg.register(makeSkill("b", { dependencies: ["a"] }));
      reg.register(makeSkill("c", { dependencies: ["b"] }));

      const order = reg.resolveDependencies("c");
      const names = order.map((s) => s.metadata.name);

      expect(names).toEqual(["a", "b", "c"]);
    });

    it("resolves diamond dependencies", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("base"));
      reg.register(makeSkill("left", { dependencies: ["base"] }));
      reg.register(makeSkill("right", { dependencies: ["base"] }));
      reg.register(makeSkill("top", { dependencies: ["left", "right"] }));

      const order = reg.resolveDependencies("top");
      const names = order.map((s) => s.metadata.name);

      // base must come before left and right; both before top
      expect(names.indexOf("base")).toBeLessThan(names.indexOf("left"));
      expect(names.indexOf("base")).toBeLessThan(names.indexOf("right"));
      expect(names.indexOf("left")).toBeLessThan(names.indexOf("top"));
    });

    it("detects dependency cycles", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("a", { dependencies: ["b"] }));
      reg.register(makeSkill("b", { dependencies: ["c"] }));
      reg.register(makeSkill("c", { dependencies: ["a"] }));

      expect(() => reg.resolveDependencies("a")).toThrow(DependencyCycleError);
    });

    it("detects self-referential dependencies", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("loop", { dependencies: ["loop"] }));

      expect(() => reg.resolveDependencies("loop")).toThrow(DependencyCycleError);
    });

    it("throws on missing dependencies", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("a", { dependencies: ["missing"] }));

      expect(() => reg.resolveDependencies("a")).toThrow(MissingDependencyError);
    });
  });

  describe("stats", () => {
    it("counts skills by agent role", () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill("a", { agent: "scout" }));
      reg.register(makeSkill("b", { agent: "scout" }));
      reg.register(makeSkill("c", { agent: "builder" }));

      const s = reg.stats();
      expect(s.total).toBe(3);
      expect(s.scout).toBe(2);
      expect(s.builder).toBe(1);
    });
  });

  describe("matchSellerIntent", () => {
    it("matches Amazon domain terms", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("amazon-seller-expert", { triggers: ["amazon seller"] }));

      const result = registry.matchSellerIntent("what is my ASIN defect rate?");
      expect(result.length).toBe(1);
      expect(result[0].metadata.name).toBe("amazon-seller-expert");
    });

    it("matches eBay domain terms", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("ebay-seller-expert", { triggers: ["ebay seller"] }));

      const result = registry.matchSellerIntent("how do I handle a VERO complaint?");
      expect(result.length).toBe(1);
      expect(result[0].metadata.name).toBe("ebay-seller-expert");
    });

    it("matches Walmart domain terms", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("walmart-seller-expert", { triggers: ["walmart seller"] }));

      const result = registry.matchSellerIntent("how does WFS two-day shipping work?");
      expect(result.length).toBe(1);
      expect(result[0].metadata.name).toBe("walmart-seller-expert");
    });

    it("returns empty for non-seller queries", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("amazon-seller-expert", { triggers: ["amazon seller"] }));

      const result = registry.matchSellerIntent("how do I make a website?");
      expect(result.length).toBe(0);
    });

    it("matches multiple marketplaces in one query", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("amazon-seller-expert", { triggers: ["amazon seller"] }));
      registry.register(makeSkill("ebay-seller-expert", { triggers: ["ebay seller"] }));

      const result = registry.matchSellerIntent("compare FBA fees vs final value fee");
      expect(result.length).toBe(2);
    });

    it("skips optional skills", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("amazon-seller-expert", { triggers: ["amazon seller"], optional: true }));

      const result = registry.matchSellerIntent("what is FBA?");
      expect(result.length).toBe(0);
    });

    it("returns empty when skill is not registered", () => {
      const registry = new SkillRegistry();
      // Don't register any skills
      const result = registry.matchSellerIntent("what is my ASIN defect rate?");
      expect(result.length).toBe(0);
    });

    // Suspension, appeal, and account restriction coverage
    it("matches 'Amazon suspended me, what do I do?'", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("amazon-seller-expert", { triggers: ["amazon seller"] }));

      const result = registry.matchSellerIntent("Amazon suspended me, what do I do?");
      expect(result.length).toBe(1);
      expect(result[0].metadata.name).toBe("amazon-seller-expert");
    });

    it("matches 'My account got restricted'", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("amazon-seller-expert", { triggers: ["amazon seller"] }));

      const result = registry.matchSellerIntent("My account got restricted");
      expect(result.length).toBe(1);
      expect(result[0].metadata.name).toBe("amazon-seller-expert");
    });

    it("matches 'I need to appeal a deactivation'", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("amazon-seller-expert", { triggers: ["amazon seller"] }));

      const result = registry.matchSellerIntent("I need to appeal a deactivation");
      expect(result.length).toBe(1);
      expect(result[0].metadata.name).toBe("amazon-seller-expert");
    });

    it("matches 'my seller account suspended' without marketplace name", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("amazon-seller-expert", { triggers: ["amazon seller"] }));

      const result = registry.matchSellerIntent("my seller account suspended, need help with reinstatement");
      expect(result.length).toBe(1);
      expect(result[0].metadata.name).toBe("amazon-seller-expert");
    });

    it("matches walmart suspension phrasing", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("walmart-seller-expert", { triggers: ["walmart seller"] }));

      const result = registry.matchSellerIntent("Walmart suspended my account");
      expect(result.length).toBe(1);
      expect(result[0].metadata.name).toBe("walmart-seller-expert");
    });

    it("matches ebay restriction phrasing", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("ebay-seller-expert", { triggers: ["ebay seller"] }));

      const result = registry.matchSellerIntent("eBay restricted my selling limits");
      expect(result.length).toBe(1);
      expect(result[0].metadata.name).toBe("ebay-seller-expert");
    });

    it("matches 'performance notification' for Amazon", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("amazon-seller-expert", { triggers: ["amazon seller"] }));

      const result = registry.matchSellerIntent("I got a performance notification, what should I do?");
      expect(result.length).toBe(1);
      expect(result[0].metadata.name).toBe("amazon-seller-expert");
    });

    it("matches 'inauthentic complaint' for Amazon", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("amazon-seller-expert", { triggers: ["amazon seller"] }));

      const result = registry.matchSellerIntent("how do I respond to an inauthentic complaint?");
      expect(result.length).toBe(1);
    });
  });
});
