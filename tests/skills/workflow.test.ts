import { describe, it, expect, vi } from "vitest";
import {
  Workflow,
  WorkflowBuilder,
  WorkflowAbortError,
} from "../../src/skills/workflow.js";
import type {
  WorkflowStep,
  WorkflowStepResult,
} from "../../src/skills/workflow.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple executor that records which steps were invoked. */
function makeExecutor(
  overrides?: Partial<Record<string, Partial<WorkflowStepResult>>>,
) {
  const invoked: string[] = [];

  const executor = async (
    step: WorkflowStep,
    _prev: WorkflowStepResult[],
  ): Promise<WorkflowStepResult> => {
    invoked.push(step.name);

    const override = overrides?.[step.name];
    return {
      stepName: step.name,
      success: override?.success ?? true,
      output: override?.output ?? `Done: ${step.name}`,
      duration: override?.duration ?? 10,
      agent: step.agent,
    };
  };

  return { executor, invoked };
}

/** Executor that throws on a specific step. */
function makeThrowingExecutor(failStep: string) {
  const invoked: string[] = [];

  const executor = async (
    step: WorkflowStep,
    _prev: WorkflowStepResult[],
  ): Promise<WorkflowStepResult> => {
    invoked.push(step.name);

    if (step.name === failStep) {
      throw new Error(`Step "${failStep}" exploded`);
    }

    return {
      stepName: step.name,
      success: true,
      output: `Done: ${step.name}`,
      duration: 10,
      agent: step.agent,
    };
  };

  return { executor, invoked };
}

// ---------------------------------------------------------------------------
// WorkflowBuilder
// ---------------------------------------------------------------------------

