import { EventEmitter } from "node:events";
import { TrustLevel, type TaskSource, trustGate } from "../core/trust.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Connection states for a connector lifecycle. */
export enum ConnectionState {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Connected = "connected",
  Reconnecting = "reconnecting",
  Error = "error",
}

/** A normalized message flowing through any connector. */
export interface ConnectorMessage {
  /** Unique message identifier. */
  id: string;
  /** The source connector name. */
  source: string;
  /** Channel, thread, or conversation identifier. */
  channel: string;
  /** The user or system that sent the message. */
  author: {
    id: string;
    name: string;
    isBot: boolean;
  };
  /** Message body text. */
  content: string;
  /** Optional structured metadata. */
  metadata?: Record<string, unknown>;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /**
   * Task source metadata for the trust system.
   * Automatically set to UNTRUSTED by the connector base class via emitMessage().
   */
  taskSource?: TaskSource;
}

/** Configuration shared across all connectors. */
export interface ConnectorConfig {
  /** Human-readable connector name. */
  name: string;
  /** Whether to automatically reconnect on disconnect. */
  autoReconnect?: boolean;
  /** Maximum number of reconnection attempts. */
  maxReconnectAttempts?: number;
  /** Base delay in ms between reconnect attempts (exponential backoff). */
  reconnectDelayMs?: number;
}

/** Events emitted by connectors. */
export interface ConnectorEvents {
  message: [message: ConnectorMessage];
  stateChange: [state: ConnectionState, previous: ConnectionState];
  error: [error: Error];
  connected: [];
  disconnected: [reason?: string];
}

// ── Abstract base class ──────────────────────────────────────────────────────

/**
 * BaseConnector provides the foundation for all platform integrations.
 *
 * Subclasses must implement `doConnect`, `doDisconnect`, and `doSend`.
 * The base class handles state management, reconnection logic, and
 * event emission so each connector can focus on platform specifics.
 */
export abstract class BaseConnector extends EventEmitter {
  public readonly name: string;
  private _state: ConnectionState = ConnectionState.Disconnected;
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly config: ConnectorConfig;

  constructor(config: ConnectorConfig) {
    super();
    this.config = {
      autoReconnect: true,
      maxReconnectAttempts: 10,
      reconnectDelayMs: 1000,
      ...config,
    };
    this.name = config.name;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Current connection state. */
  get state(): ConnectionState {
    return this._state;
  }

  /** Whether the connector is currently connected and operational. */
  get isConnected(): boolean {
    return this._state === ConnectionState.Connected;
  }

  /** Connect to the external platform. */
  async connect(): Promise<void> {
    if (this._state === ConnectionState.Connected) {
      return;
    }

    this.setState(ConnectionState.Connecting);
    this._reconnectAttempts = 0;

    try {
      await this.doConnect();
      this.setState(ConnectionState.Connected);
      this.emit("connected");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.setState(ConnectionState.Error);
      this.emit("error", error);

      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      } else {
        throw error;
      }
    }
  }

  /** Disconnect from the external platform. */
  async disconnect(reason?: string): Promise<void> {
    this.cancelReconnect();

    if (this._state === ConnectionState.Disconnected) {
      return;
    }

    try {
      await this.doDisconnect();
    } finally {
      this.setState(ConnectionState.Disconnected);
      this.emit("disconnected", reason);
    }
  }

  /** Send a message through the connector. */
  async send(channel: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.isConnected) {
      throw new Error(`Cannot send via "${this.name}": connector is ${this._state}`);
    }

    await this.doSend(channel, content, metadata);
  }

  /** Register a message handler (convenience wrapper around EventEmitter). */
  onMessage(handler: (message: ConnectorMessage) => void | Promise<void>): this {
    this.on("message", handler);
    return this;
  }

  // ── Abstract methods (implemented by subclasses) ──────────────────────────

  /** Platform-specific connection logic. */
  protected abstract doConnect(): Promise<void>;

  /** Platform-specific disconnection logic. */
  protected abstract doDisconnect(): Promise<void>;

  /** Platform-specific message sending. */
  protected abstract doSend(
    channel: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;

  // ── Protected helpers for subclasses ──────────────────────────────────────

  /**
   * Emit a normalized message event. Subclasses call this when they receive a message.
   *
   * Trust classification:
   * - If the sender's platform user ID is in `security.ownerIds` for this connector,
   *   the message gets OWNER trust (full agent capabilities).
   * - All other connector messages get UNTRUSTED trust (read-only, sandboxed).
   *
   * This means you can command HIVEMIND from Slack/Discord with full power,
   * while messages from anyone else are safely sandboxed.
   */
  protected emitMessage(message: ConnectorMessage): void {
    if (!message.taskSource) {
      const userId = message.author?.id;
      const isOwner = userId ? trustGate.isOwner(this.name, userId) : false;

      message.taskSource = {
        type: 'connector',
        connector: this.name,
        authenticated: isOwner,
        userId,
        // Let classifySource() handle the trust level resolution —
        // it checks ownerIds internally. We don't hardcode UNTRUSTED here
        // so the TrustGate remains the single source of truth.
      };
    }
    this.emit("message", message);
  }

  /** Generate a unique message ID. */
  protected generateMessageId(): string {
    return `${this.name}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /** Notify the base class that the connection was lost unexpectedly. */
  protected handleUnexpectedDisconnect(err?: Error): void {
    this.setState(ConnectionState.Error);
    if (err) {
      this.emit("error", err);
    }

    if (this.config.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  // ── Private internals ─────────────────────────────────────────────────────

  private setState(newState: ConnectionState): void {
    const previous = this._state;
    if (previous === newState) return;
    this._state = newState;
    this.emit("stateChange", newState, previous);
  }

  private scheduleReconnect(): void {
    const max = this.config.maxReconnectAttempts ?? 10;
    if (this._reconnectAttempts >= max) {
      this.emit(
        "error",
        new Error(`Max reconnect attempts (${max}) reached for "${this.name}"`),
      );
      this.setState(ConnectionState.Disconnected);
      return;
    }

    const baseDelay = this.config.reconnectDelayMs ?? 1000;
    const delay = baseDelay * Math.pow(2, this._reconnectAttempts);
    const jitter = delay * 0.2 * Math.random();

    this.setState(ConnectionState.Reconnecting);
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(async () => {
      try {
        await this.doConnect();
        this._reconnectAttempts = 0;
        this.setState(ConnectionState.Connected);
        this.emit("connected");
      } catch {
        this.scheduleReconnect();
      }
    }, delay + jitter);
  }

  private cancelReconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}
