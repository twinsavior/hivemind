// ── Connector exports ─────────────────────────────────────────────────────────

export {
  BaseConnector,
  ConnectionState,
  type ConnectorMessage,
  type ConnectorConfig,
  type ConnectorEvents,
} from "./base.js";

export { SlackConnector, type SlackConnectorConfig } from "./slack.js";
export { DiscordConnector, type DiscordConnectorConfig } from "./discord.js";
export { TelegramConnector, type TelegramConnectorConfig } from "./telegram.js";
export {
  WebhookConnector,
  type WebhookConnectorConfig,
  type WebhookPayload,
} from "./webhook.js";

// ── Connector factory ─────────────────────────────────────────────────────────

import { BaseConnector, type ConnectorConfig } from "./base.js";
import { SlackConnector, type SlackConnectorConfig } from "./slack.js";
import { DiscordConnector, type DiscordConnectorConfig } from "./discord.js";
import { TelegramConnector, type TelegramConnectorConfig } from "./telegram.js";
import { WebhookConnector, type WebhookConnectorConfig } from "./webhook.js";

/** Supported connector type identifiers. */
export type ConnectorType = "slack" | "discord" | "telegram" | "webhook";

/** Union of all connector-specific configurations. */
export type AnyConnectorConfig =
  | ({ type: "slack" } & SlackConnectorConfig)
  | ({ type: "discord" } & DiscordConnectorConfig)
  | ({ type: "telegram" } & TelegramConnectorConfig)
  | ({ type: "webhook" } & WebhookConnectorConfig);

/**
 * Create a connector instance from a type-tagged configuration object.
 *
 * @example
 * ```ts
 * const slack = createConnector({
 *   type: "slack",
 *   name: "team-slack",
 *   token: process.env.SLACK_TOKEN!,
 * });
 * await slack.connect();
 * ```
 */
export function createConnector(config: AnyConnectorConfig): BaseConnector {
  switch (config.type) {
    case "slack":
      return new SlackConnector(config);
    case "discord":
      return new DiscordConnector(config);
    case "telegram":
      return new TelegramConnector(config);
    case "webhook":
      return new WebhookConnector(config);
    default:
      throw new Error(`Unknown connector type: ${(config as { type: string }).type}`);
  }
}
