import {
  BaseAgent,
  type AgentIdentity,
  type ThinkResult,
  type ActResult,
  type Observation,
  type ToolCall,
} from "./base-agent.js";

type Channel = "slack" | "discord" | "telegram" | "whatsapp" | "email";
type MessagePriority = "urgent" | "normal" | "low" | "digest";

interface ChannelConfig {
  channel: Channel;
  enabled: boolean;
  credentials: Record<string, string>;
  defaultRecipient?: string;
  rateLimit: { maxPerMinute: number; maxPerHour: number };
}

interface OutboundMessage {
  id: string;
  channel: Channel;
  recipient: string;
  subject?: string;
  body: string;
  priority: MessagePriority;
  attachments: Array<{ name: string; data: unknown }>;
  status: "queued" | "sent" | "failed" | "rate_limited";
  scheduledAt?: number;
  sentAt?: number;
  error?: string;
}

interface RoutingRule {
  name: string;
  condition: (message: { priority: MessagePriority; body: string }) => boolean;
  channels: Channel[];
  transform?: (body: string) => string;
}

/** Interface for the ConnectorManager bridge (avoids circular imports). */
interface ConnectorManagerBridge {
  send(connectorName: string, channelId: string, content: string): Promise<void>;
  getConnectorNames(): string[];
}

/** Communication and integration agent. Routes messages across platforms and manages notifications. */
export class CourierAgent extends BaseAgent {
  private channels: Map<Channel, ChannelConfig> = new Map();
  private outbox: OutboundMessage[] = [];
  private routingRules: RoutingRule[] = [];
  private rateLedger: Map<Channel, { minute: number[]; hour: number[] }> = new Map();
  private connectorManagerBridge: ConnectorManagerBridge | null = null;

  constructor(id?: string) {
    const identity: AgentIdentity = {
      id: id ?? `courier-${Date.now().toString(36)}`,
      name: "Courier",
      role: "communication",
      version: "1.0.0",
    };
    super(identity);

    this.capabilities = [
      {
        name: "send_message",
        description: "Send a message through a specified channel",
        parameters: {
          channel: { type: "string", required: true, description: "Target channel (slack, discord, etc.)" },
          recipient: { type: "string", required: true, description: "Recipient identifier" },
          body: { type: "string", required: true, description: "Message content" },
          priority: { type: "string", required: false, description: "Message priority" },
        },
      },
      {
        name: "broadcast",
        description: "Send a message to all configured channels",
        parameters: {
          body: { type: "string", required: true, description: "Message content" },
          priority: { type: "string", required: false, description: "Message priority" },
        },
      },
      {
        name: "schedule_message",
        description: "Schedule a message for future delivery",
        parameters: {
          channel: { type: "string", required: true, description: "Target channel" },
          recipient: { type: "string", required: true, description: "Recipient identifier" },
          body: { type: "string", required: true, description: "Message content" },
          sendAt: { type: "number", required: true, description: "Unix timestamp for delivery" },
        },
      },
      {
        name: "send_report",
        description: "Format and distribute a structured report",
        parameters: {
          report: { type: "object", required: true, description: "Report data to format and send" },
          channels: { type: "string[]", required: false, description: "Target channels" },
        },
      },
    ];
  }

  /** Register a messaging channel with credentials and rate limits. */
  configureChannel(config: ChannelConfig): void {
    this.channels.set(config.channel, config);
    this.rateLedger.set(config.channel, { minute: [], hour: [] });
  }

  /** Add a routing rule for automatic message dispatch. */
  addRoutingRule(rule: RoutingRule): void {
    this.routingRules.push(rule);
  }

  /**
   * Bridge the CourierAgent's outbox to real connectors.
   * When set, `flushOutbox()` routes messages through the ConnectorManager
   * instead of relying on the abstract `callTool` stub.
   */
  setConnectorManager(cm: ConnectorManagerBridge): void {
    this.connectorManagerBridge = cm;
  }

  /** Queue a message for delivery, respecting rate limits and routing rules. */
  queueMessage(channel: Channel, recipient: string, body: string, priority: MessagePriority = "normal"): OutboundMessage {
    const message: OutboundMessage = {
      id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      channel,
      recipient,
      body,
      priority,
      attachments: [],
      status: "queued",
    };

    if (!this.checkRateLimit(channel)) {
      message.status = "rate_limited";
      this.emit("message:rate_limited", { id: message.id, channel });
    }

    this.outbox.push(message);
    return message;
  }

  /** Route a message through all matching routing rules. */
  route(body: string, priority: MessagePriority): OutboundMessage[] {
    const messages: OutboundMessage[] = [];
    const payload = { priority, body };

    for (const rule of this.routingRules) {
      if (rule.condition(payload)) {
        const transformed = rule.transform ? rule.transform(body) : body;
        for (const channel of rule.channels) {
          const config = this.channels.get(channel);
          if (config?.enabled && config.defaultRecipient) {
            messages.push(this.queueMessage(channel, config.defaultRecipient, transformed, priority));
          }
        }
      }
    }

    return messages;
  }

