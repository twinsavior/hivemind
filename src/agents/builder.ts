import {
  BaseAgent,
  type AgentIdentity,
  type ThinkResult,
  type ActResult,
  type Observation,
  type ToolCall,
} from "./base-agent.js";

type BuildTarget = "vercel" | "railway" | "docker" | "local";

interface BuildArtifact {
  type: "file" | "image" | "deployment";
  path: string;
  size?: number;
  hash?: string;
  metadata: Record<string, unknown>;
}

interface BuildPipeline {
  steps: PipelineStep[];
  target: BuildTarget;
  artifacts: BuildArtifact[];
  status: "pending" | "running" | "passed" | "failed";
  startedAt?: number;
  completedAt?: number;
}

interface PipelineStep {
  name: string;
  command: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  output?: string;
  durationMs?: number;
}

/** Code generation, testing, and deployment agent. Manages the full build-ship lifecycle. */
export class BuilderAgent extends BaseAgent {
  private pipeline: BuildPipeline | null = null;
  private readonly supportedTargets: BuildTarget[] = ["vercel", "railway", "docker", "local"];

  constructor(id?: string) {
    const identity: AgentIdentity = {
      id: id ?? `builder-${Date.now().toString(36)}`,
      name: "Builder",
      role: "engineering",
      version: "1.0.0",
    };
    super(identity);

    this.capabilities = [
      {
        name: "generate_code",
        description: "Generate code from a specification or prompt",
        parameters: {
          spec: { type: "string", required: true, description: "Code specification" },
          language: { type: "string", required: false, description: "Target language" },
          framework: { type: "string", required: false, description: "Target framework" },
        },
      },
      {
        name: "run_tests",
        description: "Execute test suite for a project",
        parameters: {
          projectPath: { type: "string", required: true, description: "Path to the project" },
          testCommand: { type: "string", required: false, description: "Custom test command" },
        },
      },
      {
        name: "lint_code",
        description: "Run linting and static analysis",
        parameters: {
          projectPath: { type: "string", required: true, description: "Path to the project" },
        },
      },
      {
        name: "build_container",
        description: "Build a Docker container image",
        parameters: {
          dockerfile: { type: "string", required: true, description: "Path to Dockerfile" },
          tag: { type: "string", required: true, description: "Image tag" },
        },
      },
      {
        name: "deploy",
        description: "Deploy to a target platform",
        parameters: {
          target: { type: "string", required: true, description: "Deployment target" },
          config: { type: "object", required: false, description: "Deployment configuration" },
        },
      },
    ];
  }

  async think(input: unknown): Promise<ThinkResult> {
    // Check inbox for delegated tasks from other agents
    const delegated = this.inbox.filter((m) => m.type === "task");
    if (delegated.length > 0) {
      const msg = delegated.shift()!;
      this.inbox = this.inbox.filter((m) => m !== msg);
      const delegatedPayload = msg.payload as { task: unknown; reason: string; delegatedBy: string };
      this.remember("delegated_from", { agent: delegatedPayload.delegatedBy, reason: delegatedPayload.reason });
      // Re-enter think with the delegated task input
      return this.think(delegatedPayload.task);
    }

    const task = input as { spec?: string; action?: string; target?: BuildTarget; projectPath?: string; objective?: string; query?: string; changes?: string[] };
    const action = task.action ?? (task.changes?.length ? "generate" : "build");
    const target = task.target ?? "local";
    const toolCalls: ToolCall[] = [];

    if (action === "generate" || action === "build") {
      toolCalls.push({ tool: "generate_code", args: { spec: task.spec ?? "", language: "typescript" } });
      toolCalls.push({ tool: "lint_code", args: { projectPath: task.projectPath ?? "." } });
      toolCalls.push({ tool: "run_tests", args: { projectPath: task.projectPath ?? "." } });
    }

    if (action === "deploy" || action === "build") {
      if (target === "docker") {
        toolCalls.push({ tool: "build_container", args: { dockerfile: "./Dockerfile", tag: "latest" } });
      }
      toolCalls.push({ tool: "deploy", args: { target, config: {} } });
    }

    this.pipeline = {
      steps: toolCalls.map((tc) => ({
        name: tc.tool,
        command: `${tc.tool} ${JSON.stringify(tc.args)}`,
        status: "pending" as const,
      })),
      target,
      artifacts: [],
      status: "pending",
    };

    return {
      reasoning: `Planning ${action} pipeline targeting ${target} with ${toolCalls.length} steps`,
      plan: this.pipeline.steps.map((s) => s.name),
      toolCalls,
      confidence: 0.85,
    };
  }

  async act(plan: ThinkResult): Promise<ActResult> {
    if (!this.pipeline) throw new Error("No pipeline configured");
    this.pipeline.status = "running";
    this.pipeline.startedAt = Date.now();

    const toolResults = [];
    let allPassed = true;

    for (let i = 0; i < plan.toolCalls.length; i++) {
      const call = plan.toolCalls[i]!;
      const step = this.pipeline.steps[i]!;

      if (!allPassed && call.tool !== "deploy") {
        step.status = "skipped";
        continue;
      }

      step.status = "running";
      this.emit("build:step", { step: step.name, status: "running" });

      const start = Date.now();
      const result = await this.callTool(call);
      step.durationMs = Date.now() - start;
      step.output = JSON.stringify(result.data)?.slice(0, 1000);
      toolResults.push(result);

      if (result.success) {
        step.status = "passed";
        this.emit("build:step", { step: step.name, status: "passed", durationMs: step.durationMs });

        if (result.data && typeof result.data === "object" && "artifact" in (result.data as object)) {
          this.pipeline.artifacts.push((result.data as { artifact: BuildArtifact }).artifact);
        }
      } else {
        step.status = "failed";
        allPassed = false;
        this.emit("build:step", { step: step.name, status: "failed", error: result.error });
      }
    }

    this.pipeline.status = allPassed ? "passed" : "failed";
    this.pipeline.completedAt = Date.now();

    return {
      toolResults,
      output: {
        pipelineStatus: this.pipeline.status,
        artifacts: this.pipeline.artifacts,
        duration: this.pipeline.completedAt - (this.pipeline.startedAt ?? this.pipeline.completedAt),
      },
      nextAction: "report",
    };
  }

  async observe(context: Record<string, unknown>): Promise<Observation[]> {
    if (!this.pipeline) return [];

    const failedSteps = this.pipeline.steps.filter((s) => s.status === "failed");
    const observations: Observation[] = [];

    if (failedSteps.length > 0) {
      observations.push({
        source: "pipeline",
        data: failedSteps,
        analysis: `${failedSteps.length} pipeline steps failed: ${failedSteps.map((s) => s.name).join(", ")}`,
        relevance: 1.0,
      });
    }

    return observations;
  }

  async report(): Promise<Record<string, unknown>> {
    if (!this.pipeline) {
      return { status: "no_pipeline", message: "No build pipeline has been executed" };
    }

    const p = this.pipeline;
    return {
      agent: this.identity.id,
      type: "build_report",
      target: p.target,
      status: p.status,
      steps: p.steps.map((s) => ({
        name: s.name,
        status: s.status,
        durationMs: s.durationMs,
      })),
      artifacts: p.artifacts.length,
      totalDuration: p.completedAt && p.startedAt ? p.completedAt - p.startedAt : null,
      timestamp: Date.now(),
    };
  }
}
