/**
 * HIVEMIND Structured Observability (#10)
 *
 * Lightweight tracing layer for the agent cognitive loop.
 * Each think → act → observe cycle becomes a span with timing,
 * tool calls, and metadata. Works with or without OpenTelemetry.
 *
 * If @opentelemetry/api is installed, spans are exported to your
 * configured collector. Otherwise, spans are emitted as events
 * on the global bus for the dashboard to consume.
 */

import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Span model
// ---------------------------------------------------------------------------

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  agentId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: "ok" | "error" | "running";
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

let otelTracer: any = null;

/** Try to load OpenTelemetry. Non-fatal if not installed. */
async function tryLoadOtel(): Promise<void> {
  try {
    // @ts-expect-error — optional dependency, only loaded if installed
    const api = await import("@opentelemetry/api");
    otelTracer = api.trace.getTracer("hivemind", "1.0.0");
  } catch {
    // OpenTelemetry not installed — use local tracing only
  }
}

// Auto-attempt OTel load
tryLoadOtel();

const traceBus = new EventEmitter();
const activeSpans = new Map<string, Span>();

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Start a new trace span. */
export function startSpan(
  name: string,
  agentId: string,
  parentSpanId?: string,
  attributes?: Record<string, string | number | boolean>,
): Span {
  const span: Span = {
    traceId: parentSpanId ? (activeSpans.get(parentSpanId)?.traceId ?? generateId()) : generateId(),
    spanId: generateId(),
    parentSpanId,
    name,
    agentId,
    startTime: Date.now(),
    status: "running",
    attributes: attributes ?? {},
    events: [],
  };

  activeSpans.set(span.spanId, span);
  traceBus.emit("span:start", span);

  // If OTel is available, create a real span
  if (otelTracer) {
    try {
      const otelSpan = otelTracer.startSpan(name, {
        attributes: { "agent.id": agentId, ...attributes },
      });
      (span as any)._otelSpan = otelSpan;
    } catch {
      // Swallow OTel errors
    }
  }

  return span;
}

/** Add an event to an active span. */
export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void {
  const event: SpanEvent = { name, timestamp: Date.now(), attributes };
  span.events.push(event);

  if ((span as any)._otelSpan) {
    try {
      (span as any)._otelSpan.addEvent(name, attributes);
    } catch {
      // Swallow
    }
  }
}

/** End a span with success or error status. */
export function endSpan(span: Span, status: "ok" | "error" = "ok"): void {
  span.endTime = Date.now();
  span.durationMs = span.endTime - span.startTime;
  span.status = status;

  activeSpans.delete(span.spanId);
  traceBus.emit("span:end", span);

  if ((span as any)._otelSpan) {
    try {
      if (status === "error") {
        (span as any)._otelSpan.setStatus({ code: 2 }); // SpanStatusCode.ERROR
      }
      (span as any)._otelSpan.end();
    } catch {
      // Swallow
    }
  }
}

/** Get all currently active spans. */
export function getActiveSpans(): Span[] {
  return [...activeSpans.values()];
}

/** Subscribe to tracing events. */
export function onTrace(
  event: "span:start" | "span:end",
  handler: (span: Span) => void,
): void {
  traceBus.on(event, handler);
}

/** Unsubscribe from tracing events. */
export function offTrace(
  event: "span:start" | "span:end",
  handler: (span: Span) => void,
): void {
  traceBus.off(event, handler);
}

/**
 * Convenience: trace an async function as a span.
 *
 * Usage:
 *   const result = await traced("agent.think", "scout-1", async (span) => {
 *     addSpanEvent(span, "planning", { steps: 3 });
 *     return await agent.think(input);
 *   });
 */
export async function traced<T>(
  name: string,
  agentId: string,
  fn: (span: Span) => Promise<T>,
  parentSpanId?: string,
): Promise<T> {
  const span = startSpan(name, agentId, parentSpanId);
  try {
    const result = await fn(span);
    endSpan(span, "ok");
    return result;
  } catch (err) {
    span.attributes["error.message"] = (err as Error).message;
    endSpan(span, "error");
    throw err;
  }
}
