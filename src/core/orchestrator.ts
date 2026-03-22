import { EventEmitter } from "events";
import type { BaseAgent, AgentIdentity, AgentMessage } from "../agents/base-agent.js";
import type { TaskJournal } from "./task-journal.js";
import type { ToolExecutor } from "./tool-executor.js";
import { TrustLevel, type TaskSource, type AgentPermissions, permissionResolver, trustGate } from "./trust.js";
import type { LearningLoop, TaskOutcome } from "./learning-loop.js";
import type { AdaptiveStrategy } from "./adaptive-strategy.js";

export type TaskPriority = "critical" | "high" | "normal" | "low";
export type TaskStatus = "queued" | "assigned" | "running" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo?: string;
  parentId?: string;
  subtasks: string[];
  input: unknown;
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  timeoutMs: number;
  retries: number;
  maxRetries: number;
  /** The source of this task, used for trust classification. */
  source?: TaskSource;
  /** Resolved trust level for this task. */
  trustLevel?: TrustLevel;
  /** Resolved permissions for the agent executing this task. */
  permissions?: AgentPermissions;
  /** Abort controller for cancelling in-flight execution on timeout. */
  _abortController?: AbortController;
}

export interface SwarmDeployment {
  id: string;
  agents: string[];
  rootTask: string;
  status: "deploying" | "active" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
}

interface AgentRegistration {
  agent: BaseAgent;
  registered: number;
  lastHeartbeat: number;
  currentTask?: string;
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Terminal task states — once a task reaches one of these, no further transitions are allowed. */
const TERMINAL_STATES: Set<TaskStatus> = new Set(["completed", "failed", "cancelled"]);

/** Central coordinator for agent lifecycle, task routing, and swarm management. */
export class Orchestrator extends EventEmitter {
  private agents: Map<string, AgentRegistration> = new Map();
  private tasks: Map<string, Task> = new Map();
  private taskQueue: string[] = [];
  private deployments: Map<string, SwarmDeployment> = new Map();
  private healthTimer?: ReturnType<typeof setInterval>;
  private drainTimer?: ReturnType<typeof setInterval>;
  private taskCleanupTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private journal: TaskJournal | null = null;
  private toolExecutor: ToolExecutor | null = null;
  private learningLoop: LearningLoop | null = null;
  private adaptiveStrategy: AdaptiveStrategy | null = null;

  constructor(
    private readonly maxConcurrent: number = 8,
    private readonly healthIntervalMs: number = 30_000,
  ) {
    super();
  }

  /** Attach a task journal for persistent state (#4). */
  setJournal(journal: TaskJournal): void {
    this.journal = journal;
  }

  /** Attach a tool executor for real tool execution by agents. */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  /** Attach the learning loop for agent self-improvement. */
  setLearningLoop(loop: LearningLoop): void {
    this.learningLoop = loop;
  }

  /** Attach the adaptive strategy engine for pre-task adjustments. */
  setAdaptiveStrategy(strategy: AdaptiveStrategy): void {
    this.adaptiveStrategy = strategy;
  }

  /** Get the attached learning loop (for persistence from outside). */
  getLearningLoop(): LearningLoop | null {
    return this.learningLoop;
  }

  /**
   * Recover incomplete tasks from the journal after a restart.
   * Re-queues any tasks that were in-progress when the process died.
   */
  async recoverFromJournal(): Promise<number> {
    if (!this.journal) return 0;

    const incomplete = this.journal.loadIncomplete();
    let recovered = 0;

    for (const persisted of incomplete) {
      // Re-create the in-memory task
      const task: Task = {
        id: persisted.id,
        description: persisted.description,
        priority: persisted.priority as TaskPriority,
        status: "queued", // Reset to queued for re-processing
        assignedTo: undefined,
        parentId: persisted.parentId ?? undefined,
        subtasks: [],
        input: JSON.parse(persisted.input),
        createdAt: new Date(persisted.createdAt).getTime(),
        timeoutMs: persisted.timeoutMs,
        retries: persisted.retries,
        maxRetries: persisted.maxRetries,
      };

      this.tasks.set(task.id, task);
      this.taskQueue.push(task.id);
      this.journal.updateStatus(task.id, "queued");
      recovered++;
    }

    if (recovered > 0) {
      this.taskQueue.sort((a, b) => {
        const ta = this.tasks.get(a)!;
        const tb = this.tasks.get(b)!;
        return PRIORITY_WEIGHT[ta.priority] - PRIORITY_WEIGHT[tb.priority];
      });
      this.emit("journal:recovered", { count: recovered });
    }

    return recovered;
  }

