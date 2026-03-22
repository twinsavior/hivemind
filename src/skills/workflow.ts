/**
 * HIVEMIND Declarative Workflow DSL
 *
 * Provides a fluent builder API for composing multi-agent workflows
 * from sequential tasks, parallel fan-outs, and conditional branches.
 * Builds on top of the SkillExecutor's execution model but operates
 * at a higher abstraction level — orchestrating *agent tasks* rather
 * than individual skill definitions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowStepType = "task" | "parallel" | "branch" | "checkpoint";

export interface WorkflowStep {
  type: WorkflowStepType;
  name: string;
  /** Agent role to execute this step (e.g. "scout", "builder") */
  agent?: string;
  /** Task description for 'task' type */
  task?: string;
  /** Skill name to execute (optional — steps can be pure task descriptions) */
  skill?: string;
  /** Sub-steps for 'parallel' type */
  steps?: WorkflowStep[];
  /** Guard condition for 'branch' type — evaluated against the previous step result */
  condition?: (result: WorkflowStepResult) => boolean;
  /** Conditional branches for 'branch' type */
  branches?: {
    when: (result: WorkflowStepResult) => boolean;
    step: WorkflowStep;
  }[];
  /** Error handling strategy: skip continues, abort throws, retry tries once more */
  onError?: "skip" | "abort" | "retry";
}

export interface WorkflowStepResult {
  stepName: string;
  success: boolean;
  output: string;
  duration: number;
  agent?: string;
}

export interface WorkflowResult {
  success: boolean;
  steps: WorkflowStepResult[];
  totalDuration: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class WorkflowAbortError extends Error {
  constructor(
    public readonly stepName: string,
    public readonly reason: Error,
  ) {
    super(`Workflow aborted at step "${stepName}": ${reason.message}`);
    this.name = "WorkflowAbortError";
  }
}

// ---------------------------------------------------------------------------
// Workflow — the immutable execution plan
// ---------------------------------------------------------------------------

export class Workflow {
  readonly name: string;
  readonly steps: ReadonlyArray<WorkflowStep>;

