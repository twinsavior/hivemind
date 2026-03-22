import { EventEmitter } from "events";

export type AgentState = "idle" | "thinking" | "acting" | "waiting" | "error" | "terminated";

export interface AgentIdentity {
  id: string;
  name: string;
  role: string;
  version: string;
}

export interface AgentCapability {
  name: string;
  description: string;
  parameters: Record<string, { type: string; required: boolean; description: string }>;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  data: unknown;
  error?: string;
  durationMs: number;
}

export interface AgentMessage {
  from: string;
  to: string;
  type: "task" | "result" | "query" | "broadcast" | "heartbeat";
  payload: unknown;
  timestamp: number;
  correlationId: string;
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  timestamp: number;
  ttl?: number;
}

export interface ThinkResult {
  reasoning: string;
  plan: string[];
  toolCalls: ToolCall[];
  confidence: number;
}

export interface ActResult {
  toolResults: ToolResult[];
  output: unknown;
  nextAction?: "think" | "observe" | "report" | "halt";
}

export interface Observation {
  source: string;
  data: unknown;
  analysis: string;
  relevance: number;
}

/** Base class for all HIVEMIND agents. Subclasses implement the cognitive loop. */
export abstract class BaseAgent extends EventEmitter {
  readonly identity: AgentIdentity;
  protected state: AgentState = "idle";
  protected memory: Map<string, MemoryEntry> = new Map();
  protected capabilities: AgentCapability[] = [];
  protected taskHistory: Array<{ task: string; result: unknown; timestamp: number }> = [];
  protected inbox: AgentMessage[] = [];
  private stateTransitions: Map<AgentState, AgentState[]>;

  /**
   * Performance profile injected by the LearningLoop before task execution.
   * Contains self-awareness data: success rates, strengths, weaknesses,
   * strategy hints. Subclasses can read this in think() for introspection.
   */
  protected performanceProfile?: string;

  constructor(identity: AgentIdentity) {
    super();
    this.identity = identity;
    this.stateTransitions = new Map([
      ["idle", ["thinking", "terminated"]],
      ["thinking", ["acting", "waiting", "error", "idle"]],
      ["acting", ["thinking", "idle", "error", "waiting"]],
      ["waiting", ["thinking", "acting", "idle", "error"]],
      ["error", ["idle", "thinking", "terminated"]],
      ["terminated", []],
    ]);
  }

  /** Reason about the current task and produce a plan. */
  abstract think(input: unknown): Promise<ThinkResult>;

  /** Execute tool calls and actions determined during thinking. */
  abstract act(plan: ThinkResult): Promise<ActResult>;

  /** Gather information from the environment or other agents. */
  abstract observe(context: Record<string, unknown>): Promise<Observation[]>;

  /** Compile and return a structured report of work done. */
  abstract report(): Promise<Record<string, unknown>>;

  /**
   * Drain new context messages from the inbox and merge them into the current task.
   * Returns the updated task input if any redirect/context messages were found,
   * or null if no actionable messages were in the inbox.
   */
  protected drainContextUpdates(currentTask: unknown): { updatedTask: unknown; messages: AgentMessage[] } | null {
    if (this.inbox.length === 0) return null;

    // Pull out context-bearing messages (everything except heartbeats)
    const contextMessages = this.inbox.filter(
      (m) => m.type === "task" || m.type === "query" || m.type === "broadcast" || m.type === "result",
    );
    if (contextMessages.length === 0) return null;

    // Remove consumed messages from inbox
    const consumed = new Set(contextMessages);
    this.inbox = this.inbox.filter((m) => !consumed.has(m));

    // Build the updated task by merging new context into the current input
    const redirectMessages = contextMessages.filter((m) => m.type === "task" || m.type === "query");
    const contextPayloads = contextMessages.map((m) => m.payload);

    let updatedTask = currentTask;

    if (redirectMessages.length > 0) {
      // A redirect/new-task message takes priority — replace the task input
      const latest = redirectMessages[redirectMessages.length - 1]!;
      const payload = latest.payload as Record<string, unknown> | undefined;
      if (payload && typeof payload === "object") {
        // If the payload has a task field (delegation), unwrap it
        updatedTask = (payload as any).task ?? payload;
      }
    } else {
      // Supplementary context — attach it to the existing task
      const taskObj: Record<string, unknown> = (typeof currentTask === "object" && currentTask !== null)
        ? { ...currentTask as Record<string, unknown> }
        : { _originalInput: currentTask };
      taskObj["_additionalContext"] = contextPayloads;
      updatedTask = taskObj;
    }

    this.emit("context:updated", {
      agent: this.identity.id,
      messageCount: contextMessages.length,
      isRedirect: redirectMessages.length > 0,
    });

    return { updatedTask, messages: contextMessages };
  }