  /** Register an agent with the orchestrator. */
  register(agent: BaseAgent): void {
    this.agents.set(agent.identity.id, {
      agent,
      registered: Date.now(),
      lastHeartbeat: Date.now(),
    });

    agent.on("state:change", (evt) => {
      this.emit("agent:state", evt);
      const reg = this.agents.get(evt.agent);
      if (reg) reg.lastHeartbeat = Date.now();
    });

    agent.on("error", (evt) => this.emit("agent:error", evt));

    // Listen for delegation requests from this agent
    agent.on("delegate", (message: AgentMessage) => {
      this.handleDelegation(message);
    });

    // Listen for inter-agent messages
    agent.on("message", (message: AgentMessage) => {
      this.routeMessage(message);
    });

    this.emit("agent:registered", { id: agent.identity.id, role: agent.identity.role });
  }

  /** Unregister an agent and cancel its active task. */
  unregister(agentId: string): void {
    const reg = this.agents.get(agentId);
    if (!reg) return;
    if (reg.currentTask) this.cancelTask(reg.currentTask);
    reg.agent.removeAllListeners();
    this.agents.delete(agentId);
    this.emit("agent:unregistered", { id: agentId });
  }

  /** Start the orchestrator event loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.healthTimer = setInterval(() => this.checkHealth(), this.healthIntervalMs);
    this.drainTimer = setInterval(() => this.drainQueue(), 500);
    this.taskCleanupTimer = setInterval(() => this.evictTerminalTasks(), 60_000);
    this.emit("orchestrator:started");
  }

  /** Gracefully stop the orchestrator. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.drainTimer) clearInterval(this.drainTimer);
    if (this.taskCleanupTimer) clearInterval(this.taskCleanupTimer);
    this.emit("orchestrator:stopped");
  }

  /** Remove tasks in terminal states (completed/failed/cancelled) older than 5 minutes. */
  private evictTerminalTasks(): void {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [id, task] of this.tasks) {
      if (TERMINAL_STATES.has(task.status) && task.completedAt && task.completedAt < cutoff) {
        this.tasks.delete(id);
      }
    }
  }

  /** Deploy a swarm of agents against a high-level objective. */
  async deploySwarm(objective: string, agentIds: string[], timeoutMs = 600_000): Promise<SwarmDeployment> {
    const subtasks = this.decompose(objective);
    const rootTask = this.enqueue({
      description: objective,
      priority: "high",
      input: { objective },
      subtasks: [],
      timeoutMs,
    });

    const childIds: string[] = [];
    for (const sub of subtasks) {
      const child = this.enqueue({
        description: sub,
        priority: "normal",
        input: { objective, subtask: sub },
        parentId: rootTask.id,
        subtasks: [],
        timeoutMs,
      });
      childIds.push(child.id);
    }
    rootTask.subtasks = childIds;

    const deployment: SwarmDeployment = {
      id: `swarm-${Date.now().toString(36)}`,
      agents: agentIds,
      rootTask: rootTask.id,
      status: "deploying",
      startedAt: Date.now(),
    };
    this.deployments.set(deployment.id, deployment);
    deployment.status = "active";
    this.emit("swarm:deployed", deployment);

    this.drainQueue();
    return deployment;
  }