  async think(input: unknown): Promise<ThinkResult> {
    const task = input as {
      action?: string;
      channel?: Channel;
      recipient?: string;
      body?: string;
      priority?: MessagePriority;
      report?: Record<string, unknown>;
    };

    const toolCalls: ToolCall[] = [];
    const action = task.action ?? "send";

    if (action === "broadcast" && task.body) {
      toolCalls.push({ tool: "broadcast", args: { body: task.body, priority: task.priority ?? "normal" } });
    } else if (action === "report" && task.report) {
      toolCalls.push({ tool: "send_report", args: { report: task.report, channels: [...this.channels.keys()] } });
    } else if (task.channel && task.recipient && task.body) {
      toolCalls.push({
        tool: "send_message",
        args: { channel: task.channel, recipient: task.recipient, body: task.body, priority: task.priority ?? "normal" },
      });
    }

    return {
      reasoning: `Preparing to ${action} via ${task.channel ?? "all channels"} (priority: ${task.priority ?? "normal"})`,
      plan: toolCalls.map((tc) => `Execute ${tc.tool}`),
      toolCalls,
      confidence: toolCalls.length > 0 ? 0.9 : 0.3,
    };
  }

  async act(plan: ThinkResult): Promise<ActResult> {
    const toolResults = [];
    const sent: OutboundMessage[] = [];

    for (const call of plan.toolCalls) {
      if (call.tool === "broadcast") {
        for (const [channel, config] of this.channels) {
          if (config.enabled && config.defaultRecipient) {
            const msg = this.queueMessage(channel, config.defaultRecipient, call.args["body"] as string, call.args["priority"] as MessagePriority);
            sent.push(msg);
          }
        }
      }

      const result = await this.callTool(call);
      toolResults.push(result);
    }

    await this.flushOutbox();

    return {
      toolResults,
      output: { queued: this.outbox.length, sent: sent.length },
      nextAction: "report",
    };
  }

  async observe(context: Record<string, unknown>): Promise<Observation[]> {
    const failed = this.outbox.filter((m) => m.status === "failed");
    const rateLimited = this.outbox.filter((m) => m.status === "rate_limited");
    const observations: Observation[] = [];

    if (failed.length > 0) {
      observations.push({
        source: "outbox",
        data: failed.map((m) => ({ id: m.id, channel: m.channel, error: m.error })),
        analysis: `${failed.length} messages failed to deliver`,
        relevance: 0.9,
      });
    }

    if (rateLimited.length > 0) {
      observations.push({
        source: "rate_limiter",
        data: rateLimited.map((m) => ({ id: m.id, channel: m.channel })),
        analysis: `${rateLimited.length} messages rate-limited`,
        relevance: 0.6,
      });
    }

    return observations;
  }

  async report(): Promise<Record<string, unknown>> {
    const stats: Record<Channel, { sent: number; failed: number; queued: number }> = {} as never;
    for (const msg of this.outbox) {
      if (!stats[msg.channel]) stats[msg.channel] = { sent: 0, failed: 0, queued: 0 };
      if (msg.status === "sent") stats[msg.channel].sent++;
      else if (msg.status === "failed") stats[msg.channel].failed++;
      else stats[msg.channel].queued++;
    }

    return {
      agent: this.identity.id,
      type: "communication_report",
      channelsConfigured: this.channels.size,
      routingRules: this.routingRules.length,
      outboxSize: this.outbox.length,
      channelStats: stats,
      timestamp: Date.now(),
    };
  }

  private checkRateLimit(channel: Channel): boolean {
    const ledger = this.rateLedger.get(channel);
    const config = this.channels.get(channel);
    if (!ledger || !config) return true;

    const now = Date.now();
    ledger.minute = ledger.minute.filter((t) => now - t < 60_000);
    ledger.hour = ledger.hour.filter((t) => now - t < 3_600_000);

    if (ledger.minute.length >= config.rateLimit.maxPerMinute) return false;
    if (ledger.hour.length >= config.rateLimit.maxPerHour) return false;

    ledger.minute.push(now);
    ledger.hour.push(now);
    return true;
  }

  private static readonly MAX_OUTBOX_SIZE = 500;

  /** Evict completed (sent/failed) messages when outbox exceeds limit. */
  private pruneOutbox(): void {
    if (this.outbox.length <= CourierAgent.MAX_OUTBOX_SIZE) return;
    this.outbox = this.outbox.filter((m) => m.status === "queued" || m.status === "rate_limited");
  }

  private async flushOutbox(): Promise<void> {
    for (const msg of this.outbox) {
      if (msg.status !== "queued") continue;

      // Use ConnectorManager bridge if available (routes to real connectors)
      if (this.connectorManagerBridge) {
        try {
          await this.connectorManagerBridge.send(msg.channel, msg.recipient, msg.body);
          msg.status = "sent";
          msg.sentAt = Date.now();
          this.emit("message:sent", { id: msg.id, channel: msg.channel });
        } catch (err) {
          msg.status = "failed";
          msg.error = (err as Error).message;
          this.emit("message:failed", { id: msg.id, channel: msg.channel, error: msg.error });
        }
        continue;
      }

      // Fallback: use abstract callTool (stub in base agent)
      const result = await this.callTool({
        tool: "send_message",
        args: { channel: msg.channel, recipient: msg.recipient, body: msg.body },
      });

      if (result.success) {
        msg.status = "sent";
        msg.sentAt = Date.now();
        this.emit("message:sent", { id: msg.id, channel: msg.channel });
      } else {
        msg.status = "failed";
        msg.error = result.error;
        this.emit("message:failed", { id: msg.id, channel: msg.channel, error: result.error });
      }
    }

    this.pruneOutbox();
  }
}