describe("WorkflowBuilder", () => {
  it("builds a workflow with sequential steps", () => {
    const workflow = new WorkflowBuilder("test")
      .then("step-1", { agent: "scout", task: "Do research" })
      .then("step-2", { agent: "builder", task: "Build thing" })
      .build();

    expect(workflow.name).toBe("test");
    expect(workflow.steps).toHaveLength(2);
    expect(workflow.steps[0]!.type).toBe("task");
    expect(workflow.steps[0]!.agent).toBe("scout");
    expect(workflow.steps[1]!.type).toBe("task");
    expect(workflow.steps[1]!.agent).toBe("builder");
  });

  it("builds a workflow with parallel steps", () => {
    const workflow = new WorkflowBuilder("parallel-test")
      .parallel("verify", [
        { agent: "sentinel", task: "Security review" },
        { agent: "builder", task: "Write tests" },
      ])
      .build();

    expect(workflow.steps).toHaveLength(1);

    const parallelStep = workflow.steps[0]!;
    expect(parallelStep.type).toBe("parallel");
    expect(parallelStep.steps).toHaveLength(2);
    expect(parallelStep.steps![0]!.agent).toBe("sentinel");
    expect(parallelStep.steps![1]!.agent).toBe("builder");
  });

  it("builds a workflow with branch steps", () => {
    const workflow = new WorkflowBuilder("branch-test")
      .then("work", { agent: "builder", task: "Do work" })
      .branch("check", {
        when: (r) => !r.success,
        then: { agent: "builder", task: "Fix issues" },
        otherwise: { agent: "courier", task: "Report success" },
      })
      .build();

    expect(workflow.steps).toHaveLength(2);

    const branchStep = workflow.steps[1]!;
    expect(branchStep.type).toBe("branch");
    expect(branchStep.branches).toHaveLength(2);
  });

  it("builds a workflow with checkpoint steps", () => {
    const workflow = new WorkflowBuilder("cp-test")
      .then("step-1", { agent: "scout", task: "Research" })
      .checkpoint("mid-save")
      .then("step-2", { agent: "builder", task: "Build" })
      .build();

    expect(workflow.steps).toHaveLength(3);
    expect(workflow.steps[1]!.type).toBe("checkpoint");
    expect(workflow.steps[1]!.name).toBe("mid-save");
  });

  it("preserves skill references", () => {
    const workflow = new WorkflowBuilder("skill-test")
      .then("scan", { agent: "scout", task: "Run scan", skill: "web-search" })
      .build();

    expect(workflow.steps[0]!.skill).toBe("web-search");
  });

  it("preserves onError config", () => {
    const workflow = new WorkflowBuilder("error-test")
      .then("risky", { agent: "builder", task: "Risky op", onError: "skip" })
      .build();

    expect(workflow.steps[0]!.onError).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// Workflow.execute — sequential
// ---------------------------------------------------------------------------

describe("Workflow.execute", () => {
  it("executes sequential steps in order", async () => {
    const workflow = new WorkflowBuilder("seq")
      .then("a", { agent: "scout", task: "First" })
      .then("b", { agent: "builder", task: "Second" })
      .then("c", { agent: "courier", task: "Third" })
      .build();

    const { executor, invoked } = makeExecutor();
    const result = await workflow.execute(executor);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(invoked).toEqual(["a", "b", "c"]);
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it("provides previous results to each step", async () => {
    const receivedPrev: WorkflowStepResult[][] = [];

    const executor = async (
      step: WorkflowStep,
      prev: WorkflowStepResult[],
    ): Promise<WorkflowStepResult> => {
      receivedPrev.push([...prev]);
      return {
        stepName: step.name,
        success: true,
        output: step.name,
        duration: 1,
      };
    };

    const workflow = new WorkflowBuilder("ctx")
      .then("a", { agent: "scout", task: "First" })
      .then("b", { agent: "builder", task: "Second" })
      .build();

    await workflow.execute(executor);

    // First step sees no previous results
    expect(receivedPrev[0]).toHaveLength(0);
    // Second step sees the first step's result
    expect(receivedPrev[1]).toHaveLength(1);
    expect(receivedPrev[1]![0]!.stepName).toBe("a");
  });

  it("marks result as failed if any step fails", async () => {
    const workflow = new WorkflowBuilder("fail")
      .then("a", { agent: "scout", task: "Ok", onError: "skip" })
      .then("b", { agent: "builder", task: "Fail", onError: "skip" })
      .build();

    const { executor } = makeExecutor({
      b: { success: false, output: "Failed" },
    });

    const result = await workflow.execute(executor);

    expect(result.success).toBe(false);
    expect(result.steps[1]!.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Workflow.execute — parallel
// ---------------------------------------------------------------------------

describe("Workflow.execute — parallel", () => {
  it("executes parallel sub-steps concurrently", async () => {
    const workflow = new WorkflowBuilder("par")
      .parallel("verify", [
        { agent: "sentinel", task: "Review" },
        { agent: "builder", task: "Test" },
      ])
      .build();

    const { executor, invoked } = makeExecutor();
    const result = await workflow.execute(executor);

    expect(result.success).toBe(true);
    // Both sub-steps should have been invoked
    expect(invoked).toHaveLength(2);
    expect(result.steps).toHaveLength(2);
  });

  it("collects results from all parallel branches", async () => {
    const workflow = new WorkflowBuilder("par-results")
      .parallel("multi", [
        { agent: "scout", task: "Research A" },
        { agent: "scout", task: "Research B" },
        { agent: "scout", task: "Research C" },
      ])
      .build();

    const { executor } = makeExecutor();
    const result = await workflow.execute(executor);

    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.success)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Workflow.execute — branch
// ---------------------------------------------------------------------------

describe("Workflow.execute — branch", () => {
  it("takes the matching branch", async () => {
    const workflow = new WorkflowBuilder("branching")
      .then("work", { agent: "builder", task: "Do work" })
      .branch("gate", {
        when: (r) => r.success,
        then: { agent: "courier", task: "Report success" },
        otherwise: { agent: "builder", task: "Fix issues" },
      })
      .build();

    const { executor, invoked } = makeExecutor();
    const result = await workflow.execute(executor);

    expect(result.success).toBe(true);
    // work + branch-then step
    expect(invoked).toContain("gate-then");
    expect(invoked).not.toContain("gate-otherwise");
  });

  it("takes the otherwise branch when condition is false", async () => {
    const workflow = new WorkflowBuilder("branching-else")
      .then("work", { agent: "builder", task: "Do work" })
      .branch("gate", {
        when: (r) => !r.success,
        then: { agent: "builder", task: "Fix" },
        otherwise: { agent: "courier", task: "Ship it" },
      })
      .build();

    const { executor, invoked } = makeExecutor();
    const result = await workflow.execute(executor);

    // "work" succeeds, so when(!success) is false → otherwise branch
    expect(invoked).toContain("gate-otherwise");
    expect(invoked).not.toContain("gate-then");
    expect(result.success).toBe(true);
  });

  it("skips branch when no condition matches and no otherwise", async () => {
    const workflow = new WorkflowBuilder("skip-branch")
      .then("work", { agent: "builder", task: "Do work" })
      .branch("gate", {
        when: (r) => !r.success,
        then: { agent: "builder", task: "Fix" },
      })
      .build();

    const { executor, invoked } = makeExecutor();
    const result = await workflow.execute(executor);

    expect(result.success).toBe(true);
    // Branch was not taken — only "work" was invoked via executor
    expect(invoked).not.toContain("gate-then");
  });
});

// ---------------------------------------------------------------------------
// Workflow.execute — error handling
// ---------------------------------------------------------------------------

describe("Workflow.execute — error handling", () => {
  it("aborts on error by default", async () => {
    const workflow = new WorkflowBuilder("abort-test")
      .then("a", { agent: "scout", task: "Ok" })
      .then("b", { agent: "builder", task: "Boom" })
      .then("c", { agent: "courier", task: "Never reached" })
      .build();

    const { executor, invoked } = makeThrowingExecutor("b");

    await expect(workflow.execute(executor)).rejects.toThrow(
      WorkflowAbortError,
    );
    expect(invoked).toEqual(["a", "b"]);
  });

  it("skips step on error when onError is 'skip'", async () => {
    const workflow = new WorkflowBuilder("skip-test")
      .then("a", { agent: "scout", task: "Ok" })
      .then("b", { agent: "builder", task: "Boom", onError: "skip" })
      .then("c", { agent: "courier", task: "Continues" })
      .build();

    const { executor, invoked } = makeThrowingExecutor("b");
    const result = await workflow.execute(executor);

    // b failed but was skipped; c should still run
    expect(invoked).toEqual(["a", "b", "c"]);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[1]!.success).toBe(false);
    expect(result.steps[2]!.success).toBe(true);
  });

  it("reports retry failure when onError is 'retry'", async () => {
    const workflow = new WorkflowBuilder("retry-test")
      .then("a", { agent: "scout", task: "Ok" })
      .then("b", { agent: "builder", task: "Boom", onError: "retry" })
      .then("c", { agent: "courier", task: "Continues" })
      .build();

    const { executor, invoked } = makeThrowingExecutor("b");
    const result = await workflow.execute(executor);

    expect(invoked).toEqual(["a", "b", "c"]);
    expect(result.steps[1]!.success).toBe(false);
    expect(result.steps[1]!.output).toContain("retry");
  });

  it("handles errors in parallel sub-steps with skip", async () => {
    const workflow = new WorkflowBuilder("par-err")
      .parallel("multi", [
        { agent: "scout", task: "Ok" },
        { agent: "builder", task: "Boom", onError: "skip" },
      ])
      .build();

    const { executor } = makeThrowingExecutor("multi-1");
    const result = await workflow.execute(executor);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.success).toBe(true);
    expect(result.steps[1]!.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Workflow.describe
// ---------------------------------------------------------------------------

describe("Workflow.describe", () => {
  it("generates a human-readable description", () => {
    const workflow = new WorkflowBuilder("feature-dev")
      .then("research", { agent: "scout", task: "Research best practices" })
      .then("implement", { agent: "builder", task: "Build feature" })
      .parallel("verify", [
        { agent: "sentinel", task: "Security review" },
        { agent: "builder", task: "Write tests" },
      ])
      .branch("quality-gate", {
        when: (r) => !r.success,
        then: { agent: "builder", task: "Fix issues" },
      })
      .then("document", { agent: "courier", task: "Write release notes" })
      .build();

    const desc = workflow.describe();

    expect(desc).toContain("Workflow: feature-dev");
    expect(desc).toContain("[scout]");
    expect(desc).toContain("research");
    expect(desc).toContain("[builder]");
    expect(desc).toContain("[parallel] verify");
    expect(desc).toContain("[sentinel]");
    expect(desc).toContain("[branch] quality-gate");
    expect(desc).toContain("[courier]");
  });
});

// ---------------------------------------------------------------------------
// Workflow serialization
// ---------------------------------------------------------------------------

describe("Workflow serialization", () => {
  it("round-trips through toJSON / fromJSON", () => {
    const original = new WorkflowBuilder("round-trip")
      .then("step-1", { agent: "scout", task: "Research" })
      .parallel("verify", [
        { agent: "sentinel", task: "Review" },
        { agent: "builder", task: "Test" },
      ])
      .branch("gate", {
        when: (r) => !r.success,
        then: { agent: "builder", task: "Fix" },
      })
      .then("ship", { agent: "courier", task: "Deploy", onError: "skip" })
      .build();

    const json = original.toJSON();
    const restored = Workflow.fromJSON(json);

    expect(restored.name).toBe("round-trip");
    expect(restored.steps).toHaveLength(4);
    expect(restored.steps[0]!.type).toBe("task");
    expect(restored.steps[0]!.agent).toBe("scout");
    expect(restored.steps[1]!.type).toBe("parallel");
    expect(restored.steps[1]!.steps).toHaveLength(2);
    expect(restored.steps[2]!.type).toBe("branch");
    expect(restored.steps[2]!.branches).toHaveLength(1);
    expect(restored.steps[3]!.onError).toBe("skip");
  });

  it("toJSON serializes functions as descriptive strings", () => {
    const workflow = new WorkflowBuilder("json-test")
      .branch("b", {
        when: (r) => r.success,
        then: { agent: "scout", task: "Next" },
      })
      .build();

    const json = workflow.toJSON();
    const steps = json["steps"] as Array<Record<string, unknown>>;
    const branches = steps[0]!["branches"] as Array<Record<string, unknown>>;
    expect(branches[0]!["when"]).toBe("[function]");
  });

  it("fromJSON restores branch conditions as always-true stubs", async () => {
    const workflow = new WorkflowBuilder("stub-test")
      .then("work", { agent: "builder", task: "Work" })
      .branch("gate", {
        when: (r) => !r.success,
        then: { agent: "builder", task: "Fix" },
      })
      .build();

    const json = workflow.toJSON();
    const restored = Workflow.fromJSON(json);

    // The restored branch condition should be always-true
    const branchStep = restored.steps[1]!;
    const branchFn = branchStep.branches![0]!.when;
    const fakeResult: WorkflowStepResult = {
      stepName: "test",
      success: true,
      output: "",
      duration: 0,
    };
    expect(branchFn(fakeResult)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full integration test
// ---------------------------------------------------------------------------

describe("Full workflow integration", () => {
  it("executes a complete multi-phase workflow", async () => {
    const workflow = new WorkflowBuilder("feature-development")
      .then("research", {
        agent: "scout",
        task: "Research best practices for X",
      })
      .then("implement", {
        agent: "builder",
        task: "Build feature based on research",
      })
      .parallel("verify", [
        { agent: "sentinel", task: "Security review of new code" },
        { agent: "builder", task: "Write tests for new feature" },
      ])
      .branch("quality-gate", {
        when: (result) => !result.success,
        then: { agent: "builder", task: "Fix issues found in review" },
      })
      .then("document", {
        agent: "courier",
        task: "Write release notes",
      })
      .build();

    const { executor, invoked } = makeExecutor();
    const result = await workflow.execute(executor);

    expect(result.success).toBe(true);
    // research, implement, 2 parallel, (branch skipped), document
    expect(invoked).toHaveLength(5);
    expect(invoked).toContain("research");
    expect(invoked).toContain("implement");
    expect(invoked).toContain("document");
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it("handles a workflow where a branch is taken", async () => {
    const workflow = new WorkflowBuilder("fix-flow")
      .then("build", { agent: "builder", task: "Build it" })
      .branch("check", {
        when: (r) => !r.success,
        then: { agent: "builder", task: "Fix it" },
        otherwise: { agent: "courier", task: "Ship it" },
      })
      .build();

    // Make the build step fail
    const { executor, invoked } = makeExecutor({
      build: { success: false, output: "Build failed" },
    });

    const result = await workflow.execute(executor);

    // Build failed, so "when(!success)" is true → "then" branch taken
    expect(invoked).toContain("check-then");
    expect(invoked).not.toContain("check-otherwise");
    expect(result.steps).toHaveLength(2);
  });
});