  /** Assign a specific task to a specific agent. */
  async assignTask(taskId: string, agentId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    const reg = this.agents.get(agentId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (!reg) throw new Error(`Agent ${agentId} not found`);
    if (reg.currentTask) throw new Error(`Agent ${agentId} is busy with task ${reg.currentTask}`);

    task.status = "assigned";
    task.assignedTo = agentId;
    task.startedAt = Date.now();
    reg.currentTask = taskId;
    this.emit("task:assigned", { taskId, agentId });

    this.executeTask(task, reg).catch((err) => {
      this.emit("task:error", { taskId, agentId, error: err });
    });
  }

  /** Coordinate agents working on subtasks of a shared objective. */
  async coordinateAgents(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

    const rootTask = this.tasks.get(deployment.rootTask);
    if (!rootTask) return;

    const allComplete = rootTask.subtasks.every((id) => {
      const t = this.tasks.get(id);
      return t?.status === "completed" || t?.status === "failed";
    });

    if (allComplete) {
      deployment.status = "completed";
      deployment.completedAt = Date.now();
      rootTask.status = "completed";
      rootTask.completedAt = Date.now();
      rootTask.result = this.collectResults(deployment.rootTask);
      this.emit("swarm:completed", deployment);
    }
  }

  /** Gather results from all subtasks of a root task. */
  collectResults(rootTaskId: string): Record<string, unknown> {
    const root = this.tasks.get(rootTaskId);
    if (!root) return {};

    const results: Record<string, unknown> = {};
    for (const subId of root.subtasks) {
      const sub = this.tasks.get(subId);
      if (sub) {
        results[subId] = {
          description: sub.description,
          status: sub.status,
          result: sub.result,
          error: sub.error,
          durationMs: sub.completedAt && sub.startedAt ? sub.completedAt - sub.startedAt : null,
        };
      }
    }
    return results;
  }

  // -----------------------------------------------------------------------
  // Dynamic agent spawning (#9)
  // -----------------------------------------------------------------------

  /** Agent factory registry — maps role names to constructors. */
  private agentFactories = new Map<string, (id?: string) => BaseAgent>();

  /** Register a factory function for dynamically spawning agents by role. */
  registerFactory(role: string, factory: (id?: string) => BaseAgent): void {
    this.agentFactories.set(role, factory);
  }

  /**
   * Spawn a new agent instance of the given role.
   * Requires a factory registered via registerFactory().
   * Returns the new agent's ID.
   */
  spawnAgent(role: string, id?: string): string {
    const factory = this.agentFactories.get(role);
    if (!factory) {
      throw new Error(`No factory registered for role "${role}". Call registerFactory() first.`);
    }

    // Enforce max concurrent agents from config
    if (this.agents.size >= this.maxConcurrent) {
      throw new Error(
        `Cannot spawn agent: at capacity (${this.agents.size}/${this.maxConcurrent})`,
      );
    }

    const agent = factory(id);
    this.register(agent);
    this.emit("agent:spawned", { id: agent.identity.id, role });
    return agent.identity.id;
  }

  /** Terminate an idle agent, freeing a slot. */
  despawnAgent(agentId: string): boolean {
    const reg = this.agents.get(agentId);
    if (!reg) return false;
    if (reg.currentTask) {
      throw new Error(`Cannot despawn agent ${agentId}: it has an active task`);
    }
    this.unregister(agentId);
    this.emit("agent:despawned", { id: agentId });
    return true;
  }

  // -----------------------------------------------------------------------
  // Config enforcement (#2)
  // -----------------------------------------------------------------------

  /** Apply runtime configuration limits. */
  applyConfig(config: {
    maxConcurrentAgents?: number;
    taskTimeout?: number;
    healthCheckInterval?: number;
    retryPolicy?: { maxRetries: number; backoffMs: number };
  }): void {
    if (config.maxConcurrentAgents !== undefined) {
      (this as any).maxConcurrent = config.maxConcurrentAgents;
    }
    if (config.healthCheckInterval !== undefined) {
      (this as any).healthIntervalMs = config.healthCheckInterval;
      // Restart health timer if running
      if (this.running && this.healthTimer) {
        clearInterval(this.healthTimer);
        this.healthTimer = setInterval(
          () => this.checkHealth(),
          config.healthCheckInterval,
        );
      }
    }
    if (config.taskTimeout !== undefined) {
      this.defaultTaskTimeout = config.taskTimeout;
    }
    if (config.retryPolicy !== undefined) {
      this.defaultRetryPolicy = config.retryPolicy;
    }
    this.emit("config:applied", config);
  }

  private defaultTaskTimeout = 300_000;
  private defaultRetryPolicy = { maxRetries: 3, backoffMs: 1000 };

  /** Get a snapshot of all registered agents and their status. */
  getAgentStatus(): Array<{ id: string; state: string; currentTask?: string; lastHeartbeat: number }> {
    return [...this.agents.entries()].map(([id, reg]) => ({
      id,
      state: reg.agent.getState(),
      currentTask: reg.currentTask,
      lastHeartbeat: reg.lastHeartbeat,
    }));
  }

  /** Handle a delegation request: find the right agent by role and assign the task. */
  private handleDelegation(message: AgentMessage): void {
    const targetRole = message.to;
    const { task, reason, delegatedBy, parentTrustLevel } = message.payload as {
      task: unknown;
      reason: string;
      delegatedBy: string;
      parentTrustLevel?: TrustLevel;
    };

    // Check if the delegating agent's task had permission to delegate
    const delegatingReg = this.agents.get(delegatedBy);
    const delegatingTask = delegatingReg?.currentTask
      ? this.tasks.get(delegatingReg.currentTask)
      : undefined;

    if (delegatingTask?.permissions && !delegatingTask.permissions.canDelegate) {
      this.emit("delegation:failed", {
        from: delegatedBy,
        targetRole,
        reason: "Agent does not have permission to delegate at this trust level",
      });
      delegatingReg?.agent.receiveMessage({
        from: "orchestrator",
        to: delegatedBy,
        type: "result",
        payload: { success: false, error: "Delegation not permitted at this trust level" },
        timestamp: Date.now(),
        correlationId: message.correlationId,
      });
      return;
    }

    const target = this.findAgentByRole(targetRole);
    if (!target) {
      this.emit("delegation:failed", {
        from: delegatedBy,
        targetRole,
        reason: `No agent with role "${targetRole}" is registered`,
      });
      // Send failure back to the requesting agent
      const source = this.agents.get(delegatedBy);
      source?.agent.receiveMessage({
        from: "orchestrator",
        to: delegatedBy,
        type: "result",
        payload: { success: false, error: `No agent with role "${targetRole}" available` },
        timestamp: Date.now(),
        correlationId: message.correlationId,
      });
      return;
    }

    // Inherit the trust level from the parent task — untrusted input cannot
    // escalate privileges by delegating to a more powerful agent.
    const inheritedTrustLevel = parentTrustLevel
      ?? delegatingTask?.trustLevel
      ?? TrustLevel.UNTRUSTED;

    // Enqueue the delegated task with inherited trust
    const newTask = this.enqueue({
      description: `Delegated from ${delegatedBy}: ${reason}`,
      priority: "high",
      input: task,
      subtasks: [],
      timeoutMs: 600_000,
      source: {
        type: 'agent-delegation',
        authenticated: false,
        userId: delegatedBy,
        trustLevel: inheritedTrustLevel,
      },
    });

    this.emit("delegation:routed", {
      from: delegatedBy,
      to: target.agent.identity.id,
      taskId: newTask.id,
      reason,
    });

    // If the target is idle, assign immediately
    const reg = this.agents.get(target.agent.identity.id);
    if (reg && !reg.currentTask) {
      this.assignTask(newTask.id, target.agent.identity.id).catch((err) => console.warn('[Orchestrator] Task assignment failed:', err.message));
    }
    // Otherwise it'll be picked up by drainQueue
  }

  /** Route a message from one agent to another (by ID or role). */
  private routeMessage(message: AgentMessage): void {
    // Try exact ID match first
    const directTarget = this.agents.get(message.to);
    if (directTarget) {
      directTarget.agent.receiveMessage(message);
      this.emit("message:routed", { from: message.from, to: message.to });
      return;
    }

    // Fall back to role-based lookup
    const byRole = this.findAgentByRole(message.to);
    if (byRole) {
      byRole.agent.receiveMessage(message);
      this.emit("message:routed", { from: message.from, to: byRole.agent.identity.id });
      return;
    }

    // Broadcast type goes to everyone except sender
    if (message.type === "broadcast") {
      for (const [id, reg] of this.agents) {
        if (id !== message.from) {
          reg.agent.receiveMessage(message);
        }
      }
      this.emit("message:broadcast", { from: message.from });
      return;
    }

    this.emit("message:undeliverable", { from: message.from, to: message.to });
  }

  /** Find the best available agent for a given role. Prefers idle agents. */
  findAgentByRole(role: string): AgentRegistration | undefined {
    const candidates = [...this.agents.values()].filter(
      (r) => r.agent.identity.role === role,
    );
    // Prefer idle agents
    return candidates.find((r) => !r.currentTask) ?? candidates[0];
  }

  /** Find an agent that has a specific capability. */
  findAgentByCapability(capability: string): AgentRegistration | undefined {
    const candidates = [...this.agents.values()].filter(
      (r) => r.agent.hasCapability(capability),
    );
    return candidates.find((r) => !r.currentTask) ?? candidates[0];
  }

  enqueue(partial: Omit<Task, "id" | "status" | "createdAt" | "retries" | "maxRetries"> & { parentId?: string; source?: TaskSource }): Task {
    // Resolve trust level from source metadata
    const source = partial.source;
    const trustLevel = source
      ? trustGate.classifySource(source)
      : TrustLevel.OWNER; // CLI/direct calls default to OWNER

    const task: Task = {
      id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      status: "queued",
      createdAt: Date.now(),
      retries: 0,
      maxRetries: 3,
      ...partial,
      source,
      trustLevel,
    };
    this.tasks.set(task.id, task);
    // Binary search to find correct insertion point (O(n) insert instead of O(n log n) sort)
    const weight = PRIORITY_WEIGHT[task.priority];
    let lo = 0;
    let hi = this.taskQueue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const midTask = this.tasks.get(this.taskQueue[mid]!);
      if (midTask && PRIORITY_WEIGHT[midTask.priority] <= weight) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.taskQueue.splice(lo, 0, task.id);

    // Persist to journal (#4)
    this.journal?.save({
      id: task.id,
      description: task.description,
      priority: task.priority,
      status: task.status,
      assignedTo: task.assignedTo ?? null,
      parentId: task.parentId ?? null,
      input: JSON.stringify(task.input),
      result: null,
      error: null,
      createdAt: new Date(task.createdAt).toISOString(),
      startedAt: null,
      completedAt: null,
      timeoutMs: task.timeoutMs,
      retries: task.retries,
      maxRetries: task.maxRetries,
    });

    this.emit("task:queued", { taskId: task.id, priority: task.priority });
    return task;
  }

  /**
   * Find the deployment (if any) that owns a given task, either as rootTask
   * or as a subtask of the rootTask.
   */
  private findDeploymentForTask(taskId: string): SwarmDeployment | undefined {
    for (const deployment of this.deployments.values()) {
      if (deployment.rootTask === taskId) return deployment;
      const root = this.tasks.get(deployment.rootTask);
      if (root?.subtasks.includes(taskId)) return deployment;
    }
    return undefined;
  }

  private drainQueue(): void {
    if (!this.running) return;
    const active = [...this.agents.values()].filter((r) => r.currentTask).length;
    const capacity = this.maxConcurrent - active;

    for (let i = 0; i < capacity && this.taskQueue.length > 0; i++) {
      const taskId = this.taskQueue[0]!;
      const task = this.tasks.get(taskId);
      if (!task) {
        this.taskQueue.shift();
        continue;
      }

      // If the task is already assigned to a specific agent, honor that
      let target: [string, AgentRegistration] | undefined;

      if (task.assignedTo) {
        const reg = this.agents.get(task.assignedTo);
        if (reg && !reg.currentTask) {
          target = [task.assignedTo, reg];
        }
      }

      // For deployment tasks, restrict to the deployment's pinned agents
      if (!target) {
        const deployment = this.findDeploymentForTask(taskId);
        if (deployment && deployment.agents.length > 0) {
          // Only consider agents pinned to this deployment
          for (const pinnedId of deployment.agents) {
            const reg = this.agents.get(pinnedId);
            if (reg && !reg.currentTask) {
              target = [pinnedId, reg];
              break;
            }
          }
          // If no pinned agent is available, skip this task for now
          if (!target) {
            // Don't shift — leave in queue, try next task instead
            // Move past this item and try the next one
            this.taskQueue.shift();
            this.taskQueue.push(taskId);
            continue;
          }
        } else {
          // No deployment constraint — find any idle agent
          target = [...this.agents.entries()].find(([, r]) => !r.currentTask);
        }
      }

      if (target) {
        this.taskQueue.shift();
        this.assignTask(taskId, target[0]).catch((err) => console.warn('[Orchestrator] Task assignment failed:', err.message));
      } else {
        break;
      }
    }
  }

  private async executeTask(task: Task, reg: AgentRegistration): Promise<void> {
    // Resolve permissions based on the agent's role and the task's trust level
    const agentRole = reg.agent.identity.role;
    const taskTrustLevel = task.trustLevel ?? TrustLevel.UNTRUSTED;
    const workDir = process.cwd();
    const permissions = permissionResolver.resolve(agentRole, taskTrustLevel, workDir);
    task.permissions = permissions;

    // Inject the tool executor into the agent, bound to the resolved permissions.
    // This wires up real tool execution (HTTP, shell, LLM, etc.) for every agent.
    if (this.toolExecutor) {
      const boundExecutor = this.toolExecutor.createBoundExecutor(permissions);
      reg.agent.setToolHandler(boundExecutor);
    }

    // ── Learning loop: inject performance profile before execution ──
    if (this.learningLoop) {
      const profile = this.learningLoop.generateSelfAwarenessPrompt(reg.agent.identity.id);
      if (profile) {
        reg.agent.setPerformanceProfile(profile);
      }
    }

    // ── Adaptive strategy: apply pre-task adjustments ──
    if (this.adaptiveStrategy) {
      const adjustment = this.adaptiveStrategy.applyPreTask(
        reg.agent.identity.id,
        task.description,
      );
      // If the strategy says to delegate, emit an event but still attempt
      // (the caller can listen and re-route if desired)
      if (adjustment.shouldDelegate && adjustment.delegateTo) {
        this.emit("learning:suggest-delegate", {
          taskId: task.id,
          agentId: reg.agent.identity.id,
          suggestedRole: adjustment.delegateTo,
        });
      }
    }

    task.status = "running";
    this.journal?.updateStatus(task.id, "running", {
      assignedTo: reg.agent.identity.id,
      startedAt: new Date().toISOString(),
    });

    // Create an abort controller so the timeout can signal the execute() promise
    const abortController = new AbortController();
    task._abortController = abortController;

    const timer = setTimeout(() => {
      // Guard: only transition if still running (not already completed/failed/cancelled)
      if (task.status !== "running") return;

      task.status = "failed";
      task.error = "Task timed out";
      task.completedAt = Date.now();
      reg.currentTask = undefined;
      this.journal?.updateStatus(task.id, "failed", {
        error: "Task timed out",
        completedAt: new Date(task.completedAt).toISOString(),
      });
      // Abort the in-flight execute() so the success path cannot fire
      abortController.abort();
      this.emit("task:timeout", { taskId: task.id });

      // ── Learning loop: record timeout as failure ──
      if (this.learningLoop) {
        this.learningLoop.recordOutcome({
          taskId: task.id,
          agentId: reg.agent.identity.id,
          description: task.description,
          success: false,
          durationMs: (task.completedAt ?? Date.now()) - (task.startedAt ?? task.createdAt),
          tokensUsed: 0,
          toolsUsed: [],
          toolFailures: [],
          delegations: [],
          errorMessage: "Task timed out",
          timestamp: Date.now(),
        });
      }

      this.checkDeploymentCompletion(task);
    }, task.timeoutMs);

    try {
      const result = await reg.agent.execute(task.input, abortController.signal);
      clearTimeout(timer);

      // Guard: if the task was already moved to a terminal state (e.g. timed out),
      // do NOT overwrite it — the timeout handler already handled cleanup.
      if (TERMINAL_STATES.has(task.status)) return;

      task.status = "completed";
      task.result = result;
      task.completedAt = Date.now();
      reg.currentTask = undefined;
      task._abortController = undefined;
      this.journal?.updateStatus(task.id, "completed", {
        result: JSON.stringify(result),
        completedAt: new Date(task.completedAt).toISOString(),
      });
      this.emit("task:completed", { taskId: task.id, result });

      // ── Learning loop: record successful outcome ──
      if (this.learningLoop) {
        const resultObj = result as Record<string, unknown> | undefined;
        this.learningLoop.recordOutcome({
          taskId: task.id,
          agentId: reg.agent.identity.id,
          description: task.description,
          success: true,
          durationMs: (task.completedAt ?? Date.now()) - (task.startedAt ?? task.createdAt),
          tokensUsed: typeof resultObj?.["tokensUsed"] === "number" ? resultObj["tokensUsed"] as number : 0,
          toolsUsed: Array.isArray(resultObj?.["toolsUsed"]) ? resultObj["toolsUsed"] as string[] : [],
          toolFailures: Array.isArray(resultObj?.["toolFailures"]) ? resultObj["toolFailures"] as string[] : [],
          delegations: Array.isArray(resultObj?.["delegations"]) ? resultObj["delegations"] as string[] : [],
          timestamp: Date.now(),
        });
      }

      this.checkDeploymentCompletion(task);
    } catch (err) {
      clearTimeout(timer);

      // Guard: if the task was already moved to a terminal state, don't overwrite
      if (TERMINAL_STATES.has(task.status)) return;

      task._abortController = undefined;
      task.retries++;
      if (task.retries < task.maxRetries) {
        task.status = "queued";
        reg.currentTask = undefined;
        this.taskQueue.push(task.id);
        this.journal?.updateStatus(task.id, "queued", { retries: task.retries });
        this.emit("task:retry", { taskId: task.id, attempt: task.retries });
      } else {
        task.status = "failed";
        task.error = err instanceof Error ? err.message : String(err);
        task.completedAt = Date.now();
        reg.currentTask = undefined;
        this.journal?.updateStatus(task.id, "failed", {
          error: task.error,
          completedAt: new Date(task.completedAt).toISOString(),
        });
        this.emit("task:failed", { taskId: task.id, error: task.error });

        // ── Learning loop: record failed outcome ──
        if (this.learningLoop) {
          this.learningLoop.recordOutcome({
            taskId: task.id,
            agentId: reg.agent.identity.id,
            description: task.description,
            success: false,
            durationMs: (task.completedAt ?? Date.now()) - (task.startedAt ?? task.createdAt),
            tokensUsed: 0,
            toolsUsed: [],
            toolFailures: [],
            delegations: [],
            errorMessage: task.error,
            timestamp: Date.now(),
          });
        }

        this.checkDeploymentCompletion(task);
      }
    }
  }

  /**
   * After a task completes/fails, check if it belongs to a deployment
   * and auto-call coordinateAgents() to finalize when all subtasks are done.
   */
  private checkDeploymentCompletion(task: Task): void {
    if (!task.parentId) return;
    const deployment = this.findDeploymentForTask(task.id);
    if (deployment && deployment.status === "active") {
      this.coordinateAgents(deployment.id).catch((err) => console.warn('[Orchestrator] Task assignment failed:', err.message));
    }
  }

  private cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task && (task.status === "queued" || task.status === "assigned" || task.status === "running")) {
      task.status = "cancelled";
      task.completedAt = Date.now();
      // Abort in-flight execution if running
      task._abortController?.abort();
      task._abortController = undefined;
      this.journal?.updateStatus(task.id, "cancelled", {
        completedAt: new Date(task.completedAt).toISOString(),
      });
      this.emit("task:cancelled", { taskId });
    }
  }

  private decompose(objective: string): string[] {
    // TODO(#decompose): Replace with LLM-based decomposition.
    // Currently returns a generic 4-phase template. This is a stub —
    // real decomposition requires an LLM call to analyze the objective
    // and produce task-specific subtasks.
    return [
      `Research and gather context for: ${objective}`,
      `Plan implementation approach for: ${objective}`,
      `Execute primary actions for: ${objective}`,
      `Validate and verify results for: ${objective}`,
    ];
  }

  private checkHealth(): void {
    const now = Date.now();
    const staleThreshold = this.healthIntervalMs * 3;

    for (const [id, reg] of this.agents) {
      if (now - reg.lastHeartbeat > staleThreshold) {
        this.emit("agent:stale", { id, lastHeartbeat: reg.lastHeartbeat });
      }
      const health = reg.agent.healthCheck();
      this.emit("agent:health", health);
    }
  }
}
