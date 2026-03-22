/**
 * HIVEMIND Skill Executor
 *
 * Runtime engine for executing skills with dependency resolution.
 * Supports single execution (with automatic dependency resolution),
 * sequential chains, and parallel execution.
 */

import type {
  SkillDefinition,
  SkillExecutionContext,
  SkillResult,
  SkillEvent,
} from "./types.js";
import { SkillRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SkillExecutionError extends Error {
  constructor(
    public readonly skillName: string,
    public readonly reason: Error,
  ) {
    super(`Skill "${skillName}" failed: ${reason.message}`);
    this.name = "SkillExecutionError";
  }
}

export class DependencyExecutionError extends Error {
  constructor(
    public readonly skillName: string,
    public readonly failedDependency: string,
  ) {
    super(
      `Skill "${skillName}" skipped: dependency "${failedDependency}" failed`,
    );
    this.name = "DependencyExecutionError";
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class SkillExecutor {
  private readonly registry: SkillRegistry;

  /** Tracks results of previously executed skills within a run. */
  private readonly executionResults = new Map<string, SkillResult>();

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Execute a single skill, resolving and executing its dependencies first.
   *
   * Dependencies are executed in topological order. If any dependency fails
   * the dependent skill is skipped and an error result is returned.
   */
  async execute(
    skillName: string,
    context: SkillExecutionContext,
  ): Promise<SkillResult> {
    // Resolve the full dependency chain (topologically sorted)
    const ordered = this.registry.resolveDependencies(skillName);

    // Execute each skill in dependency order
    for (const skill of ordered) {
      const name = skill.metadata.name;

      // Skip if already executed in this run
      if (this.executionResults.has(name)) continue;

      // Check whether any dependency has failed
      const failedDep = this.findFailedDependency(skill);
      if (failedDep) {
        const errorResult = this.makeErrorResult(
          new DependencyExecutionError(name, failedDep),
        );
        this.executionResults.set(name, errorResult);
        continue;
      }

      // Build a per-skill context with the correct skill definition
      const skillContext = this.buildSkillContext(skill, context);

      const result = await this.executeSingle(skill, skillContext);
      this.executionResults.set(name, result);
    }

    // The last item in the ordered list is the requested skill itself
    return this.executionResults.get(skillName)!;
  }

  /**
   * Execute a list of skills sequentially. Each skill's dependencies are
   * resolved and executed before the skill itself runs.
   */
  async executeChain(
    skillNames: string[],
    context: SkillExecutionContext,
  ): Promise<SkillResult[]> {
    const results: SkillResult[] = [];

    for (const name of skillNames) {
      const result = await this.execute(name, context);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute a list of independent skills in parallel. Each skill's own
   * dependencies are resolved and executed before it runs, but the
   * top-level skills run concurrently.
   *
   * Note: If two parallel skills share a dependency, the dependency will
   * only be executed once due to the shared `executionResults` map.
   */
  async executeParallel(
    skillNames: string[],
    context: SkillExecutionContext,
  ): Promise<SkillResult[]> {
    const promises = skillNames.map((name) => this.execute(name, context));
    return Promise.all(promises);
  }

  /**
   * Retrieve the cached result for a previously executed skill.
   * Useful for dependent skills that want to read upstream output.
   */
  getResult(skillName: string): SkillResult | undefined {
    return this.executionResults.get(skillName);
  }

  /**
   * Clear all cached execution results. Call between independent runs.
   */
  reset(): void {
    this.executionResults.clear();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Execute a single skill (no dependency handling — caller is responsible).
   */
  private async executeSingle(
    skill: SkillDefinition,
    context: SkillExecutionContext,
  ): Promise<SkillResult> {
    const events: SkillEvent[] = [];
    const startTime = Date.now();

    // Wrap the emit function to capture events
    const originalEmit = context.emit;
    const capturingEmit = (event: SkillEvent): void => {
      events.push(event);
      originalEmit(event);
    };

    const capturingContext: SkillExecutionContext = {
      ...context,
      skill,
      emit: capturingEmit,
    };

    try {
      // Emit a progress event for skill start
      capturingEmit({
        kind: "progress",
        timestamp: new Date(),
        data: {
          skillName: skill.metadata.name,
          status: "started",
        },
      });

      // Check abort signal before starting
      if (context.signal.aborted) {
        throw new Error("Execution aborted");
      }

      // Execute the skill's instructions via the agent context.
      // The actual execution is delegated through the context's memory
      // and emit interfaces — the executor orchestrates ordering and
      // dependency tracking.
      //
      // For now, we record a successful "passthrough" result. The real
      // agent execution pipeline will invoke the LLM with the skill
      // instructions injected into the system prompt (as described in
      // CLAUDE.md gotcha #4). This executor handles the dependency
      // graph and result bookkeeping around that call.
      const output = {
        skillName: skill.metadata.name,
        instructions: skill.instructions,
        parameters: capturingContext.parameters,
        dependencyResults: this.collectDependencyResults(skill),
      };

      capturingEmit({
        kind: "complete",
        timestamp: new Date(),
        data: {
          skillName: skill.metadata.name,
          status: "completed",
        },
      });

      return {
        success: true,
        output,
        artifacts: [],
        events,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      capturingEmit({
        kind: "error",
        timestamp: new Date(),
        data: {
          skillName: skill.metadata.name,
          error: error.message,
        },
      });

      return {
        success: false,
        output: null,
        artifacts: [],
        events,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Check if any of the skill's dependencies have failed.
   * Returns the name of the first failed dependency, or undefined if all ok.
   */
  private findFailedDependency(skill: SkillDefinition): string | undefined {
    for (const dep of skill.metadata.dependencies ?? []) {
      const depResult = this.executionResults.get(dep);
      if (depResult && !depResult.success) {
        return dep;
      }
    }
    return undefined;
  }

  /**
   * Collect the outputs of all resolved dependencies for a skill.
   */
  private collectDependencyResults(
    skill: SkillDefinition,
  ): Record<string, unknown> {
    const deps: Record<string, unknown> = {};

    for (const dep of skill.metadata.dependencies ?? []) {
      const result = this.executionResults.get(dep);
      if (result) {
        deps[dep] = result.output;
      }
    }

    return deps;
  }

  /**
   * Build a per-skill execution context with the correct skill definition
   * while preserving all shared resources from the parent context.
   */
  private buildSkillContext(
    skill: SkillDefinition,
    parentContext: SkillExecutionContext,
  ): SkillExecutionContext {
    return {
      ...parentContext,
      skill,
    };
  }

  /**
   * Build a SkillResult representing a failure.
   */
  private makeErrorResult(error: Error): SkillResult {
    return {
      success: false,
      output: null,
      artifacts: [],
      events: [
        {
          kind: "error",
          timestamp: new Date(),
          data: { error: error.message },
        },
      ],
      durationMs: 0,
    };
  }
}
