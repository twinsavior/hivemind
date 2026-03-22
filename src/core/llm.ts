// ── Types ─────────────────────────────────────────────────────────────────────

/** Role for a message in a conversation. */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** A single content part in a multi-modal message. */
export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
}

/** A single message in a conversation. Supports text-only or multi-modal content. */
export interface LLMMessage {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  toolCallId?: string;
}

/** Extract the text content from an LLMMessage, whether string or ContentPart[]. */
export function getMessageText(message: LLMMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n");
}

/** Tool/function definition for function calling. */
export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool call returned by the model. */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Options for a completion request. */
export interface CompletionOptions {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  tools?: LLMTool[];
  responseFormat?: "text" | "json";
  /** Unique request identifier for logging/tracing. */
  requestId?: string;
}

/** A completion response from an LLM provider. */
export interface CompletionResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  /** Provider-specific response metadata. */
  raw?: unknown;
}

/** A chunk from a streaming completion. */
export interface StreamChunk {
  content: string;
  toolCalls?: LLMToolCall[];
  finishReason?: CompletionResponse["finishReason"];
}

/** Embedding response. */
export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

/** Rate limiter state. */
interface RateLimitState {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per second
}

// ── Provider interface ────────────────────────────────────────────────────────

/**
 * Interface that all LLM providers must implement.
 */
export interface LLMProvider {
  readonly name: string;
  readonly supportedModels: string[];

  /** Generate a completion. */
  complete(options: CompletionOptions): Promise<CompletionResponse>;

  /** Stream a completion. */
  stream(options: CompletionOptions): AsyncGenerator<StreamChunk>;

  /** Generate embeddings for a list of texts. */
  embed(texts: string[], model?: string): Promise<EmbeddingResponse>;

  /** Check if the provider is properly configured and reachable. */
  healthCheck(): Promise<boolean>;
}

// ── Provider configuration ────────────────────────────────────────────────────

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Requests per minute limit. */
  rpmLimit?: number;
  /** Tokens per minute limit. */
  tpmLimit?: number;
  /** Organization ID (OpenAI). */
  organization?: string;
}

