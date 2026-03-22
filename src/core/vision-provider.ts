/**
 * Vision provider abstraction for HIVEMIND.
 * Supports multiple backends (Claude, OpenAI, Ollama/llava) with
 * automatic detection of which is available.
 */

// ── Interface ─────────────────────────────────────────────────────────────────

export interface VisionProvider {
  readonly name: string;

  /** Analyze an image and return a natural language description guided by the prompt. */
  analyze(imageBase64: string, prompt: string): Promise<string>;

  /** Extract all visible text from an image (OCR). */
  ocr(imageBase64: string): Promise<string>;

  /** Check whether this provider is properly configured and reachable. */
  isAvailable(): boolean;
}

export interface VisionProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

// ── Claude Vision Provider ────────────────────────────────────────────────────

/**
 * Uses the Anthropic Messages API with image content blocks.
 * Supports Claude 3+ models with vision capabilities.
 */
export class ClaudeVisionProvider implements VisionProvider {
  readonly name = "claude-vision";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(config: VisionProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    this.baseUrl = config.baseUrl ?? "https://api.anthropic.com/v1";
    this.model = config.model ?? "claude-sonnet-4-20250514";
    this.maxTokens = config.maxTokens ?? 4096;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async analyze(imageBase64: string, prompt: string): Promise<string> {
    const mediaType = this.detectMediaType(imageBase64);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude Vision API error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const textBlock = data.content.find((b) => b.type === "text");
    return textBlock?.text ?? "";
  }

  async ocr(imageBase64: string): Promise<string> {
    return this.analyze(
      imageBase64,
      "Extract ALL text visible in this image. Return only the extracted text, preserving the layout and formatting. If no text is visible, respond with an empty string.",
    );
  }

  /** Detect image media type from base64 magic bytes. */
  private detectMediaType(
    base64: string,
  ): "image/png" | "image/jpeg" | "image/gif" | "image/webp" {
    const header = base64.slice(0, 20);
    if (header.startsWith("iVBOR")) return "image/png";
    if (header.startsWith("/9j/")) return "image/jpeg";
    if (header.startsWith("R0lG")) return "image/gif";
    if (header.startsWith("UklGR")) return "image/webp";
    // Default to PNG if we can't detect
    return "image/png";
  }
}

// ── OpenAI Vision Provider ────────────────────────────────────────────────────

/**
 * Uses OpenAI's Chat Completions API with image_url content parts.
 * Supports GPT-4o and GPT-4-turbo with vision.
 */
export class OpenAIVisionProvider implements VisionProvider {
  readonly name = "openai-vision";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(config: VisionProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    this.model = config.model ?? "gpt-4o";
    this.maxTokens = config.maxTokens ?? 4096;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async analyze(imageBase64: string, prompt: string): Promise<string> {
    const mediaType = this.detectMediaType(imageBase64);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mediaType};base64,${imageBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `OpenAI Vision API error ${response.status}: ${errText}`,
      );
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content ?? "";
  }

  async ocr(imageBase64: string): Promise<string> {
    return this.analyze(
      imageBase64,
      "Extract ALL text visible in this image. Return only the extracted text, preserving the layout and formatting. If no text is visible, respond with an empty string.",
    );
  }

  private detectMediaType(
    base64: string,
  ): "image/png" | "image/jpeg" | "image/gif" | "image/webp" {
    const header = base64.slice(0, 20);
    if (header.startsWith("iVBOR")) return "image/png";
    if (header.startsWith("/9j/")) return "image/jpeg";
    if (header.startsWith("R0lG")) return "image/gif";
    if (header.startsWith("UklGR")) return "image/webp";
    return "image/png";
  }
}

// ── Ollama Vision Provider ────────────────────────────────────────────────────

/**
 * Uses Ollama's API with vision-capable models (llava, bakllava, moondream).
 * Sends images as base64 in the `images` array of the message.
 */
export class OllamaVisionProvider implements VisionProvider {
  readonly name = "ollama-vision";

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private _available: boolean | null = null;

  constructor(config: VisionProviderConfig = {}) {
    this.baseUrl =
      config.baseUrl ??
      process.env["OLLAMA_HOST"] ??
      "http://localhost:11434";
    this.model = config.model ?? "llava";
    this.timeoutMs = config.timeoutMs ?? 300_000; // Local models can be slow
  }

  isAvailable(): boolean {
    // Cache the availability check to avoid repeated network calls.
    // Start optimistic — will be set to false if first call fails.
    if (this._available === null) {
      // Kick off an async check but return true optimistically
      this.checkAvailability().catch(() => {
        this._available = false;
      });
      return false; // Return false until we've confirmed
    }
    return this._available;
  }

  private async checkAvailability(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          models?: Array<{ name: string }>;
        };
        // Check if a vision-capable model is present
        const visionModels = ["llava", "bakllava", "moondream", "llava-phi3"];
        this._available =
          data.models?.some((m) =>
            visionModels.some((vm) => m.name.startsWith(vm)),
          ) ?? false;
      } else {
        this._available = false;
      }
    } catch {
      this._available = false;
    }
  }

  async analyze(imageBase64: string, prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "user",
            content: prompt,
            images: [imageBase64],
          },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text();
      this._available = false;
      throw new Error(
        `Ollama Vision API error ${response.status}: ${errText}`,
      );
    }

    this._available = true;
    const data = (await response.json()) as {
      message?: { content: string };
    };
    return data.message?.content ?? "";
  }

  async ocr(imageBase64: string): Promise<string> {
    return this.analyze(
      imageBase64,
      "Extract ALL text visible in this image. Return only the extracted text, preserving the layout and formatting. If no text is visible, respond with an empty string.",
    );
  }
}

// ── Auto-detect factory ───────────────────────────────────────────────────────

export interface AutoVisionConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  /** Preferred provider order. Defaults to ["claude", "openai", "ollama"]. */
  preferenceOrder?: Array<"claude" | "openai" | "ollama">;
}

/**
 * Auto-detect which vision provider is available and return the best one.
 * Checks API keys and service availability.
 */
export function createVisionProvider(
  config: AutoVisionConfig = {},
): VisionProvider | null {
  const order = config.preferenceOrder ?? ["claude", "openai", "ollama"];

  const providers: Record<string, () => VisionProvider> = {
    claude: () =>
      new ClaudeVisionProvider({ apiKey: config.anthropicApiKey }),
    openai: () =>
      new OpenAIVisionProvider({ apiKey: config.openaiApiKey }),
    ollama: () =>
      new OllamaVisionProvider({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
      }),
  };

  for (const name of order) {
    const factory = providers[name];
    if (!factory) continue;
    const provider = factory();
    if (provider.isAvailable()) {
      return provider;
    }
  }

  return null;
}

/**
 * Create all available vision providers for fallback scenarios.
 */
export function createAllVisionProviders(
  config: AutoVisionConfig = {},
): VisionProvider[] {
  const all: VisionProvider[] = [];

  const claude = new ClaudeVisionProvider({ apiKey: config.anthropicApiKey });
  if (claude.isAvailable()) all.push(claude);

  const openai = new OpenAIVisionProvider({ apiKey: config.openaiApiKey });
  if (openai.isAvailable()) all.push(openai);

  const ollama = new OllamaVisionProvider({
    baseUrl: config.ollamaBaseUrl,
    model: config.ollamaModel,
  });
  // Ollama is async-checked; add it optimistically — MultiModalEngine can handle failures
  all.push(ollama);

  return all;
}
