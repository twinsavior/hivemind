/**
 * Agent performance tracking for Nova's team management.
 * Tracks success rates, response times, token usage, and delegation counts.
 */

export interface ToolMetrics {
  toolName: string;
  calls: number;
  successes: number;
  totalDurationMs: number;
}

export interface AgentMetrics {
  agentId: string;
  agentName: string;
  tasksCompleted: number;
  tasksFailed: number;
  avgResponseTimeMs: number;
  totalTokensUsed: number;
  lastActiveAt: number;
  delegationCount: number;
  correctionCount: number; // times Nova had to redo/correct this agent's work
  /** Per-tool success/failure tracking. */
  toolMetrics: Map<string, ToolMetrics>;
}

export interface MetricsSummary {
  agentId: string;
  agentName: string;
  successRate: number;
  tasksCompleted: number;
  tasksFailed: number;
  avgResponseTimeMs: number;
  delegationCount: number;
  status: 'excellent' | 'good' | 'warning' | 'poor';
}

/** Lightweight in-memory performance tracker. */
export class MetricsTracker {
  private metrics = new Map<string, AgentMetrics>();

  /** Initialize tracking for an agent. */
  register(agentId: string, agentName: string): void {
    if (this.metrics.has(agentId)) return;
    this.metrics.set(agentId, {
      agentId,
      agentName,
      tasksCompleted: 0,
      tasksFailed: 0,
      avgResponseTimeMs: 0,
      totalTokensUsed: 0,
      lastActiveAt: Date.now(),
      delegationCount: 0,
      correctionCount: 0,
      toolMetrics: new Map(),
    });
  }

  /** Record a completed task. */
  recordSuccess(agentId: string, responseTimeMs: number, tokensUsed: number = 0): void {
    const m = this.metrics.get(agentId);
    if (!m) return;
    const total = m.tasksCompleted + m.tasksFailed;
    m.avgResponseTimeMs = total > 0
      ? (m.avgResponseTimeMs * m.tasksCompleted + responseTimeMs) / (m.tasksCompleted + 1)
      : responseTimeMs;
    m.tasksCompleted++;
    m.totalTokensUsed += tokensUsed;
    m.lastActiveAt = Date.now();
  }

  /** Record a failed task. */
  recordFailure(agentId: string): void {
    const m = this.metrics.get(agentId);
    if (!m) return;
    m.tasksFailed++;
    m.lastActiveAt = Date.now();
  }

  /** Record that Nova delegated to this agent. */
  recordDelegation(agentId: string): void {
    const m = this.metrics.get(agentId);
    if (!m) return;
    m.delegationCount++;
  }

  /** Record that Nova had to correct this agent's work. */
  recordCorrection(agentId: string): void {
    const m = this.metrics.get(agentId);
    if (!m) return;
    m.correctionCount++;
  }

  /** Get raw metrics for an agent. */
  get(agentId: string): AgentMetrics | undefined {
    return this.metrics.get(agentId);
  }

  /** Remove an agent (fired/sunset). */
  remove(agentId: string): void {
    this.metrics.delete(agentId);
  }

  /** Get a summary suitable for injecting into Nova's context. */
  getSummary(): MetricsSummary[] {
    const summaries: MetricsSummary[] = [];
    for (const m of this.metrics.values()) {
      const total = m.tasksCompleted + m.tasksFailed;
      const successRate = total > 0 ? m.tasksCompleted / total : 1;
      let status: MetricsSummary['status'] = 'good';
      if (total === 0) status = 'good'; // no data yet
      else if (successRate >= 0.9) status = 'excellent';
      else if (successRate >= 0.7) status = 'good';
      else if (successRate >= 0.5) status = 'warning';
      else status = 'poor';

      summaries.push({
        agentId: m.agentId,
        agentName: m.agentName,
        successRate,
        tasksCompleted: m.tasksCompleted,
        tasksFailed: m.tasksFailed,
        avgResponseTimeMs: m.avgResponseTimeMs,
        delegationCount: m.delegationCount,
        status,
      });
    }
    return summaries;
  }

