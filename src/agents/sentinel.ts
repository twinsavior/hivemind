import {
  BaseAgent,
  type AgentIdentity,
  type ThinkResult,
  type ActResult,
  type Observation,
  type ToolCall,
} from "./base-agent.js";

type AlertSeverity = "info" | "warning" | "critical";

interface MonitorTarget {
  name: string;
  url: string;
  intervalMs: number;
  expectedStatus: number;
  timeout: number;
}

interface Alert {
  id: string;
  severity: AlertSeverity;
  source: string;
  message: string;
  details: Record<string, unknown>;
  timestamp: number;
  acknowledged: boolean;
}

interface HealthSnapshot {
  target: string;
  status: "healthy" | "degraded" | "down";
  responseMs: number;
  statusCode?: number;
  checkedAt: number;
}

/** Monitoring, alerting, and security scanning agent. Watches over infrastructure and services. */
export class SentinelAgent extends BaseAgent {
  private targets: Map<string, MonitorTarget> = new Map();
  private alerts: Alert[] = [];
  private snapshots: Map<string, HealthSnapshot[]> = new Map();
  private monitorInterval?: ReturnType<typeof setInterval>;

  constructor(id?: string) {
    const identity: AgentIdentity = {
      id: id ?? `sentinel-${Date.now().toString(36)}`,
      name: "Sentinel",
      role: "monitoring",
      version: "1.0.0",
    };
    super(identity);

    this.capabilities = [
      {
        name: "check_uptime",
        description: "Check if a URL is reachable and responding",
        parameters: {
          url: { type: "string", required: true, description: "URL to check" },
          expectedStatus: { type: "number", required: false, description: "Expected HTTP status" },
        },
      },
      {
        name: "analyze_logs",
        description: "Analyze log files for errors and anomalies",
        parameters: {
          source: { type: "string", required: true, description: "Log source path or identifier" },
          pattern: { type: "string", required: false, description: "Regex pattern to search for" },
        },
      },
      {
        name: "security_scan",
        description: "Run security checks on a target",
        parameters: {
          target: { type: "string", required: true, description: "Target to scan" },
          scanType: { type: "string", required: false, description: "Type of scan: deps, ports, headers" },
        },
      },
      {
        name: "performance_check",
        description: "Measure performance metrics for a service",
        parameters: {
          url: { type: "string", required: true, description: "Service URL" },
          samples: { type: "number", required: false, description: "Number of samples" },
        },
      },
    ];
  }

  /** Register a URL endpoint for uptime monitoring. */
  watch(target: MonitorTarget): void {
    this.targets.set(target.name, target);
    this.snapshots.set(target.name, []);
  }

  /** Remove a target from monitoring. */
  unwatch(name: string): void {
    this.targets.delete(name);
    this.snapshots.delete(name);
  }

  /** Start continuous monitoring loop. */
  startMonitoring(): void {
    if (this.monitorInterval) return;
    this.monitorInterval = setInterval(() => this.runHealthChecks(), 60_000);
    this.runHealthChecks();
  }

  /** Stop continuous monitoring. */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
  }

  /** Get all unacknowledged alerts. */
  getActiveAlerts(): Alert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  async think(input: unknown): Promise<ThinkResult> {
    const task = input as { action?: string; targets?: MonitorTarget[]; logSource?: string };
    const toolCalls: ToolCall[] = [];

    if (task.targets) {
      for (const t of task.targets) {
        this.watch(t);
      }
    }

    for (const [, target] of this.targets) {
      toolCalls.push({ tool: "check_uptime", args: { url: target.url, expectedStatus: target.expectedStatus } });
      toolCalls.push({ tool: "performance_check", args: { url: target.url, samples: 3 } });
    }

    if (task.logSource) {
      toolCalls.push({ tool: "analyze_logs", args: { source: task.logSource, pattern: "error|fatal|exception" } });
    }

    toolCalls.push({ tool: "security_scan", args: { target: "all", scanType: "deps" } });

    return {
      reasoning: `Monitoring ${this.targets.size} targets, analyzing logs, and running security scans`,
      plan: [
        "Check uptime for all registered targets",
        "Measure performance baselines",
        "Analyze logs for anomalies",
        "Run dependency security scan",
        "Generate alert summary",
      ],
      toolCalls,
      confidence: 0.9,
    };
  }

  async act(plan: ThinkResult): Promise<ActResult> {
    const toolResults = [];

    for (const call of plan.toolCalls) {
      const result = await this.callTool(call);
      toolResults.push(result);

      if (!result.success && call.tool === "check_uptime") {
        this.raiseAlert("critical", call.args["url"] as string, `Uptime check failed: ${result.error}`, {
          url: call.args["url"],
          error: result.error,
        });
      }
    }

    return { toolResults, output: { alerts: this.getActiveAlerts() }, nextAction: "observe" };
  }

  async observe(context: Record<string, unknown>): Promise<Observation[]> {
    const observations: Observation[] = [];
    const active = this.getActiveAlerts();

    if (active.length > 0) {
      const critical = active.filter((a) => a.severity === "critical");
      observations.push({
        source: "alert_system",
        data: active,
        analysis: `${active.length} active alerts (${critical.length} critical)`,
        relevance: critical.length > 0 ? 1.0 : 0.7,
      });
    }

    for (const [name, history] of this.snapshots) {
      if (history.length < 2) continue;
      const recent = history.slice(-5);
      const avgResponse = recent.reduce((sum, s) => sum + s.responseMs, 0) / recent.length;
      const degraded = recent.some((s) => s.status !== "healthy");

      if (degraded) {
        observations.push({
          source: `monitor:${name}`,
          data: { avgResponse, recent },
          analysis: `${name} showing degraded performance (avg ${avgResponse.toFixed(0)}ms)`,
          relevance: 0.8,
        });
      }
    }

    return observations;
  }

  async report(): Promise<Record<string, unknown>> {
    const targetStatus: Record<string, unknown> = {};
    for (const [name, history] of this.snapshots) {
      const latest = history[history.length - 1];
      targetStatus[name] = latest ?? { status: "unknown" };
    }

    return {
      agent: this.identity.id,
      type: "monitoring_report",
      targets: this.targets.size,
      activeAlerts: this.getActiveAlerts().length,
      totalAlerts: this.alerts.length,
      status: targetStatus,
      timestamp: Date.now(),
    };
  }

  private raiseAlert(severity: AlertSeverity, source: string, message: string, details: Record<string, unknown>): void {
    const alert: Alert = {
      id: `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      severity,
      source,
      message,
      details,
      timestamp: Date.now(),
      acknowledged: false,
    };
    this.alerts.push(alert);
    this.emit("alert", alert);
  }

  private async runHealthChecks(): Promise<void> {
    for (const [name, target] of this.targets) {
      const result = await this.callTool({
        tool: "check_uptime",
        args: { url: target.url, expectedStatus: target.expectedStatus },
      });

      const snapshot: HealthSnapshot = {
        target: name,
        status: result.success ? "healthy" : "down",
        responseMs: result.durationMs,
        statusCode: result.data && typeof result.data === "object" ? (result.data as { statusCode?: number }).statusCode : undefined,
        checkedAt: Date.now(),
      };

      const history = this.snapshots.get(name) ?? [];
      history.push(snapshot);
      if (history.length > 100) history.splice(0, history.length - 100);
      this.snapshots.set(name, history);

      if (snapshot.status === "down") {
        this.raiseAlert("critical", name, `${name} is DOWN`, { snapshot });
      }
    }
  }
}
