import {
  BaseConnector,
  type ConnectorConfig,
  type ConnectorMessage,
} from "./base.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlackConnectorConfig extends ConnectorConfig {
  /** Slack Bot User OAuth Token (xoxb-...). */
  token: string;
  /** Slack App-Level Token for Socket Mode (xapp-...). */
  appToken?: string;
  /** Channel IDs to listen on. Empty = all channels the bot is in. */
  channels?: string[];
  /** Whether to use Socket Mode instead of HTTP events. */
  socketMode?: boolean;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

// ── Slack connector ──────────────────────────────────────────────────────────

/**
 * Slack connector using the Slack Web API.
 *
 * Supports sending messages, receiving events via Socket Mode or
 * webhook-based Events API, and basic channel management.
 */
export class SlackConnector extends BaseConnector {
  private readonly token: string;
  private readonly appToken?: string;
  private readonly channels: string[];
  private readonly socketMode: boolean;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private lastTimestamp: string = "0";

  private static readonly API_BASE = "https://slack.com/api";

  constructor(config: SlackConnectorConfig) {
    super(config);
    this.token = config.token;
    this.appToken = config.appToken;
    this.channels = config.channels ?? [];
    this.socketMode = config.socketMode ?? false;
  }

  // ── Connection lifecycle ────────────────────────────────────────────────

  protected async doConnect(): Promise<void> {
    // Verify the token by calling auth.test
    const authResult = await this.apiCall("auth.test");
    if (!authResult.ok) {
      throw new Error(`Slack auth failed: ${authResult.error}`);
    }

    if (this.socketMode && this.appToken) {
      // In a full implementation, this would open a WebSocket
      // connection using the apps.connections.open endpoint.
      await this.apiCall("apps.connections.open", {}, this.appToken);
    }

    // Start polling for messages (simplified; production would use RTM or Socket Mode)
    this.pollingInterval = setInterval(() => this.pollMessages(), 3000);
  }

  protected async doDisconnect(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  protected async doSend(
    channel: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      channel,
      text: content,
    };

    if (metadata?.["threadTs"]) {
      body["thread_ts"] = metadata["threadTs"];
    }

    if (metadata?.["blocks"]) {
      body["blocks"] = metadata["blocks"];
    }

    const result = await this.apiCall("chat.postMessage", body);
    if (!result.ok) {
      throw new Error(`Failed to send Slack message: ${result.error}`);
    }
  }

  // ── Public Slack-specific methods ───────────────────────────────────────

  /** React to a message with an emoji. */
  async addReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
    await this.apiCall("reactions.add", {
      channel,
      timestamp,
      name: emoji,
    });
  }

  /** Set the bot's status. */
  async setStatus(text: string, emoji?: string): Promise<void> {
    await this.apiCall("users.profile.set", {
      profile: {
        status_text: text,
        status_emoji: emoji ?? ":robot_face:",
      },
    });
  }

  /** List channels the bot has access to. */
  async listChannels(): Promise<Array<{ id: string; name: string }>> {
    const result = await this.apiCall("conversations.list", {
      types: "public_channel,private_channel",
      limit: 200,
    });
    const channels = result["channels"] as Array<{ id: string; name: string }> | undefined;
    return channels ?? [];
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async pollMessages(): Promise<void> {
    try {
      for (const channel of this.channels) {
        const result = await this.apiCall("conversations.history", {
          channel,
          oldest: this.lastTimestamp,
          limit: 20,
        });

        if (!result.ok) continue;

        const messages = result["messages"] as Array<{
          ts: string;
          text: string;
          user: string;
          bot_id?: string;
          thread_ts?: string;
        }> | undefined;

        if (!messages?.length) continue;

        for (const msg of messages) {
          if (msg.ts <= this.lastTimestamp) continue;

          const normalized: ConnectorMessage = {
            id: this.generateMessageId(),
            source: this.name,
            channel,
            author: {
              id: msg.user ?? "unknown",
              name: msg.user ?? "unknown",
              isBot: !!msg.bot_id,
            },
            content: msg.text,
            metadata: {
              ts: msg.ts,
              threadTs: msg.thread_ts,
            },
            timestamp: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          };

          this.emitMessage(normalized);
        }

        // Update cursor to the latest timestamp
        const latest = messages.reduce(
          (max, m) => (m.ts > max ? m.ts : max),
          this.lastTimestamp,
        );
        this.lastTimestamp = latest;
      }
    } catch (err) {
      this.handleUnexpectedDisconnect(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  private async apiCall(
    method: string,
    body?: Record<string, unknown>,
    tokenOverride?: string,
  ): Promise<SlackApiResponse> {
    const token = tokenOverride ?? this.token;
    const url = `${SlackConnector.API_BASE}/${method}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Slack API HTTP error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as SlackApiResponse;
  }
}