// ── OpenAI provider ───────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly supportedModels = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
    "o1",
    "o1-mini",
    "o1-pro",
    "o3-mini",
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
  ];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly organization?: string;
  private rateLimit: RateLimitState;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    this.defaultModel = config.defaultModel ?? "gpt-4o";
    this.maxRetries = config.maxRetries ?? 3;
    this.timeoutMs = config.timeoutMs ?? 60000;
    this.organization = config.organization;
    this.rateLimit = {
      tokens: config.rpmLimit ?? 60,
      lastRefill: Date.now(),
      maxTokens: config.rpmLimit ?? 60,
      refillRate: (config.rpmLimit ?? 60) / 60,
    };
  }

  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    await this.waitForRateLimit();

    const body = this.buildRequestBody(options);
    const data = await this.request("/chat/completions", body);

    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      toolCalls: choice?.message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
      finishReason: this.mapFinishReason(choice?.finish_reason),
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      model: data.model ?? options.model ?? this.defaultModel,
      raw: data,
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    await this.waitForRateLimit();

    const body = { ...this.buildRequestBody(options), stream: true };
    const response = await this.rawRequest("/chat/completions", body);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body for streaming");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            yield { content: delta.content };
          }
          if (parsed.choices?.[0]?.finish_reason) {
            yield {
              content: "",
              finishReason: this.mapFinishReason(parsed.choices[0].finish_reason),
            };
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }

  async embed(texts: string[], model?: string): Promise<EmbeddingResponse> {
    const data = await this.request("/embeddings", {
      input: texts,
      model: model ?? "text-embedding-3-small",
    });

    return {
      embeddings: data.data.map((d: any) => d.embedding),
      model: data.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request("/models", undefined, "GET");
      return true;
    } catch {
      return false;
    }
  }

  private buildRequestBody(options: CompletionOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model ?? this.defaultModel,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
    };

    if (options.temperature !== undefined) body["temperature"] = options.temperature;
    if (options.maxTokens !== undefined) body["max_tokens"] = options.maxTokens;
    if (options.topP !== undefined) body["top_p"] = options.topP;
    if (options.stop) body["stop"] = options.stop;
    if (options.responseFormat === "json") {
      body["response_format"] = { type: "json_object" };
    }

    if (options.tools?.length) {
      body["tools"] = options.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    return body;
  }

  private mapFinishReason(reason: string): CompletionResponse["finishReason"] {
    const map: Record<string, CompletionResponse["finishReason"]> = {
      stop: "stop",
      length: "length",
      tool_calls: "tool_calls",
      content_filter: "content_filter",
    };
    return map[reason] ?? "stop";
  }

  private async request(path: string, body?: unknown, method = "POST"): Promise<any> {
    const response = await this.rawRequest(path, body, method);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }
    return response.json();
  }

  private async rawRequest(path: string, body?: unknown, method = "POST"): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (this.organization) {
      headers["OpenAI-Organization"] = this.organization;
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.status === 429 || response.status >= 500) {
          if (attempt < this.maxRetries) {
            const retryAfter = response.headers.get("retry-after");
            const delay = retryAfter ? parseInt(retryAfter) * 1000 : 1000 * Math.pow(2, attempt);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }

        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.rateLimit.lastRefill) / 1000;
    this.rateLimit.tokens = Math.min(
      this.rateLimit.maxTokens,
      this.rateLimit.tokens + elapsed * this.rateLimit.refillRate,
    );
    this.rateLimit.lastRefill = now;

    if (this.rateLimit.tokens < 1) {
      const waitMs = ((1 - this.rateLimit.tokens) / this.rateLimit.refillRate) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      this.rateLimit.tokens = 0;
    }

    this.rateLimit.tokens -= 1;
  }
}

// ── Anthropic provider ────────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly supportedModels = [
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-3-5-haiku-20241022",
    "claude-3-5-sonnet-20241022",
    "claude-3-opus-20240229",
  ];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    this.baseUrl = config.baseUrl ?? "https://api.anthropic.com/v1";
    this.defaultModel = config.defaultModel ?? "claude-sonnet-4-20250514";
    this.maxRetries = config.maxRetries ?? 3;
    this.timeoutMs = config.timeoutMs ?? 120000;
  }

  /**
   * Convert an LLMMessage's content to Anthropic's content block format.
   * Translates ContentPart[] (OpenAI-style) to Anthropic content blocks.
   */
  private toAnthropicContent(content: string | ContentPart[]): string | Array<Record<string, unknown>> {
    if (typeof content === "string") return content;

    return content.map((part) => {
      if (part.type === "text") {
        return { type: "text", text: part.text ?? "" };
      }
      if (part.type === "image_url" && part.image_url) {
        const url = part.image_url.url;
        // Handle data URIs: data:image/png;base64,<data>
        const dataUriMatch = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (dataUriMatch) {
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: dataUriMatch[1],
              data: dataUriMatch[2],
            },
          };
        }
        // Handle raw URLs — Anthropic also supports URL sources
        return {
          type: "image",
          source: {
            type: "url",
            url,
          },
        };
      }
      return { type: "text", text: "" };
    });
  }

  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    const systemMsg = options.messages.find((m) => m.role === "system");
    const nonSystemMessages = options.messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: options.model ?? this.defaultModel,
      max_tokens: options.maxTokens ?? 4096,
      messages: nonSystemMessages.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: this.toAnthropicContent(m.content),
      })),
    };

    if (systemMsg) body["system"] = getMessageText(systemMsg);
    if (options.temperature !== undefined) body["temperature"] = options.temperature;
    if (options.topP !== undefined) body["top_p"] = options.topP;
    if (options.stop) body["stop_sequences"] = options.stop;

    if (options.tools?.length) {
      body["tools"] = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const data = await this.request("/messages", body);

    const textBlock = data.content?.find((b: any) => b.type === "text");
    const toolUseBlocks = data.content?.filter((b: any) => b.type === "tool_use") ?? [];

    return {
      content: textBlock?.text ?? "",
      toolCalls: toolUseBlocks.length
        ? toolUseBlocks.map((b: any) => ({
            id: b.id,
            name: b.name,
            arguments: JSON.stringify(b.input),
          }))
        : undefined,
      finishReason: data.stop_reason === "end_turn" ? "stop" : data.stop_reason ?? "stop",
      usage: {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      model: data.model ?? this.defaultModel,
      raw: data,
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const systemMsg = options.messages.find((m) => m.role === "system");
    const nonSystemMessages = options.messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: options.model ?? this.defaultModel,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
      messages: nonSystemMessages.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: this.toAnthropicContent(m.content),
      })),
    };

    if (systemMsg) body["system"] = getMessageText(systemMsg);
    if (options.temperature !== undefined) body["temperature"] = options.temperature;

    const response = await this.rawRequest("/messages", body);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body for streaming");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const event = JSON.parse(trimmed.slice(6));
          if (event.type === "content_block_delta" && event.delta?.text) {
            yield { content: event.delta.text };
          }
          if (event.type === "message_stop") {
            yield { content: "", finishReason: "stop" };
          }
        } catch {
          // Skip malformed events
        }
      }
    }
  }

  async embed(_texts: string[], _model?: string): Promise<EmbeddingResponse> {
    throw new Error("Anthropic does not natively support embeddings. Use OpenAI or a local model.");
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Anthropic doesn't have a models list endpoint; use a minimal completion
      await this.complete({
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 1,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async request(path: string, body: unknown): Promise<any> {
    const response = await this.rawRequest(path, body);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }
    return response.json();
  }

  private async rawRequest(path: string, body: unknown): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.status === 429 || response.status >= 500) {
          if (attempt < this.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
            continue;
          }
        }

        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }
}

