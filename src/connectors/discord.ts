import { EventEmitter } from "node:events";
import {
  BaseConnector,
  type ConnectorConfig,
  type ConnectorMessage,
} from "./base.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiscordConnectorConfig extends ConnectorConfig {
  /** Discord bot token. */
  token: string;
  /** Guild (server) IDs to listen on. Empty = all guilds. */
  guildIds?: string[];
  /** Channel IDs to listen on. Empty = all channels. */
  channelIds?: string[];
  /** Gateway intents (bitfield). Defaults to messages + guild members. */
  intents?: number;
}

/** Minimal Discord gateway payload. */
interface GatewayPayload {
  op: number;
  d: unknown;
  s?: number;
  t?: string;
}

/** Discord message object (partial). */
interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  content: string;
  timestamp: string;
  referenced_message?: DiscordMessage;
}

// ── Discord connector ────────────────────────────────────────────────────────

/**
 * Discord connector using the Discord Gateway (WebSocket) and REST API.
 *
 * Implements the Discord Gateway protocol including heartbeating,
 * identification, and resume on reconnect.
 */
export class DiscordConnector extends BaseConnector {
  private readonly token: string;
  private readonly guildIds: string[];
  private readonly channelIds: string[];
  private readonly intents: number;

  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;

  private static readonly GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
  private static readonly API_BASE = "https://discord.com/api/v10";

  /** Default intents: GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT */
  private static readonly DEFAULT_INTENTS = (1 << 0) | (1 << 9) | (1 << 15);

  constructor(config: DiscordConnectorConfig) {
    super(config);
    this.token = config.token;
    this.guildIds = config.guildIds ?? [];
    this.channelIds = config.channelIds ?? [];
    this.intents = config.intents ?? DiscordConnector.DEFAULT_INTENTS;
  }

  // ── Connection lifecycle ────────────────────────────────────────────────

  protected async doConnect(): Promise<void> {
    const url = this.resumeGatewayUrl ?? DiscordConnector.GATEWAY_URL;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.addEventListener("open", () => {
        // Connection opened, wait for HELLO
      });

      this.ws.addEventListener("message", (event) => {
        const payload: GatewayPayload = JSON.parse(String(event.data));
        this.handleGatewayMessage(payload, resolve);
      });

      this.ws.addEventListener("close", (event) => {
        this.stopHeartbeat();
        const resumable = event.code !== 4004 && event.code !== 4014;
        if (resumable) {
          this.handleUnexpectedDisconnect(
            new Error(`Discord gateway closed: ${event.code} ${event.reason}`),
          );
        }
      });

      this.ws.addEventListener("error", (event) => {
        reject(new Error("Discord gateway connection error"));
      });
    });
  }

  protected async doDisconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, "Normal closure");
      this.ws = null;
    }
    this.sessionId = null;
    this.resumeGatewayUrl = null;
  }

  protected async doSend(
    channel: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const body: Record<string, unknown> = { content };

    if (metadata?.["replyTo"]) {
      body["message_reference"] = { message_id: metadata["replyTo"] };
    }

    if (metadata?.["embeds"]) {
      body["embeds"] = metadata["embeds"];
    }

    const response = await fetch(
      `${DiscordConnector.API_BASE}/channels/${channel}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error: ${response.status} - ${error}`);
    }
  }

  // ── Public Discord-specific methods ─────────────────────────────────────

  /** Add a reaction to a message. */
  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const encoded = encodeURIComponent(emoji);
    await fetch(
      `${DiscordConnector.API_BASE}/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`,
      {
        method: "PUT",
        headers: { Authorization: `Bot ${this.token}` },
      },
    );
  }

  /** Update the bot's presence/status. */
  async setPresence(status: string, activityType: number = 0): Promise<void> {
    this.sendGateway({
      op: 3,
      d: {
        status: "online",
        activities: [{ name: status, type: activityType }],
        afk: false,
        since: null,
      },
    });
  }

  // ── Gateway protocol ────────────────────────────────────────────────────

  private handleGatewayMessage(payload: GatewayPayload, onReady?: (value: void) => void): void {
    if (payload.s !== undefined && payload.s !== null) {
      this.lastSequence = payload.s;
    }

    switch (payload.op) {
      case 10: {
        // HELLO - start heartbeating and identify
        const data = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(data.heartbeat_interval);

        if (this.sessionId && this.lastSequence !== null) {
          // Resume existing session
          this.sendGateway({
            op: 6,
            d: {
              token: this.token,
              session_id: this.sessionId,
              seq: this.lastSequence,
            },
          });
        } else {
          // Identify as a new session
          this.sendGateway({
            op: 2,
            d: {
              token: this.token,
              intents: this.intents,
              properties: {
                os: "linux",
                browser: "hivemind",
                device: "hivemind",
              },
            },
          });
        }
        break;
      }

      case 11:
        // HEARTBEAT_ACK - connection is healthy
        break;

      case 0:
        // DISPATCH - handle events
        this.handleDispatch(payload.t ?? "", payload.d);
        if (payload.t === "READY") {
          const data = payload.d as { session_id: string; resume_gateway_url: string };
          this.sessionId = data.session_id;
          this.resumeGatewayUrl = data.resume_gateway_url;
          onReady?.();
        }
        break;

      case 7:
        // RECONNECT
        this.handleUnexpectedDisconnect(new Error("Server requested reconnect"));
        break;

      case 9:
        // INVALID_SESSION
        this.sessionId = null;
        this.lastSequence = null;
        this.handleUnexpectedDisconnect(new Error("Invalid session"));
        break;
    }
  }

  private handleDispatch(event: string, data: unknown): void {
    if (event !== "MESSAGE_CREATE") return;

    const msg = data as DiscordMessage;

    // Filter by guild/channel if configured
    if (this.guildIds.length > 0 && msg.guild_id && !this.guildIds.includes(msg.guild_id)) {
      return;
    }
    if (this.channelIds.length > 0 && !this.channelIds.includes(msg.channel_id)) {
      return;
    }

    const normalized: ConnectorMessage = {
      id: this.generateMessageId(),
      source: this.name,
      channel: msg.channel_id,
      author: {
        id: msg.author.id,
        name: msg.author.username,
        isBot: msg.author.bot ?? false,
      },
      content: msg.content,
      metadata: {
        guildId: msg.guild_id,
        discordMessageId: msg.id,
      },
      timestamp: msg.timestamp,
    };

    this.emitMessage(normalized);
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendGateway({ op: 1, d: this.lastSequence });
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private sendGateway(payload: GatewayPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}
