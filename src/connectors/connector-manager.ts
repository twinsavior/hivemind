import { EventEmitter } from "node:events";
import {
  BaseConnector,
  ConnectionState,
  type ConnectorMessage,
} from "./base.js";
import { createConnector, type AnyConnectorConfig } from "./index.js";
import { type TrustGate, type TaskSource, TrustLevel } from "../core/trust.js";
import { DiscordConnector } from "./discord.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Context needed to route a task response back to the originating connector. */
export interface ReplyContext {
  connectorName: string;
  channelId: string;
  messageId?: string;
  authorId: string;
  authorName: string;
}

/** Live status snapshot for a single connector. */
export interface ConnectorStatus {
  name: string;
  type: string;
  state: ConnectionState;
  messagesReceived: number;
  messagesSent: number;
  lastActivity?: string;
  error?: string;
}

/** Options passed when creating a ConnectorManager. */
export interface ConnectorManagerOptions {
  /** Dashboard event bus for broadcasting status updates. */
  bus: EventEmitter;
  /** Trust gate for classifying inbound connector messages. */
  trustGate: TrustGate;
  /**
   * Callback to submit a connector-originated task.
   * Returns a promise that resolves with the task result string.
   */
  submitTask: (
    description: string,
    source: TaskSource,
    replyContext: ReplyContext,
  ) => Promise<string>;
}

/** Per-connector trigger mode configuration. */
interface TriggerConfig {
  /** "mention" = only process @mentions; "all" = process every message. Default: "mention". */
  mode: "mention" | "all";
  /** Channel IDs where all messages are processed regardless of mode. */
  listenAllChannels: string[];
}

/** Discord-specific REST helpers. */
const DISCORD_API = "https://discord.com/api/v10";

/** Maximum Discord message length. */
const DISCORD_MAX_LENGTH = 2000;

/** How often to refresh the typing indicator (Discord expires after 10s). */
const TYPING_REFRESH_MS = 8_000;

/** Reply context entries expire after 10 minutes (matches dashboard task eviction). */
const REPLY_CONTEXT_TTL_MS = 10 * 60 * 1000;

// ── ConnectorManager ──────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of all connectors and bridges inbound messages to the
 * task system and outbound responses back to the originating platform.
 */
export class ConnectorManager extends EventEmitter {
  private connectors = new Map<string, BaseConnector>();
  private connectorTypes = new Map<string, string>();
  private connectorTokens = new Map<string, string>();
  private triggerConfigs = new Map<string, TriggerConfig>();
  private stats = new Map<string, { received: number; sent: number; lastActivity?: string; error?: string }>();
  private replyContexts = new Map<string, ReplyContext>();
  private replyContextTimestamps = new Map<string, number>();
  private typingTimers = new Map<string, ReturnType<typeof setInterval>>();

  /** Our own bot user ID per connector (discovered on READY). */
  private botUserIds = new Map<string, string>();

  private readonly bus: EventEmitter;
  private readonly trustGate: TrustGate;
  private readonly submitTask: ConnectorManagerOptions["submitTask"];