  /** Run the full cognitive loop: think -> act -> observe -> report. */
  async execute(task: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    // Reset from error state if needed
    if (this.state === "error") {
      this.state = "idle";
    }

    // Check inbox before starting — user may have already sent a redirect
    let effectiveTask = task;
    const preCheck = this.drainContextUpdates(effectiveTask);
    if (preCheck) {
      effectiveTask = preCheck.updatedTask;
    }

    // Lazy-load tracing (optional — won't break if tracing module not available)
    let span: any = null;
    try {
      const tracing = await import("../core/tracing.js");
      span = tracing.startSpan("agent.execute", this.identity.id, undefined, {
        "agent.role": this.identity.role,
        "task.preview": JSON.stringify(effectiveTask).slice(0, 200),
      });
    } catch {
      // Tracing not available
    }

    this.transition("thinking");
    try {
      this.throwIfAborted(signal);

      if (span) {
        try {
          const tracing = await import("../core/tracing.js");
          tracing.addSpanEvent(span, "think.start");
        } catch {
          // Tracing is non-critical — log but don't interrupt agent flow
        }
      }
      const thought = await this.think(effectiveTask);
      this.emit("thought", { agent: this.identity.id, thought });

      // ── Mid-task context check: between think and act ──
      this.throwIfAborted(signal);
      const postThink = this.drainContextUpdates(effectiveTask);
      if (postThink) {
        effectiveTask = postThink.updatedTask;
        // Re-think with updated context — the user redirected us
        if (span) {
          try {
            const tracing = await import("../core/tracing.js");
            tracing.addSpanEvent(span, "context.redirect", {
              "messages": postThink.messages.length,
            });
          } catch {
            // Tracing is non-critical — log but don't interrupt agent flow
          }
        }
        const revisedThought = await this.think(effectiveTask);
        this.emit("thought", { agent: this.identity.id, thought: revisedThought });

        this.transition("acting");
        if (span) {
          try {
            const tracing = await import("../core/tracing.js");
            tracing.addSpanEvent(span, "act.start", {
              "plan.steps": revisedThought.plan.length,
              "tool_calls": revisedThought.toolCalls.length,
            });
          } catch {
            // Tracing is non-critical — log but don't interrupt agent flow
          }
        }
        const result = await this.act(revisedThought);
        this.emit("action", { agent: this.identity.id, result });

        this.throwIfAborted(signal);

        if (result.nextAction === "observe") {
          this.transition("waiting");
          const observations = await this.observe({ task: effectiveTask, thought: revisedThought, result });
          this.emit("observation", { agent: this.identity.id, observations });
        }

        this.throwIfAborted(signal);
        this.transition("idle");
        const finalReport = await this.report();
        this.taskHistory.push({ task: JSON.stringify(effectiveTask).slice(0, 500), result: finalReport, timestamp: Date.now() });
        if (span) { try { const tracing = await import("../core/tracing.js"); tracing.endSpan(span, "ok"); } catch { /* Tracing is non-critical — log but don't interrupt agent flow */ } }
        return finalReport;
      }

      this.transition("acting");
      if (span) {
        try {
          const tracing = await import("../core/tracing.js");
          tracing.addSpanEvent(span, "act.start", {
            "plan.steps": thought.plan.length,
            "tool_calls": thought.toolCalls.length,
          });
        } catch {
          // Tracing is non-critical — log but don't interrupt agent flow
        }
      }
      const result = await this.act(thought);
      this.emit("action", { agent: this.identity.id, result });

      // ── Mid-task context check: between act and observe ──
      this.throwIfAborted(signal);
      const postAct = this.drainContextUpdates(effectiveTask);
      if (postAct) {
        effectiveTask = postAct.updatedTask;
        // Context arrived after acting but before observe — fold into observations
        this.remember("_mid_task_context", postAct.messages.map((m) => m.payload));
      }

      if (result.nextAction === "observe") {
        this.transition("waiting");
        if (span) {
          try {
            const tracing = await import("../core/tracing.js");
            tracing.addSpanEvent(span, "observe.start");
          } catch {
            // Tracing is non-critical — log but don't interrupt agent flow
          }
        }
        const observations = await this.observe({ task: effectiveTask, thought, result });
        this.emit("observation", { agent: this.identity.id, observations });
      }

      this.throwIfAborted(signal);

      this.transition("idle");
      const finalReport = await this.report();

      this.taskHistory.push({
        task: JSON.stringify(effectiveTask).slice(0, 500),
        result: finalReport,
        timestamp: Date.now(),
      });

      if (span) {
        try {
          const tracing = await import("../core/tracing.js");
          tracing.endSpan(span, "ok");
        } catch {
          // Tracing is non-critical — log but don't interrupt agent flow
        }
      }

      return finalReport;
    } catch (err) {
      this.transition("error");
      this.emit("error", { agent: this.identity.id, error: err });
      if (span) {
        try {
          const tracing = await import("../core/tracing.js");
          span.attributes["error.message"] = (err as Error).message;
          tracing.endSpan(span, "error");
        } catch {
          // Tracing is non-critical — log but don't interrupt agent flow
        }
      }
      throw err;
    }
  }