// ── Google (Gemini) provider ──────────────────────────────────────────────────

export class GoogleProvider implements LLMProvider {
  readonly name = "google";
  readonly supportedModels = [
    "gemini-2.0-flash",
    "gemini-2.0-pro",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "text-embedding-004",
  ];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env["GOOGLE_API_KEY"] ?? "";
    this.baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.defaultModel = config.defaultModel ?? "gemini-2.0-flash";
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  /**
   * Convert LLMMessage content to Gemini parts format.
   * Translates ContentPart[] (with image_url) to Gemini inline_data parts.
   */
  private toGeminiParts(content: string | ContentPart[]): Array<Record<string, unknown>> {
    if (typeof content === "string") return [{ text: content }];

    return content.map((part) => {
      if (part.type === "text") {
        return { text: part.text ?? "" };
      }
      if (part.type === "image_url" && part.image_url) {
        const url = part.image_url.url;
        // Handle data URIs: data:image/png;base64,<data>
        const dataUriMatch = url.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUriMatch) {
          return {
            inline_data: {
              mime_type: dataUriMatch[1],
              data: dataUriMatch[2],
            },
          };
        }
        // For external URLs, Gemini supports file_data with URI
        return {
          file_data: {
            mime_type: "image/png",
            file_uri: url,
          },
        };
      }
      return { text: "" };
    });
  }

  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    const model = options.model ?? this.defaultModel;
    const systemMsg = options.messages.find((m) => m.role === "system");
    const contents = options.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: this.toGeminiParts(m.content),
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens,
        topP: options.topP,
        stopSequences: options.stop,
      },
    };

    if (systemMsg) {
      body["systemInstruction"] = { parts: [{ text: getMessageText(systemMsg) }] };
    }

    const url = `${this.baseUrl}/models/${model}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as any;
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text ?? "";

    return {
      content: text,
      finishReason: candidate?.finishReason === "STOP" ? "stop" : "stop",
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
      model,
      raw: data,
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const model = options.model ?? this.defaultModel;
    const contents = options.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: this.toGeminiParts(m.content),
      }));

    const body = { contents, generationConfig: { maxOutputTokens: options.maxTokens } };
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw new Error(`Google API error: ${response.status}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) yield { content: text };
        } catch {
          // skip
        }
      }
    }
  }

  async embed(texts: string[], model?: string): Promise<EmbeddingResponse> {
    const embModel = model ?? "text-embedding-004";
    const url = `${this.baseUrl}/models/${embModel}:batchEmbedContents`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${embModel}`,
          content: { parts: [{ text }] },
        })),
      }),
    });

    if (!response.ok) throw new Error(`Google embed error: ${response.status}`);

    const data = (await response.json()) as any;
    return {
      embeddings: data.embeddings?.map((e: any) => e.values) ?? [],
      model: embModel,
      usage: { promptTokens: 0, totalTokens: 0 },
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/models`;
      const res = await fetch(url, { headers: { "x-goog-api-key": this.apiKey }, signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── Ollama (local) provider ───────────────────────────────────────────────────

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly supportedModels = [
    "llama3.2",
    "llama3.1",
    "mistral",
    "mixtral",
    "codellama",
    "phi3",
    "qwen2.5",
    "deepseek-r1",
    "nomic-embed-text",
  ];

  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(config: ProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
    this.defaultModel = config.defaultModel ?? "llama3.2";
    this.timeoutMs = config.timeoutMs ?? 300000; // Local models can be slow
  }

  /**
   * Convert LLMMessage content to Ollama message format.
   * Ollama uses `content` for text and `images` array for base64 image data.
   */
  private toOllamaMessage(m: LLMMessage): Record<string, unknown> {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }

    // Extract text and images from ContentPart[]
    const textParts: string[] = [];
    const images: string[] = [];

    for (const part of m.content) {
      if (part.type === "text" && part.text) {
        textParts.push(part.text);
      } else if (part.type === "image_url" && part.image_url) {
        const url = part.image_url.url;
        // Extract base64 from data URI
        const dataUriMatch = url.match(/^data:[^;]+;base64,(.+)$/);
        if (dataUriMatch?.[1]) {
          images.push(dataUriMatch[1]);
        } else if (!url.startsWith("http")) {
          // Assume raw base64
          images.push(url);
        }
        // Note: Ollama doesn't support URL images — only base64
      }
    }

    const msg: Record<string, unknown> = {
      role: m.role,
      content: textParts.join("\n"),
    };
    if (images.length > 0) {
      msg["images"] = images;
    }
    return msg;
  }

  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        messages: options.messages.map((m) => this.toOllamaMessage(m)),
        stream: false,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
          top_p: options.topP,
          stop: options.stop,
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = (await response.json()) as any;

    return {
      content: data.message?.content ?? "",
      finishReason: data.done ? "stop" : "length",
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      model: data.model ?? this.defaultModel,
      raw: data,
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        messages: options.messages.map((m) => this.toOllamaMessage(m)),
        stream: true,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            yield { content: parsed.message.content };
          }
          if (parsed.done) {
            yield { content: "", finishReason: "stop" };
          }
        } catch {
          // skip
        }
      }
    }
  }

  async embed(texts: string[], model?: string): Promise<EmbeddingResponse> {
    const embModel = model ?? "nomic-embed-text";
    const embeddings: number[][] = [];

    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: embModel, prompt: text }),
      });

      if (!response.ok) throw new Error(`Ollama embed error: ${response.status}`);
      const data = (await response.json()) as any;
      embeddings.push(data.embedding);
    }

    return {
      embeddings,
      model: embModel,
      usage: { promptTokens: 0, totalTokens: 0 },
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── Universal LLM adapter ────────────────────────────────────────────────────

export interface LLMAdapterConfig {
  providers: Record<string, ProviderConfig>;
  /** Ordered list of provider names for fallback. */
  fallbackChain?: string[];
  /** Default provider to use. */
  defaultProvider?: string;
}

/**
 * Universal LLM adapter that supports multiple providers with
 * automatic fallback, rate limiting, and unified interface.
 *
 * @example
 * ```ts
 * const llm = new LLMAdapter({
 *   providers: {
 *     anthropic: { apiKey: "sk-..." },
 *     openai: { apiKey: "sk-..." },
 *     ollama: {},
 *   },
 *   fallbackChain: ["anthropic", "openai", "ollama"],
 *   defaultProvider: "anthropic",
 * });
 *
 * const response = await llm.complete({
 *   messages: [{ role: "user", content: "Hello!" }],
 * });
 * ```
 */
export class LLMAdapter {
  private providers = new Map<string, LLMProvider>();
  private fallbackChain: string[];
  private defaultProvider: string;

  private static readonly PROVIDER_CONSTRUCTORS: Record<
    string,
    new (config: ProviderConfig) => LLMProvider
  > = {
    openai: OpenAIProvider,
    anthropic: AnthropicProvider,
    google: GoogleProvider,
    ollama: OllamaProvider,
  };

  constructor(config: LLMAdapterConfig) {
    // Instantiate configured providers
    for (const [name, providerConfig] of Object.entries(config.providers)) {
      const Constructor = LLMAdapter.PROVIDER_CONSTRUCTORS[name];
      if (Constructor) {
        this.providers.set(name, new Constructor(providerConfig));
      }
    }

    this.fallbackChain = config.fallbackChain ?? Object.keys(config.providers);
    this.defaultProvider = config.defaultProvider ?? this.fallbackChain[0] ?? "openai";
  }

  /** Register a custom provider. */
  registerProvider(name: string, provider: LLMProvider): void {
    this.providers.set(name, provider);
  }

  /** Get a specific provider by name. */
  getProvider(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  /** Get the default provider instance. */
  getDefaultProvider(): LLMProvider | undefined {
    return this.providers.get(this.defaultProvider);
  }

  /** List all registered provider names. */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Complete a prompt, using the fallback chain on failure.
   *
   * If `provider/model` format is used in options.model (e.g. "anthropic/claude-sonnet-4-20250514"),
   * the provider prefix is extracted and used directly.
   */
  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    const { providerName, model } = this.resolveModel(options.model);
    const resolvedOptions = { ...options, model };

    const chain = providerName
      ? [providerName, ...this.fallbackChain.filter((p) => p !== providerName)]
      : this.fallbackChain;

    let lastError: Error | undefined;

    for (const name of chain) {
      const provider = this.providers.get(name);
      if (!provider) continue;

      try {
        return await provider.complete(resolvedOptions);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Continue to next provider in the chain
      }
    }

    throw lastError ?? new Error("No providers available");
  }

  /** Stream a completion from the specified or default provider. */
  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const { providerName, model } = this.resolveModel(options.model);
    const provider = this.providers.get(providerName ?? this.defaultProvider);
    if (!provider) throw new Error(`Provider not found: ${providerName ?? this.defaultProvider}`);

    yield* provider.stream({ ...options, model });
  }

  /** Generate embeddings using the specified or default provider. */
  async embed(texts: string[], model?: string): Promise<EmbeddingResponse> {
    const { providerName, model: resolvedModel } = this.resolveModel(model);
    const provider = this.providers.get(providerName ?? this.defaultProvider);
    if (!provider) throw new Error(`Provider not found: ${providerName ?? this.defaultProvider}`);

    return provider.embed(texts, resolvedModel);
  }

  /** Check health of all providers. */
  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    await Promise.all(
      Array.from(this.providers.entries()).map(async ([name, provider]) => {
        results[name] = await provider.healthCheck();
      }),
    );
    return results;
  }

  private resolveModel(model?: string): { providerName?: string; model?: string } {
    if (!model) return {};
    if (model.includes("/")) {
      const [providerName, ...rest] = model.split("/");
      return { providerName, model: rest.join("/") };
    }
    return { model };
  }
}