  private evictionInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: ConnectorManagerOptions) {
    super();
    this.bus = options.bus;
    this.trustGate = options.trustGate;
    this.submitTask = options.submitTask;

    // Periodically evict stale reply contexts
    this.evictionInterval = setInterval(() => this.evictStaleContexts(), 2 * 60 * 1000);
  }

  // ── Initialization ──────────────────────────────────────────────────────

  /**
   * Initialize and connect all connectors from parsed config.
   * Token values starting with `$` are resolved from `process.env`.
   */
  async initializeAll(configs: AnyConnectorConfig[]): Promise<void> {
    for (const raw of configs) {
      try {
        // Resolve env vars in config — cast through Record for the generic resolver
        const resolved = this.resolveEnvTokens(raw as unknown as Record<string, unknown>);
        const config = resolved as unknown as AnyConnectorConfig;
        const name = config.name;
        const type = config.type;

        // Extract trigger config from nested config object (YAML structure)
        const innerConfig = (resolved as Record<string, unknown>)["config"] as Record<string, unknown> | undefined;
        const rawConfig = innerConfig ?? resolved;
        const triggerMode = rawConfig["triggerMode"] === "all" ? "all" : "mention";
        const listenAllRaw = rawConfig["listenAllChannels"];
        const listenAll: string[] = Array.isArray(listenAllRaw) ? listenAllRaw.map(String) : [];
        this.triggerConfigs.set(name, { mode: triggerMode as "mention" | "all", listenAllChannels: listenAll });

        // Store token for typing indicator API calls
        const token = (rawConfig["token"] as string | undefined) ?? (resolved as Record<string, unknown>)["token"] as string | undefined;
        if (token) this.connectorTokens.set(name, String(token));

        const connector = createConnector(config);
        this.connectors.set(name, connector);
        this.connectorTypes.set(name, type);
        this.stats.set(name, { received: 0, sent: 0 });

        // Wire events
        connector.on("message", (msg: ConnectorMessage) => this.handleInboundMessage(name, msg));
        connector.on("stateChange", (state: ConnectionState, prev: ConnectionState) => {
          console.log(`[Connector] ${name}: ${prev} → ${state}`);
          this.broadcastStatus();
        });
        connector.on("error", (err: Error) => {
          console.error(`[Connector] ${name} error: ${err.message}`);
          const s = this.stats.get(name);
          if (s) s.error = err.message;
          this.broadcastStatus();
        });
        connector.on("connected", () => {
          console.log(`[Connector] ${name} connected`);
          const s = this.stats.get(name);
          if (s) s.error = undefined;

          // Discover bot user ID for mention detection (Discord-specific)
          if (connector instanceof DiscordConnector) {
            this.discoverBotUserId(name, connector);
          }

          this.broadcastStatus();
        });

        // Connect
        await connector.connect();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`[Connector] Failed to initialize ${raw.name}: ${error.message}`);
      }
    }
  }

  // ── Inbound message handling ────────────────────────────────────────────

  private async handleInboundMessage(connectorName: string, msg: ConnectorMessage): Promise<void> {
    // Update stats
    const s = this.stats.get(connectorName);
    if (s) {
      s.received++;
      s.lastActivity = new Date().toISOString();
    }

    // Filter: ignore bot messages to prevent loops
    if (msg.author.isBot) return;

    // Filter: check trigger mode
    if (!this.shouldProcessMessage(connectorName, msg)) return;

    // Strip the bot mention from the message content for cleaner task descriptions
    const content = this.stripBotMention(connectorName, msg.content);
    if (!content.trim()) return; // Empty after stripping mention

    // Classify trust
    const trustLevel = msg.taskSource
      ? this.trustGate.classifySource(msg.taskSource)
      : TrustLevel.UNTRUSTED;

    // Sanitize input for untrusted sources
    const sanitizedContent = this.trustGate.sanitizeInput(content, trustLevel);

    // Build reply context
    const replyContext: ReplyContext = {
      connectorName,
      channelId: msg.channel,
      messageId: msg.metadata?.["discordMessageId"] as string | undefined,
      authorId: msg.author.id,
      authorName: msg.author.name,
    };

    // Broadcast to dashboard bus
    this.bus.emit("connector:message", {
      connector: connectorName,
      channel: msg.channel,
      author: msg.author.name,
      content: content.slice(0, 200),
      trust: trustLevel,
      timestamp: msg.timestamp,
    });

    // Start typing indicator
    this.startTypingIndicator(connectorName, msg.channel);

    try {
      // Submit task — the callback returns the full result
      const taskSource: TaskSource = msg.taskSource ?? {
        type: "connector",
        connector: connectorName,
        authenticated: trustLevel === TrustLevel.OWNER,
        userId: msg.author.id,
      };

      const result = await this.submitTask(sanitizedContent, taskSource, replyContext);

      // Stop typing
      this.stopTypingIndicator(connectorName, msg.channel);

      // Send result back to the originating channel
      await this.sendReply(connectorName, msg.channel, result, {
        replyTo: msg.metadata?.["discordMessageId"] as string | undefined,
      });
    } catch (err) {
      this.stopTypingIndicator(connectorName, msg.channel);
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[Connector] Task failed for ${connectorName}: ${error.message}`);

      // Send error back to user
      await this.sendReply(connectorName, msg.channel, `Sorry, I encountered an error: ${error.message}`, {
        replyTo: msg.metadata?.["discordMessageId"] as string | undefined,
      });
    }
  }

  /** Check whether a message should be processed based on trigger mode. */
  private shouldProcessMessage(connectorName: string, msg: ConnectorMessage): boolean {
    const config = this.triggerConfigs.get(connectorName);
    if (!config) return false;

    // Always process messages in listen-all channels
    if (config.listenAllChannels.includes(msg.channel)) return true;

    // If trigger mode is "all", process everything
    if (config.mode === "all") return true;

    // Mention mode: check if message mentions the bot
    const botUserId = this.botUserIds.get(connectorName);
    if (botUserId && msg.content.includes(`<@${botUserId}>`)) return true;

    // Also accept messages starting with common prefixes
    const content = msg.content.trim().toLowerCase();
    if (content.startsWith("!hivemind") || content.startsWith("/hivemind")) return true;

    return false;
  }

  /** Strip bot mention tags from message content. */
  private stripBotMention(connectorName: string, content: string): string {
    const botUserId = this.botUserIds.get(connectorName);
    if (botUserId) {
      content = content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
    }
    content = content.replace(/^[!/]hivemind\s*/i, "").trim();
    return content;
  }

  // ── Outbound message sending ────────────────────────────────────────────

  /**
   * Send a message through a connector, chunking if necessary.
   * Public so the CourierAgent can use it for outbound routing.
   */
  async sendReply(
    connectorName: string,
    channelId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const connector = this.connectors.get(connectorName);
    if (!connector || !connector.isConnected) {
      console.error(`[Connector] Cannot send: ${connectorName} is not connected`);
      return;
    }

    const s = this.stats.get(connectorName);

    // Chunk long messages for platforms with limits (Discord 2000 chars)
    const chunks = this.chunkMessage(content, DISCORD_MAX_LENGTH);

    for (let i = 0; i < chunks.length; i++) {
      try {
        // Only reply to the original message for the first chunk
        const chunkMeta = i === 0 ? metadata : undefined;
        await connector.send(channelId, chunks[i]!, chunkMeta);
        if (s) {
          s.sent++;
          s.lastActivity = new Date().toISOString();
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`[Connector] Send failed on ${connectorName}: ${error.message}`);
        if (s) s.error = error.message;
      }
    }

    this.broadcastStatus();
  }

  /** Send a message to a connector by name (convenience for CourierAgent). */
  async send(connectorName: string, channelId: string, content: string): Promise<void> {
    await this.sendReply(connectorName, channelId, content);
  }

  /**
   * Split a long message into chunks at natural boundaries.
   * Tries to break at paragraph boundaries, then newlines, then word boundaries.
   */
  private chunkMessage(content: string, maxLength: number): string[] {
    if (content.length <= maxLength) return [content];

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > maxLength) {
      let breakpoint = remaining.lastIndexOf("\n\n", maxLength);
      if (breakpoint <= 0 || breakpoint < maxLength * 0.3) {
        breakpoint = remaining.lastIndexOf("\n", maxLength);
      }
      if (breakpoint <= 0 || breakpoint < maxLength * 0.3) {
        breakpoint = remaining.lastIndexOf(" ", maxLength);
      }
      if (breakpoint <= 0) {
        breakpoint = maxLength;
      }

      chunks.push(remaining.slice(0, breakpoint));
      remaining = remaining.slice(breakpoint).trimStart();
    }

    if (remaining) chunks.push(remaining);
    return chunks;
  }

  // ── Typing indicator ────────────────────────────────────────────────────

  private startTypingIndicator(connectorName: string, channelId: string): void {
    const key = `${connectorName}:${channelId}`;
    this.stopTypingIndicator(connectorName, channelId);

    const token = this.connectorTokens.get(connectorName);
    if (!token) return;

    // Send initial typing indicator
    this.sendTypingIndicator(token, channelId).catch(() => {});

    // Refresh every 8 seconds (Discord typing expires after 10s)
    const timer = setInterval(() => {
      this.sendTypingIndicator(token, channelId).catch(() => {});
    }, TYPING_REFRESH_MS);

    this.typingTimers.set(key, timer);
  }

  private stopTypingIndicator(connectorName: string, channelId: string): void {
    const key = `${connectorName}:${channelId}`;
    const timer = this.typingTimers.get(key);
    if (timer) {
      clearInterval(timer);
      this.typingTimers.delete(key);
    }
  }

  private async sendTypingIndicator(token: string, channelId: string): Promise<void> {
    await fetch(`${DISCORD_API}/channels/${channelId}/typing`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
    });
  }

  // ── Bot user ID discovery ───────────────────────────────────────────────

  /**
   * Discover the bot's own user ID so we can detect @mentions.
   * Calls GET /users/@me on the Discord REST API.
   */
  private async discoverBotUserId(name: string, _connector: DiscordConnector): Promise<void> {
    const token = this.connectorTokens.get(name);
    if (!token) return;

    try {
      const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bot ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as { id: string };
        this.botUserIds.set(name, data.id);
        console.log(`[Connector] ${name}: bot user ID = ${data.id}`);
      }
    } catch {
      // Non-critical — mention detection won't work but !hivemind prefix still will
    }
  }

  // ── Env variable resolution ─────────────────────────────────────────────

  /** Recursively resolve `$ENV_VAR` and `${ENV_VAR}` patterns in config values. */
  private resolveEnvTokens<T extends Record<string, unknown>>(config: T): T {
    const resolved = { ...config } as Record<string, unknown>;

    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === "string") {
        resolved[key] = value.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_match, envName) => {
          return process.env[envName] ?? "";
        });
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        resolved[key] = this.resolveEnvTokens(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        resolved[key] = value.map((item) =>
          typeof item === "string"
            ? item.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_match, envName) => process.env[envName] ?? "")
            : item && typeof item === "object"
              ? this.resolveEnvTokens(item as Record<string, unknown>)
              : item,
        );
      }
    }

    return resolved as T;
  }

  // ── Status ──────────────────────────────────────────────────────────────

  /** Get a snapshot of all connector statuses. */
  getStatuses(): ConnectorStatus[] {
    const statuses: ConnectorStatus[] = [];
    for (const [name, connector] of this.connectors) {
      const s = this.stats.get(name);
      statuses.push({
        name,
        type: this.connectorTypes.get(name) ?? "unknown",
        state: connector.state,
        messagesReceived: s?.received ?? 0,
        messagesSent: s?.sent ?? 0,
        lastActivity: s?.lastActivity,
        error: s?.error,
      });
    }
    return statuses;
  }

  /** Broadcast connector status to dashboard. */
  private broadcastStatus(): void {
    this.bus.emit("connector:status", this.getStatuses());
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  /** Disconnect all connectors gracefully. */
  async disconnectAll(): Promise<void> {
    // Clear all typing timers
    for (const timer of this.typingTimers.values()) {
      clearInterval(timer);
    }
    this.typingTimers.clear();

    // Clear eviction interval
    if (this.evictionInterval) {
      clearInterval(this.evictionInterval);
      this.evictionInterval = null;
    }

    // Disconnect all connectors
    const disconnects = [...this.connectors.values()].map((c) =>
      c.disconnect("Shutdown").catch((err) =>
        console.error(`[Connector] Disconnect error: ${(err as Error).message}`),
      ),
    );
    await Promise.allSettled(disconnects);
    console.log("[Connector] All connectors disconnected");
  }

  /** Evict stale reply context entries. */
  private evictStaleContexts(): void {
    const cutoff = Date.now() - REPLY_CONTEXT_TTL_MS;
    for (const [id, ts] of this.replyContextTimestamps) {
      if (ts < cutoff) {
        this.replyContexts.delete(id);
        this.replyContextTimestamps.delete(id);
      }
    }
  }

  /** Get a connector instance by name (for CourierAgent bridge). */
  getConnector(name: string): BaseConnector | undefined {
    return this.connectors.get(name);
  }

  /** Get all connector names. */
  getConnectorNames(): string[] {
    return [...this.connectors.keys()];
  }
}