  /** Throw if the abort signal has fired (e.g. task timed out). */
  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException("Agent execution aborted", "AbortError");
    }
  }

  /** External tool handler injected by the runtime (e.g. ToolExecutor). */
  private _toolHandler?: (call: ToolCall) => Promise<ToolResult>;

  /**
   * Set an external tool handler that will be used by callTool().
   * The runtime injects this after resolving permissions so that
   * each agent executes tools through the ToolExecutor with proper
   * permission checks.
   */
  setToolHandler(handler: (call: ToolCall) => Promise<ToolResult>): void {
    this._toolHandler = handler;
  }

  /** Attach a persistent memory store. When set, remember() also writes to SQLite. */
  private _persistentStore: any = null;
  attachMemoryStore(store: any): void {
    this._persistentStore = store;
  }

  /** Store a value in agent short-term memory (and persistent store if attached). */
  remember(key: string, value: unknown, ttl?: number): void {
    this.memory.set(key, { key, value, timestamp: Date.now(), ttl });

    // Also persist to SQLite store if attached (fire-and-forget)
    if (this._persistentStore && typeof value === "string" && !ttl) {
      this._persistentStore.write({
        namespace: this.identity.role,
        title: key,
        content: value,
        level: 0,
        source: this.identity.id,
      }).catch(() => {});
    }
  }

  /** Retrieve a value from memory, respecting TTL expiration. */
  recall(key: string): unknown | undefined {
    const entry = this.memory.get(key);
    if (!entry) return undefined;
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.memory.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Invoke a tool by name with arguments.
   *
   * If a tool handler has been injected via setToolHandler(), it is used
   * for real execution (HTTP requests, shell commands, LLM calls, etc.).
   * Otherwise falls back to a warning — the runtime must wire up the
   * ToolExecutor before agents can do real work.
   */
  protected async callTool(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    this.emit("tool:call", { agent: this.identity.id, tool: call.tool, args: call.args });

    try {
      // Use the injected tool handler if available
      if (this._toolHandler) {
        const result = await this._toolHandler(call);
        this.emit("tool:result", {
          agent: this.identity.id,
          tool: call.tool,
          success: result.success,
          durationMs: result.durationMs,
        });
        return result;
      }

      // No tool handler injected — warn and return failure
      const error = `Tool "${call.tool}" not registered — agent ${this.identity.id} has no tool provider. The runtime must inject a tool handler via setToolHandler() or the orchestrator must wire up a ToolExecutor.`;
      console.warn(`[${this.identity.id}] ${error}`);
      this.emit("tool:error", { agent: this.identity.id, tool: call.tool, error });
      return {
        tool: call.tool,
        success: false,
        data: null,
        error,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit("tool:error", { agent: this.identity.id, tool: call.tool, error });
      return {
        tool: call.tool,
        success: false,
        data: null,
        error,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Delegate a task to another agent by role.
   * Emits a "delegate" event that the orchestrator listens for and routes.
   */
  delegate(targetRole: string, task: unknown, reason: string): void {
    const message: AgentMessage = {
      from: this.identity.id,
      to: targetRole, // resolved to a specific agent by the orchestrator
      type: "task",
      payload: { task, reason, delegatedBy: this.identity.id },
      timestamp: Date.now(),
      correlationId: `del-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    };
    this.emit("delegate", message);
  }

  /** Send a message to another agent (by ID or role). */
  sendMessage(to: string, type: AgentMessage["type"], payload: unknown): void {
    const message: AgentMessage = {
      from: this.identity.id,
      to,
      type,
      payload,
      timestamp: Date.now(),
      correlationId: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    };
    this.emit("message", message);
  }

  /** Receive a message from another agent. */
  receiveMessage(message: AgentMessage): void {
    this.inbox.push(message);
    this.emit("message:received", message);
  }

  /** Check if this agent can handle a given capability. */
  hasCapability(name: string): boolean {
    return this.capabilities.some((c) => c.name === name);
  }

  getState(): AgentState {
    return this.state;
  }

  getCapabilities(): AgentCapability[] {
    return [...this.capabilities];
  }

  /** Produce a health snapshot for the orchestrator. */
  healthCheck(): { id: string; state: AgentState; memorySize: number; uptime: number; taskCount: number } {
    return {
      id: this.identity.id,
      state: this.state,
      memorySize: this.memory.size,
      uptime: process.uptime(),
      taskCount: this.taskHistory.length,
    };
  }

  /**
   * Set the performance profile string (generated by LearningLoop).
   * Called by the orchestrator before each task execution.
   */
  setPerformanceProfile(profile: string): void {
    this.performanceProfile = profile;
  }

  /**
   * Get the current strategy context for use in the thinking phase.
   * Subclasses can override this to incorporate performance data
   * into their LLM prompts or reasoning logic.
   */
  getStrategyContext(): string {
    return this.performanceProfile ?? '';
  }

  protected transition(next: AgentState): void {
    const allowed = this.stateTransitions.get(this.state);
    if (!allowed?.includes(next)) {
      throw new Error(`Invalid state transition: ${this.state} -> ${next}`);
    }
    const prev = this.state;
    this.state = next;
    this.emit("state:change", { agent: this.identity.id, from: prev, to: next });
  }

  /** Flush expired entries from memory. */
  protected pruneMemory(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.memory) {
      if (entry.ttl && now - entry.timestamp > entry.ttl) {
        this.memory.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}