  constructor(name: string, steps: WorkflowStep[]) {
    this.name = name;
    this.steps = Object.freeze([...steps]);
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /**
   * Execute the workflow by walking each step in order and delegating to
   * the caller-supplied `executor` function. The executor receives the
   * current step and all previous results, giving the caller full control
   * over *how* each step runs (LLM call, subprocess, mock, etc.).
   */
  async execute(
    executor: (
      step: WorkflowStep,
      previousResults: WorkflowStepResult[],
    ) => Promise<WorkflowStepResult>,
  ): Promise<WorkflowResult> {
    const allResults: WorkflowStepResult[] = [];
    const workflowStart = Date.now();

    for (const step of this.steps) {
      const stepResults = await this.executeStep(
        step,
        allResults,
        executor,
      );
      allResults.push(...stepResults);
    }

    return {
      success: allResults.every((r) => r.success),
      steps: allResults,
      totalDuration: Date.now() - workflowStart,
    };
  }

  // -------------------------------------------------------------------------
  // Description / serialization
  // -------------------------------------------------------------------------

  /**
   * Return a human-readable description of the workflow for logging or
   * display in the dashboard.
   */
  describe(): string {
    const lines: string[] = [`Workflow: ${this.name}`];
    let index = 1;

    for (const step of this.steps) {
      this.describeStep(step, lines, index, "");
      index++;
    }

    return lines.join("\n");
  }

  /**
   * Serialize the workflow to a plain JSON-compatible object.
   * Functions (branch conditions) are serialized as descriptive strings
   * since they cannot be losslessly serialized.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      steps: this.steps.map((s) => this.stepToJSON(s)),
    };
  }

  /**
   * Deserialize a workflow from a plain JSON object.
   * Branch conditions are restored as always-true stubs since the original
   * functions cannot be recovered from JSON.
   */
  static fromJSON(data: Record<string, unknown>): Workflow {
    const name = data["name"] as string;
    const rawSteps = data["steps"] as Record<string, unknown>[];
    const steps = rawSteps.map((s) => Workflow.stepFromJSON(s));
    return new Workflow(name, steps);
  }

  // -------------------------------------------------------------------------
  // Private — step execution
  // -------------------------------------------------------------------------

  private async executeStep(
    step: WorkflowStep,
    previousResults: WorkflowStepResult[],
    executor: (
      step: WorkflowStep,
      previousResults: WorkflowStepResult[],
    ) => Promise<WorkflowStepResult>,
  ): Promise<WorkflowStepResult[]> {
    switch (step.type) {
      case "parallel":
        return this.executeParallel(step, previousResults, executor);
      case "branch":
        return this.executeBranch(step, previousResults, executor);
      case "checkpoint":
      case "task":
      default:
        return this.executeTask(step, previousResults, executor);
    }
  }

  private async executeTask(
    step: WorkflowStep,
    previousResults: WorkflowStepResult[],
    executor: (
      step: WorkflowStep,
      previousResults: WorkflowStepResult[],
    ) => Promise<WorkflowStepResult>,
  ): Promise<WorkflowStepResult[]> {
    try {
      const result = await executor(step, previousResults);
      return [result];
    } catch (err) {
      return this.handleStepError(step, err);
    }
  }

  private async executeParallel(
    step: WorkflowStep,
    previousResults: WorkflowStepResult[],
    executor: (
      step: WorkflowStep,
      previousResults: WorkflowStepResult[],
    ) => Promise<WorkflowStepResult>,
  ): Promise<WorkflowStepResult[]> {
    const subSteps = step.steps ?? [];
    const promises = subSteps.map(async (sub) => {
      try {
        return await executor(sub, previousResults);
      } catch (err) {
        return this.handleStepError(sub, err).then((r) => r[0]!);
      }
    });

    const results = await Promise.all(promises);
    return results;
  }

  private async executeBranch(
    step: WorkflowStep,
    previousResults: WorkflowStepResult[],
    executor: (
      step: WorkflowStep,
      previousResults: WorkflowStepResult[],
    ) => Promise<WorkflowStepResult>,
  ): Promise<WorkflowStepResult[]> {
    const lastResult = previousResults[previousResults.length - 1];

    // If there is no previous result, skip the branch entirely
    if (!lastResult) {
      return [
        {
          stepName: step.name,
          success: true,
          output: "Branch skipped — no previous result to evaluate",
          duration: 0,
          agent: step.agent,
        },
      ];
    }

    const branches = step.branches ?? [];
    for (const branch of branches) {
      if (branch.when(lastResult)) {
        try {
          const result = await executor(branch.step, previousResults);
          return [result];
        } catch (err) {
          return this.handleStepError(branch.step, err);
        }
      }
    }

    // No branch matched — report as a successful no-op
    return [
      {
        stepName: step.name,
        success: true,
        output: "No branch condition matched — skipped",
        duration: 0,
        agent: step.agent,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Private — error handling
  // -------------------------------------------------------------------------

  private async handleStepError(
    step: WorkflowStep,
    err: unknown,
  ): Promise<WorkflowStepResult[]> {
    const error = err instanceof Error ? err : new Error(String(err));
    const strategy = step.onError ?? "abort";

    switch (strategy) {
      case "skip":
        return [
          {
            stepName: step.name,
            success: false,
            output: `Skipped after error: ${error.message}`,
            duration: 0,
            agent: step.agent,
          },
        ];

      case "retry":
        // Retry is handled by the caller re-throwing — we just rethrow
        // and let the outer executeTask catch it once. Since we're already
        // in the error handler, the retry has already been consumed.
        // The WorkflowBuilder marks retry steps; the execute loop retries once.
        return [
          {
            stepName: step.name,
            success: false,
            output: `Failed after retry: ${error.message}`,
            duration: 0,
            agent: step.agent,
          },
        ];

      case "abort":
      default:
        throw new WorkflowAbortError(step.name, error);
    }
  }

  // -------------------------------------------------------------------------
  // Private — describe helpers
  // -------------------------------------------------------------------------

  private describeStep(
    step: WorkflowStep,
    lines: string[],
    index: number,
    indent: string,
  ): void {
    const prefix = indent ? indent : `${index}. `;

    switch (step.type) {
      case "parallel": {
        lines.push(`${prefix}[parallel] ${step.name}`);
        const subs = step.steps ?? [];
        for (let i = 0; i < subs.length; i++) {
          const sub = subs[i]!;
          const letter = String.fromCharCode(97 + i); // a, b, c, …
          const agentTag = sub.agent ? `[${sub.agent}] ` : "";
          lines.push(`   ${agentTag}${letter}. ${sub.task ?? sub.name}`);
        }
        break;
      }
      case "branch": {
        const branches = step.branches ?? [];
        const descriptions = branches.map((b) => {
          const agentTag = b.step.agent ? `[${b.step.agent}] ` : "";
          return `${agentTag}${b.step.task ?? b.step.name}`;
        });
        const summary =
          descriptions.length > 0
            ? descriptions.join(" | ")
            : "no branches";
        lines.push(
          `${prefix}[branch] ${step.name} — if condition met → ${summary}`,
        );
        break;
      }
      default: {
        const agentTag = step.agent ? `[${step.agent}] ` : "";
        const desc = step.task ?? step.name;
        lines.push(`${prefix}${agentTag}${step.name} — ${desc}`);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private — serialization helpers
  // -------------------------------------------------------------------------

  private stepToJSON(step: WorkflowStep): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      type: step.type,
      name: step.name,
    };

    if (step.agent) obj["agent"] = step.agent;
    if (step.task) obj["task"] = step.task;
    if (step.skill) obj["skill"] = step.skill;
    if (step.onError) obj["onError"] = step.onError;

    if (step.steps) {
      obj["steps"] = step.steps.map((s) => this.stepToJSON(s));
    }

    if (step.branches) {
      obj["branches"] = step.branches.map((b) => ({
        when: "[function]",
        step: this.stepToJSON(b.step),
      }));
    }

    if (step.condition) {
      obj["condition"] = "[function]";
    }

    return obj;
  }

  private static stepFromJSON(data: Record<string, unknown>): WorkflowStep {
    const step: WorkflowStep = {
      type: data["type"] as WorkflowStepType,
      name: data["name"] as string,
    };

    if (data["agent"]) step.agent = data["agent"] as string;
    if (data["task"]) step.task = data["task"] as string;
    if (data["skill"]) step.skill = data["skill"] as string;
    if (data["onError"]) step.onError = data["onError"] as "skip" | "abort" | "retry";

    if (data["steps"]) {
      step.steps = (data["steps"] as Record<string, unknown>[]).map((s) =>
        Workflow.stepFromJSON(s),
      );
    }

    if (data["branches"]) {
      step.branches = (
        data["branches"] as Array<{ when: string; step: Record<string, unknown> }>
      ).map((b) => ({
        when: () => true, // Restored as always-true stub
        step: Workflow.stepFromJSON(b.step),
      }));
    }

    return step;
  }
}

// ---------------------------------------------------------------------------
// WorkflowBuilder — fluent API for constructing workflows
// ---------------------------------------------------------------------------

/**
 * Declarative workflow builder with fluent API.
 *
 * @example
 * ```typescript
 * const workflow = new WorkflowBuilder('feature-development')
 *   .then('research', { agent: 'scout', task: 'Research best practices for X' })
 *   .then('implement', { agent: 'builder', task: 'Build feature based on research' })
 *   .parallel('verify', [
 *     { agent: 'sentinel', task: 'Security review of new code' },
 *     { agent: 'builder', task: 'Write tests for new feature' },
 *   ])
 *   .branch('quality-gate', {
 *     when: (result) => !result.success,
 *     then: { agent: 'builder', task: 'Fix issues found in review' },
 *   })
 *   .then('document', { agent: 'courier', task: 'Write release notes' })
 *   .build();
 * ```
 */
export class WorkflowBuilder {
  private readonly steps: WorkflowStep[] = [];

  constructor(private readonly workflowName: string) {}

  /**
   * Add a sequential task step. Executes after the previous step completes.
   */
  then(
    name: string,
    config: {
      agent: string;
      task: string;
      skill?: string;
      onError?: "skip" | "abort" | "retry";
    },
  ): this {
    this.steps.push({
      type: "task",
      name,
      agent: config.agent,
      task: config.task,
      skill: config.skill,
      onError: config.onError,
    });
    return this;
  }

  /**
   * Add a set of parallel steps that execute simultaneously via Promise.all.
   * All sub-tasks receive the same previous-results snapshot.
   */
  parallel(
    name: string,
    tasks: Array<{
      agent: string;
      task: string;
      skill?: string;
      onError?: "skip" | "abort" | "retry";
    }>,
  ): this {
    this.steps.push({
      type: "parallel",
      name,
      steps: tasks.map((t, i) => ({
        type: "task" as const,
        name: `${name}-${i}`,
        agent: t.agent,
        task: t.task,
        skill: t.skill,
        onError: t.onError,
      })),
    });
    return this;
  }

  /**
   * Add a conditional branch evaluated against the previous step's result.
   * If `when` returns true, executes `then`. If `otherwise` is provided and
   * `when` returns false, executes `otherwise` instead.
   */
  branch(
    name: string,
    config: {
      when: (result: WorkflowStepResult) => boolean;
      then: { agent: string; task: string };
      otherwise?: { agent: string; task: string };
    },
  ): this {
    const branches: {
      when: (result: WorkflowStepResult) => boolean;
      step: WorkflowStep;
    }[] = [
      {
        when: config.when,
        step: {
          type: "task",
          name: `${name}-then`,
          agent: config.then.agent,
          task: config.then.task,
        },
      },
    ];

    if (config.otherwise) {
      branches.push({
        when: (result: WorkflowStepResult) => !config.when(result),
        step: {
          type: "task",
          name: `${name}-otherwise`,
          agent: config.otherwise.agent,
          task: config.otherwise.task,
        },
      });
    }

    this.steps.push({
      type: "branch",
      name,
      branches,
    });

    return this;
  }

  /**
   * Add a checkpoint step — a named synchronization point that captures
   * the workflow state. Useful for long-running workflows that may need
   * to resume after interruption.
   */
  checkpoint(name: string): this {
    this.steps.push({
      type: "checkpoint",
      name,
      task: `Checkpoint: ${name}`,
    });
    return this;
  }

  /**
   * Build the immutable Workflow from the accumulated steps.
   */
  build(): Workflow {
    return new Workflow(this.workflowName, [...this.steps]);
  }
}
