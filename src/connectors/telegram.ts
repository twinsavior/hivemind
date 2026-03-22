import {
  BaseConnector,
  type ConnectorConfig,
  type ConnectorMessage,
} from "./base.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TelegramConnectorConfig extends ConnectorConfig {
  /** Telegram Bot API token from @BotFather. */
  token: string;
  /** Allowed chat IDs. Empty = accept all chats. */
  allowedChatIds?: number[];
  /** Polling interval in milliseconds. */
  pollingIntervalMs?: number;
  /** Use webhooks instead of long polling. */
  webhook?: {
    url: string;
    port: number;
    secretToken?: string;
  };
}

/** Telegram User object (partial). */
interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

/** Telegram Chat object (partial). */
interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

/** Telegram Message object (partial). */
interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

/** Telegram Update object. */
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

// ── Telegram connector ───────────────────────────────────────────────────────

/**
 * Telegram Bot API connector.
 *
 * Supports long polling and webhook modes. Handles message receiving,
 * sending, and basic bot commands.
 */
export class TelegramConnector extends BaseConnector {
  private readonly token: string;
  private readonly allowedChatIds: number[];
  private readonly pollingIntervalMs: number;
  private readonly webhookConfig?: TelegramConnectorConfig["webhook"];

  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUpdateId = 0;
  private isPolling = false;

  private static readonly API_BASE = "https://api.telegram.org";

  constructor(config: TelegramConnectorConfig) {
    super(config);
    this.token = config.token;
    this.allowedChatIds = config.allowedChatIds ?? [];
    this.pollingIntervalMs = config.pollingIntervalMs ?? 1000;
    this.webhookConfig = config.webhook;
  }

  // ── Connection lifecycle ────────────────────────────────────────────────

  protected async doConnect(): Promise<void> {
    // Verify the bot token
    const me = await this.apiCall("getMe");
    if (!me.ok) {
      throw new Error(`Telegram auth failed: ${me.description}`);
    }

    if (this.webhookConfig) {
      // Set up webhook
      const result = await this.apiCall("setWebhook", {
        url: this.webhookConfig.url,
        secret_token: this.webhookConfig.secretToken,
      });
      if (!result.ok) {
        throw new Error(`Failed to set webhook: ${result.description}`);
      }
    } else {
      // Delete any existing webhook before polling
      await this.apiCall("deleteWebhook");
      // Start long polling
      this.isPolling = true;
      this.poll();
    }
  }

  protected async doDisconnect(): Promise<void> {
    this.isPolling = false;

    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }

    if (this.webhookConfig) {
      await this.apiCall("deleteWebhook");
    }
  }

  protected async doSend(
    channel: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      chat_id: channel,
      text: content,
      parse_mode: (metadata?.["parseMode"] as string) ?? "HTML",
    };

    if (metadata?.["replyToMessageId"]) {
      body["reply_to_message_id"] = metadata["replyToMessageId"];
    }

    if (metadata?.["replyMarkup"]) {
      body["reply_markup"] = metadata["replyMarkup"];
    }

    const result = await this.apiCall("sendMessage", body);
    if (!result.ok) {
      throw new Error(`Failed to send Telegram message: ${result.description}`);
    }
  }

  // ── Public Telegram-specific methods ────────────────────────────────────

  /** Send a photo to a chat. */
  async sendPhoto(chatId: string | number, photoUrl: string, caption?: string): Promise<void> {
    await this.apiCall("sendPhoto", {
      chat_id: chatId,
      photo: photoUrl,
      caption,
    });
  }

  /** Send a document/file to a chat. */
  async sendDocument(chatId: string | number, documentUrl: string, caption?: string): Promise<void> {
    await this.apiCall("sendDocument", {
      chat_id: chatId,
      document: documentUrl,
      caption,
    });
  }

  /** Set bot commands visible in the Telegram menu. */
  async setCommands(
    commands: Array<{ command: string; description: string }>,
  ): Promise<void> {
    await this.apiCall("setMyCommands", { commands });
  }

  /** Process an incoming webhook update (call this from your HTTP handler). */
  processWebhookUpdate(update: TelegramUpdate): void {
    this.handleUpdate(update);
  }

  // ── Polling ─────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.isPolling) return;

    try {
      const result = await this.apiCall("getUpdates", {
        offset: this.lastUpdateId + 1,
        timeout: 30,
        allowed_updates: ["message", "edited_message", "channel_post"],
      });

      if (result.ok && Array.isArray(result.result)) {
        for (const update of result.result as TelegramUpdate[]) {
          this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
          this.handleUpdate(update);
        }
      }
    } catch (err) {
      this.handleUnexpectedDisconnect(
        err instanceof Error ? err : new Error(String(err)),
      );
      return;
    }

    if (this.isPolling) {
      this.pollingTimer = setTimeout(() => this.poll(), this.pollingIntervalMs);
    }
  }

  // ── Update handling ─────────────────────────────────────────────────────

  private handleUpdate(update: TelegramUpdate): void {
    const msg = update.message ?? update.edited_message ?? update.channel_post;
    if (!msg || !msg.text) return;

    // Filter by allowed chat IDs
    if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(msg.chat.id)) {
      return;
    }

    const normalized: ConnectorMessage = {
      id: this.generateMessageId(),
      source: this.name,
      channel: String(msg.chat.id),
      author: {
        id: String(msg.from?.id ?? msg.chat.id),
        name: msg.from
          ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ")
          : msg.chat.title ?? "Unknown",
        isBot: msg.from?.is_bot ?? false,
      },
      content: msg.text,
      metadata: {
        messageId: msg.message_id,
        chatType: msg.chat.type,
        chatTitle: msg.chat.title,
        replyToMessageId: msg.reply_to_message?.message_id,
        username: msg.from?.username,
      },
      timestamp: new Date(msg.date * 1000).toISOString(),
    };

    this.emitMessage(normalized);
  }

  // ── API helpers ─────────────────────────────────────────────────────────

  private async apiCall(
    method: string,
    body?: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: unknown; description?: string }> {
    const url = `${TelegramConnector.API_BASE}/bot${this.token}/${method}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Telegram API HTTP error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as { ok: boolean; result?: unknown; description?: string };
  }
}
