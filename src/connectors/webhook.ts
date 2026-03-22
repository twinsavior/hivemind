import * as http from "node:http";
import * as crypto from "node:crypto";
import {
  BaseConnector,
  type ConnectorConfig,
  type ConnectorMessage,
} from "./base.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WebhookConnectorConfig extends ConnectorConfig {
  /** Port to listen on for incoming webhooks. */
  inbound?: {
    port: number;
    /** Path to listen on (default: /webhook). */
    path?: string;
    /** Shared secret for HMAC signature verification. */
    secret?: string;
    /** IP allowlist (CIDR or exact). Empty = allow all. */
    allowedIps?: string[];
  };
  /** Outbound webhook configuration. */
  outbound?: {
    /** URL to POST messages to. */
    url: string;
    /** Additional headers to include. */
    headers?: Record<string, string>;
    /** Shared secret for signing outbound payloads. */
    secret?: string;
    /** Retry count on failure. */
    retries?: number;
    /** Timeout in milliseconds. */
    timeoutMs?: number;
  };
}

/** Inbound webhook payload (generic). */
export interface WebhookPayload {
  /** Optional event type for routing. */
  event?: string;
  /** Channel or topic identifier. */
  channel?: string;
  /** Message content. */
  content: string;
  /** Sender information. */
  author?: {
    id?: string;
    name?: string;
  };
  /** Arbitrary extra data. */
  metadata?: Record<string, unknown>;
}

// ── Webhook connector ────────────────────────────────────────────────────────

/**
 * Generic webhook connector supporting both inbound and outbound webhooks.
 *
 * - Inbound: spins up an HTTP server to receive webhook POSTs
 * - Outbound: POSTs messages to a configured URL with optional HMAC signing
 *
 * This connector is ideal for integrating with CI/CD, monitoring tools,
 * custom APIs, or any service that supports webhooks.
 */
export class WebhookConnector extends BaseConnector {
  private readonly inboundConfig?: WebhookConnectorConfig["inbound"];
  private readonly outboundConfig?: WebhookConnectorConfig["outbound"];
  private server: http.Server | null = null;

  constructor(config: WebhookConnectorConfig) {
    super(config);
    this.inboundConfig = config.inbound;
    this.outboundConfig = config.outbound;

    if (!this.inboundConfig && !this.outboundConfig) {
      throw new Error("WebhookConnector requires at least one of 'inbound' or 'outbound' config");
    }
  }

  // ── Connection lifecycle ────────────────────────────────────────────────

  protected async doConnect(): Promise<void> {
    if (this.inboundConfig) {
      await this.startServer();
    }

    // Outbound doesn't need a persistent connection;
    // validate the URL is reachable with a HEAD request.
    if (this.outboundConfig) {
      try {
        await fetch(this.outboundConfig.url, {
          method: "HEAD",
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Non-fatal: the endpoint might not support HEAD
      }
    }
  }

  protected async doDisconnect(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }
  }

  protected async doSend(
    channel: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.outboundConfig) {
      throw new Error("No outbound webhook configured");
    }

    const payload: WebhookPayload = {
      channel,
      content,
      metadata,
    };

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "HIVEMIND/1.0",
      ...this.outboundConfig.headers,
    };

    // Sign the payload if a secret is configured
    if (this.outboundConfig.secret) {
      const signature = crypto
        .createHmac("sha256", this.outboundConfig.secret)
        .update(body)
        .digest("hex");
      headers["X-Hivemind-Signature"] = `sha256=${signature}`;
    }

    const maxAttempts = (this.outboundConfig.retries ?? 3) + 1;
    const timeoutMs = this.outboundConfig.timeoutMs ?? 10000;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(this.outboundConfig.url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.ok) return;

        if (response.status >= 500 && attempt < maxAttempts) {
          // Retry on server errors with exponential backoff
          await this.delay(1000 * Math.pow(2, attempt - 1));
          continue;
        }

        throw new Error(`Webhook POST failed: ${response.status} ${response.statusText}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts) {
          await this.delay(1000 * Math.pow(2, attempt - 1));
        }
      }
    }

    throw lastError ?? new Error("Webhook send failed after retries");
  }

  // ── Inbound server ─────────────────────────────────────────────────────

  private startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const config = this.inboundConfig!;
      const listenPath = config.path ?? "/webhook";

      this.server = http.createServer(async (req, res) => {
        // Health check endpoint
        if (req.method === "GET" && req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", connector: this.name }));
          return;
        }

        // Only accept POST to the configured path
        if (req.method !== "POST" || !req.url?.startsWith(listenPath)) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }

        // IP allowlist check
        if (config.allowedIps?.length) {
          const clientIp = req.socket.remoteAddress ?? "";
          if (!config.allowedIps.some((ip) => clientIp === ip || clientIp === '::ffff:' + ip)) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
          }
        }

        try {
          const rawBody = await this.readRequestBody(req);

          // Verify HMAC signature if secret is configured
          if (config.secret) {
            const signature = req.headers["x-hivemind-signature"] as string | undefined;
            if (!this.verifySignature(rawBody, signature, config.secret)) {
              res.writeHead(401);
              res.end("Invalid signature");
              return;
            }
          }

          const payload = JSON.parse(rawBody) as WebhookPayload;
          this.handleInboundPayload(payload);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ received: true }));
        } catch (err) {
          res.writeHead(400);
          res.end("Bad Request");
        }
      });

      this.server.on("error", reject);
      this.server.listen(config.port, () => resolve());
    });
  }

  private handleInboundPayload(payload: WebhookPayload): void {
    const message: ConnectorMessage = {
      id: this.generateMessageId(),
      source: this.name,
      channel: payload.channel ?? "default",
      author: {
        id: payload.author?.id ?? "webhook",
        name: payload.author?.name ?? "Webhook",
        isBot: true,
      },
      content: payload.content,
      metadata: {
        event: payload.event,
        ...payload.metadata,
      },
      timestamp: new Date().toISOString(),
    };

    this.emitMessage(message);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  private verifySignature(body: string, signature: string | undefined, secret: string): boolean {
    if (!signature) return false;

    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const provided = signature.replace("sha256=", "");

    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(provided, "hex"),
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