  /** Record a tool use event with success/failure and duration. */
  recordToolUse(agentId: string, toolName: string, success: boolean, durationMs: number): void {
    const m = this.metrics.get(agentId);
    if (!m) return;
    const existing = m.toolMetrics.get(toolName) ?? {
      toolName,
      calls: 0,
      successes: 0,
      totalDurationMs: 0,
    };
    existing.calls++;
    if (success) existing.successes++;
    existing.totalDurationMs += durationMs;
    m.toolMetrics.set(toolName, existing);
  }

  /** Get per-tool performance data for an agent. */
  getToolMetrics(agentId: string): Map<string, { calls: number; successes: number; avgDurationMs: number }> {
    const m = this.metrics.get(agentId);
    const result = new Map<string, { calls: number; successes: number; avgDurationMs: number }>();
    if (!m) return result;
    for (const [name, tm] of m.toolMetrics) {
      result.set(name, {
        calls: tm.calls,
        successes: tm.successes,
        avgDurationMs: tm.calls > 0 ? tm.totalDurationMs / tm.calls : 0,
      });
    }
    return result;
  }

  /** Serialize all metrics to a plain JSON object for persistence. */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [agentId, m] of this.metrics) {
      const toolMetricsObj: Record<string, ToolMetrics> = {};
      for (const [toolName, tm] of m.toolMetrics) {
        toolMetricsObj[toolName] = tm;
      }
      result[agentId] = {
        agentId: m.agentId,
        agentName: m.agentName,
        tasksCompleted: m.tasksCompleted,
        tasksFailed: m.tasksFailed,
        avgResponseTimeMs: m.avgResponseTimeMs,
        totalTokensUsed: m.totalTokensUsed,
        lastActiveAt: m.lastActiveAt,
        delegationCount: m.delegationCount,
        correctionCount: m.correctionCount,
        toolMetrics: toolMetricsObj,
      };
    }
    return result;
  }

  /** Load metrics from a previously serialized JSON object. */
  fromJSON(data: Record<string, unknown>): void {
    this.metrics.clear();
    for (const [agentId, raw] of Object.entries(data)) {
      const d = raw as Record<string, unknown>;
      const toolMap = new Map<string, ToolMetrics>();
      const toolObj = d["toolMetrics"] as Record<string, ToolMetrics> | undefined;
      if (toolObj) {
        for (const [toolName, tm] of Object.entries(toolObj)) {
          toolMap.set(toolName, {
            toolName: tm.toolName ?? toolName,
            calls: tm.calls ?? 0,
            successes: tm.successes ?? 0,
            totalDurationMs: tm.totalDurationMs ?? 0,
          });
        }
      }
      this.metrics.set(agentId, {
        agentId: (d["agentId"] as string) ?? agentId,
        agentName: (d["agentName"] as string) ?? agentId,
        tasksCompleted: (d["tasksCompleted"] as number) ?? 0,
        tasksFailed: (d["tasksFailed"] as number) ?? 0,
        avgResponseTimeMs: (d["avgResponseTimeMs"] as number) ?? 0,
        totalTokensUsed: (d["totalTokensUsed"] as number) ?? 0,
        lastActiveAt: (d["lastActiveAt"] as number) ?? Date.now(),
        delegationCount: (d["delegationCount"] as number) ?? 0,
        correctionCount: (d["correctionCount"] as number) ?? 0,
        toolMetrics: toolMap,
      });
    }
  }

  /** Format metrics as a human-readable string for Nova's system prompt. */
  formatForPrompt(): string {
    const summaries = this.getSummary();
    if (summaries.length === 0) return 'No agent metrics available yet.';

    const lines = summaries.map(s => {
      const rate = (s.successRate * 100).toFixed(0);
      const avg = s.avgResponseTimeMs > 0 ? `${(s.avgResponseTimeMs / 1000).toFixed(1)}s` : 'n/a';
      const flag = s.status === 'warning' ? ' ⚠️' : s.status === 'poor' ? ' ❌' : '';
      const total = s.tasksCompleted + s.tasksFailed;
      if (total === 0) return `- ${s.agentName}: idle (no tasks yet)`;
      return `- ${s.agentName}: ${total} tasks, ${rate}% success, avg ${avg}${flag}`;
    });

    return '## Team Performance\n' + lines.join('\n');
  }
}
