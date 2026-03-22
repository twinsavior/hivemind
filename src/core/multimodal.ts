import { readFile, stat, writeFile, mkdir } from "fs/promises";
import { extname, join } from "path";
import { tmpdir } from "os";
import type { LLMAdapter, ContentPart } from "./llm.js";
import type { VisionProvider } from "./vision-provider.js";

// ── Result types ──────────────────────────────────────────────────────────────

export interface ImageAnalysis {
  description: string;
  objects: string[];
  text?: string; // OCR-extracted text
  colors: string[];
  dimensions?: { width: number; height: number };
  confidence: number;
}

export interface AudioTranscription {
  text: string;
  language: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    confidence: number;
  }>;
  durationMs: number;
}

export interface DocumentExtraction {
  text: string;
  pages: number;
  metadata: Record<string, string>;
  tables?: Array<{ headers: string[]; rows: string[][] }>;
  images?: string[]; // base64 embedded images
}

// ── Configuration ─────────────────────────────────────────────────────────────

export interface MultiModalConfig {
  llm?: LLMAdapter;
  visionProvider?: VisionProvider;
  openaiApiKey?: string; // For Whisper API (audio)
  tempDir?: string;
  timeoutMs?: number;
}

// ── MIME type detection ───────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".svg",
]);
const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".flac",
  ".aac",
  ".wma",
  ".webm",
]);
const DOCUMENT_EXTENSIONS = new Set([".pdf"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".rst",
  ".org",
  ".csv",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".log",
  ".html",
  ".htm",
]);

function mimeForExtension(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".webm": "audio/webm",
    ".pdf": "application/pdf",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

// ── Multi-modal engine ────────────────────────────────────────────────────────

/**
 * Multi-modal processing engine for HIVEMIND agents.
 * Handles images (analysis + OCR), audio (transcription), PDFs (text extraction),
 * and generic documents by routing to the appropriate processor.
 */
export class MultiModalEngine {
  private readonly llm?: LLMAdapter;
  private readonly visionProvider?: VisionProvider;
  private readonly openaiApiKey?: string;
  private readonly tempDir: string;
  private readonly timeoutMs: number;

  constructor(config: MultiModalConfig = {}) {
    this.llm = config.llm;
    this.visionProvider = config.visionProvider;
    this.openaiApiKey =
      config.openaiApiKey ?? process.env["OPENAI_API_KEY"];
    this.tempDir = config.tempDir ?? join(tmpdir(), "hivemind-multimodal");
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  // ── Image Analysis ────────────────────────────────────────────────────────

  /**
   * Analyze an image from a URL, file path, or Buffer.
   * Uses the vision provider (or LLM with vision messages) to describe the image,
   * detect objects, extract text (OCR), and identify dominant colors.
   */
  async analyzeImage(
    input: string | Buffer,
    prompt?: string,
  ): Promise<ImageAnalysis> {
    const base64 = await this.toBase64(input);
    const analysisPrompt =
      prompt ??
      "Analyze this image in detail. Describe what you see, list all identifiable objects, extract any visible text (OCR), and list the dominant colors.";

    const structuredPrompt = `${analysisPrompt}

Respond in JSON format:
{
  "description": "detailed description of the image",
  "objects": ["object1", "object2"],
  "text": "any text visible in the image or null",
  "colors": ["color1", "color2"],
  "confidence": 0.0 to 1.0
}`;

    // Try vision provider first, fall back to LLM with vision messages
    if (this.visionProvider?.isAvailable()) {
      const raw = await this.visionProvider.analyze(base64, structuredPrompt);
      return this.parseImageAnalysis(raw);
    }

    if (this.llm) {
      const contentParts: ContentPart[] = [
        { type: "text", text: structuredPrompt },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${base64}`, detail: "high" },
        },
      ];

      const response = await this.llm.complete({
        messages: [
          {
            role: "user",
            content: contentParts,
          },
        ],
        maxTokens: 2048,
        temperature: 0.2,
        responseFormat: "json",
      });

      return this.parseImageAnalysis(response.content);
    }

    throw new Error(
      "No vision provider or LLM available for image analysis. Configure a vision provider or LLM adapter.",
    );
  }

  /**
   * Perform OCR on an image — extract only visible text.
   */
  async ocrImage(input: string | Buffer): Promise<string> {
    const base64 = await this.toBase64(input);

    if (this.visionProvider?.isAvailable()) {
      return this.visionProvider.ocr(base64);
    }

    if (this.llm) {
      const contentParts: ContentPart[] = [
        {
          type: "text",
          text: "Extract ALL text visible in this image. Return only the extracted text, preserving layout where possible. If no text is visible, respond with an empty string.",
        },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${base64}`, detail: "high" },
        },
      ];

      const response = await this.llm.complete({
        messages: [{ role: "user", content: contentParts }],
        maxTokens: 4096,
        temperature: 0.1,
      });

      return response.content.trim();
    }

    throw new Error("No vision provider or LLM available for OCR.");
  }

  /**
   * Capture a screenshot of a URL and analyze it.
   * Requires a browser provider or falls back to a screenshot API.
   */
  async captureAndAnalyze(
    url: string,
    prompt?: string,
  ): Promise<ImageAnalysis & { screenshotBase64: string }> {
    // Attempt to fetch the URL as an image first (works for direct image URLs)
    let screenshotBase64: string;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; HIVEMIND/1.0; +https://github.com/hivemind)",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.startsWith("image/")) {
        const buffer = Buffer.from(await response.arrayBuffer());
        screenshotBase64 = buffer.toString("base64");
      } else {
        // Not a direct image URL — try a free screenshot API as fallback
        const screenshotApiUrl = `https://image.thum.io/get/width/1280/crop/800/${encodeURIComponent(url)}`;
        const screenshotResponse = await fetch(screenshotApiUrl, {
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!screenshotResponse.ok) {
          throw new Error(
            `Screenshot API failed: ${screenshotResponse.status}`,
          );
        }
        const buf = Buffer.from(await screenshotResponse.arrayBuffer());
        screenshotBase64 = buf.toString("base64");
      }
    } catch (err) {
      throw new Error(
        `Failed to capture screenshot of ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const analysis = await this.analyzeImage(
      Buffer.from(screenshotBase64, "base64"),
      prompt ?? `Analyze this screenshot of ${url}. Describe the page layout, content, and any notable elements.`,
    );

    return { ...analysis, screenshotBase64 };
  }

  // ── Audio Transcription ───────────────────────────────────────────────────

  /**
   * Transcribe audio from a file path or Buffer.
   * Prioritizes OpenAI Whisper API for quality; falls back gracefully.
   */
  async transcribeAudio(input: string | Buffer): Promise<AudioTranscription> {
    let audioBuffer: Buffer;
    let fileName = "audio.wav";

    if (typeof input === "string") {
      audioBuffer = await readFile(input);
      fileName = input.split("/").pop() ?? "audio.wav";
    } else {
      audioBuffer = input;
    }

    // Try OpenAI Whisper API
    const apiKey = this.openaiApiKey;
    if (apiKey) {
      return this.transcribeWithWhisper(audioBuffer, fileName, apiKey);
    }

    // Try local whisper CLI
    try {
      return await this.transcribeWithLocalWhisper(audioBuffer, fileName);
    } catch {
      // Fall back to LLM-based description (limited — no actual transcription)
    }

    // Last resort: if we have an LLM, at least acknowledge the audio
    if (this.llm) {
      const ext = extname(fileName).toLowerCase();
      const fileSizeKb = Math.round(audioBuffer.length / 1024);
      // Estimate duration from file size (very rough: ~16KB/s for compressed audio)
      const estimatedDurationMs = Math.round((audioBuffer.length / 16_000) * 1000);

      const response = await this.llm.complete({
        messages: [
          {
            role: "user",
            content: `I have an audio file "${fileName}" (${ext} format, ${fileSizeKb}KB, estimated ~${Math.round(estimatedDurationMs / 1000)}s). I cannot play it directly, but I need to process it. Please note that this audio could not be transcribed because no Whisper API key or local whisper binary is available. Suggest how to set up transcription.`,
          },
        ],
        maxTokens: 512,
        temperature: 0.3,
      });

      return {
        text: `[Transcription unavailable — no Whisper API key configured] ${response.content}`,
        language: "unknown",
        segments: [],
        durationMs: estimatedDurationMs,
      };
    }

    throw new Error(
      "No audio transcription provider available. Set OPENAI_API_KEY for Whisper, or install whisper locally.",
    );
  }

  private async transcribeWithWhisper(
    audioBuffer: Buffer,
    fileName: string,
    apiKey: string,
  ): Promise<AudioTranscription> {
    // Build multipart form data manually (no external deps)
    const boundary = `----HivemindBoundary${Date.now().toString(36)}`;
    const ext = extname(fileName).toLowerCase();
    const mime = mimeForExtension(ext);

    const preamble = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
    );
    const midamble = Buffer.from(
      `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `whisper-1\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
        `verbose_json\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n` +
        `segment\r\n` +
        `--${boundary}--\r\n`,
    );
    const body = Buffer.concat([preamble, audioBuffer, midamble]);

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Whisper API error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as {
      text: string;
      language: string;
      duration: number;
      segments?: Array<{
        start: number;
        end: number;
        text: string;
        avg_logprob?: number;
      }>;
    };

    return {
      text: data.text,
      language: data.language ?? "en",
      segments: (data.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        confidence: s.avg_logprob != null ? Math.exp(s.avg_logprob) : 0.8,
      })),
      durationMs: Math.round((data.duration ?? 0) * 1000),
    };
  }

  private async transcribeWithLocalWhisper(
    audioBuffer: Buffer,
    fileName: string,
  ): Promise<AudioTranscription> {
    // Write audio to temp file, run local whisper CLI
    await mkdir(this.tempDir, { recursive: true });
    const tempPath = join(this.tempDir, `whisper-${Date.now()}-${fileName}`);
    const outputPath = `${tempPath}.json`;
    await writeFile(tempPath, audioBuffer);

    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    try {
      await execFileAsync("whisper", [
        tempPath,
        "--model",
        "base",
        "--output_format",
        "json",
        "--output_dir",
        this.tempDir,
      ]);

      const resultJson = await readFile(outputPath, "utf-8");
      const result = JSON.parse(resultJson) as {
        text: string;
        language?: string;
        segments?: Array<{
          start: number;
          end: number;
          text: string;
          avg_logprob?: number;
        }>;
      };

      return {
        text: result.text,
        language: result.language ?? "en",
        segments: (result.segments ?? []).map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
          confidence: s.avg_logprob != null ? Math.exp(s.avg_logprob) : 0.7,
        })),
        durationMs: 0, // Local whisper JSON doesn't include total duration directly
      };
    } catch (err) {
      throw new Error(
        `Local whisper failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── PDF Extraction ────────────────────────────────────────────────────────

  /**
   * Extract text, metadata, and structure from a PDF file.
   * Uses a regex-based text extractor for basic PDFs; for complex PDFs
   * with images or scanned content, forwards pages to the vision provider.
   */
  async extractPDF(
    filePath: string,
    pages?: string,
  ): Promise<DocumentExtraction> {
    const fileBuffer = await readFile(filePath);
    const pdfText = this.extractPDFText(fileBuffer);
    const metadata = this.extractPDFMetadata(fileBuffer);
    const pageCount = this.countPDFPages(fileBuffer);

    // Filter to requested page range if specified
    let text = pdfText;
    if (pages && pdfText.length > 0) {
      const range = this.parsePageRange(pages, pageCount);
      // Basic page splitting by form feed or by dividing text evenly
      const pageTexts = this.splitTextByPages(pdfText, pageCount);
      text = range
        .map((p) => pageTexts[p - 1] ?? "")
        .filter(Boolean)
        .join("\n\n---\n\n");
    }

    // If we got very little text, the PDF might be image-based — try OCR via vision
    if (text.trim().length < 50 && this.llm) {
      try {
        const base64 = fileBuffer.toString("base64");
        const contentParts: ContentPart[] = [
          {
            type: "text",
            text: "This is a PDF document that appears to contain primarily images or scanned content. Extract all visible text from the document, preserving the structure and layout as much as possible.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:application/pdf;base64,${base64}`,
              detail: "high",
            },
          },
        ];

        const response = await this.llm.complete({
          messages: [{ role: "user", content: contentParts }],
          maxTokens: 8192,
          temperature: 0.1,
        });

        text = response.content.trim();
      } catch {
        // Vision-based extraction failed — return what we have
      }
    }

    return {
      text: text || "[No extractable text found in PDF]",
      pages: pageCount,
      metadata,
    };
  }

  /**
   * Basic PDF text extraction using regex patterns on the raw PDF stream.
   * Handles text objects in content streams: BT ... (text) Tj ... ET
   * This is a lightweight alternative that avoids external dependencies.
   */
  private extractPDFText(buffer: Buffer): string {
    const raw = buffer.toString("latin1");
    const textChunks: string[] = [];

    // Match text within parentheses in PDF text objects (Tj and TJ operators)
    // Pattern: text between BT and ET blocks containing (text) Tj or [(text)] TJ
    const textObjPattern = /BT[\s\S]*?ET/g;
    let match: RegExpExecArray | null;

    while ((match = textObjPattern.exec(raw)) !== null) {
      const block = match[0];

      // Extract text from (string) Tj operators
      const tjPattern = /\(([^)]*)\)\s*Tj/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjPattern.exec(block)) !== null) {
        const decoded = this.decodePDFString(tjMatch[1] ?? "");
        if (decoded.trim()) textChunks.push(decoded);
      }

      // Extract text from TJ arrays: [(string) number (string)] TJ
      const tjArrayPattern = /\[((?:\([^)]*\)|[^[\]])*)\]\s*TJ/gi;
      let tjArrMatch: RegExpExecArray | null;
      while ((tjArrMatch = tjArrayPattern.exec(block)) !== null) {
        const inner = tjArrMatch[1] ?? "";
        const strPattern = /\(([^)]*)\)/g;
        let strMatch: RegExpExecArray | null;
        const parts: string[] = [];
        while ((strMatch = strPattern.exec(inner)) !== null) {
          parts.push(this.decodePDFString(strMatch[1] ?? ""));
        }
        const line = parts.join("");
        if (line.trim()) textChunks.push(line);
      }
    }

    // Also try to extract text from stream objects (for some PDF encodings)
    const streamPattern = /stream\r?\n([\s\S]*?)endstream/g;
    while ((match = streamPattern.exec(raw)) !== null) {
      const streamContent = match[1] ?? "";
      // Only process if it looks like text content (has BT/ET)
      if (streamContent.includes("BT") && streamContent.includes("ET")) {
        const innerTextObjs = /BT[\s\S]*?ET/g;
        let innerMatch: RegExpExecArray | null;
        while ((innerMatch = innerTextObjs.exec(streamContent)) !== null) {
          const block = innerMatch[0];
          const tjPattern = /\(([^)]*)\)\s*Tj/g;
          let tjMatch: RegExpExecArray | null;
          while ((tjMatch = tjPattern.exec(block)) !== null) {
            const decoded = this.decodePDFString(tjMatch[1] ?? "");
            if (decoded.trim()) textChunks.push(decoded);
          }
        }
      }
    }

    return textChunks.join(" ").replace(/\s+/g, " ").trim();
  }

  /** Decode PDF escape sequences in parenthesized strings. */
  private decodePDFString(s: string): string {
    return s
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .replace(/\\([()])/g, "$1")
      .replace(/\\(\d{1,3})/g, (_, octal: string) =>
        String.fromCharCode(parseInt(octal, 8)),
      );
  }

  /** Extract basic metadata from PDF header/trailer. */
  private extractPDFMetadata(buffer: Buffer): Record<string, string> {
    const raw = buffer.toString("latin1");
    const metadata: Record<string, string> = {};

    // Extract info from /Info dictionary
    const infoFields = ["Title", "Author", "Subject", "Creator", "Producer", "CreationDate", "ModDate"];
    for (const field of infoFields) {
      const pattern = new RegExp(`/${field}\\s*\\(([^)]*)\\)`, "i");
      const match = pattern.exec(raw);
      if (match?.[1]) {
        metadata[field.toLowerCase()] = this.decodePDFString(match[1]);
      }
      // Also try hex string format: /Field <hex>
      const hexPattern = new RegExp(`/${field}\\s*<([0-9A-Fa-f]+)>`, "i");
      const hexMatch = hexPattern.exec(raw);
      if (hexMatch?.[1] && !metadata[field.toLowerCase()]) {
        const hex = hexMatch[1];
        let str = "";
        for (let i = 0; i < hex.length; i += 2) {
          str += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
        }
        // Strip BOM markers if present
        metadata[field.toLowerCase()] = str.replace(/^\xFE\xFF/, "").replace(/\0/g, "");
      }
    }

    // PDF version
    const versionMatch = /%PDF-(\d+\.\d+)/.exec(raw);
    if (versionMatch?.[1]) {
      metadata["pdf_version"] = versionMatch[1];
    }

    return metadata;
  }

  /** Count pages by counting /Type /Page entries. */
  private countPDFPages(buffer: Buffer): number {
    const raw = buffer.toString("latin1");

    // Try /Pages /Count N first (most reliable)
    const countMatch = /\/Pages\s[\s\S]*?\/Count\s+(\d+)/.exec(raw);
    if (countMatch?.[1]) {
      return parseInt(countMatch[1], 10);
    }

    // Fall back to counting /Type /Page occurrences (exclude /Pages)
    const pagePattern = /\/Type\s*\/Page(?!s)\b/g;
    let count = 0;
    while (pagePattern.exec(raw) !== null) {
      count++;
    }
    return Math.max(count, 1);
  }

  /** Parse a page range string like "1-5" or "1,3,5" into an array of page numbers. */
  private parsePageRange(range: string, maxPages: number): number[] {
    const pages: number[] = [];

    for (const part of range.split(",")) {
      const trimmed = part.trim();
      if (trimmed.includes("-")) {
        const [startStr, endStr] = trimmed.split("-");
        const start = Math.max(1, parseInt(startStr ?? "1", 10));
        const end = Math.min(maxPages, parseInt(endStr ?? String(maxPages), 10));
        for (let i = start; i <= end; i++) {
          pages.push(i);
        }
      } else {
        const p = parseInt(trimmed, 10);
        if (p >= 1 && p <= maxPages) {
          pages.push(p);
        }
      }
    }

    return pages.length > 0 ? pages : [1];
  }

  /** Split extracted text into approximate page chunks. */
  private splitTextByPages(text: string, pageCount: number): string[] {
    // If text contains form feeds, split on those
    if (text.includes("\f")) {
      return text.split("\f");
    }

    // Otherwise divide text evenly by page count
    if (pageCount <= 1) return [text];

    const chunkSize = Math.ceil(text.length / pageCount);
    const pages: string[] = [];
    for (let i = 0; i < pageCount; i++) {
      pages.push(text.slice(i * chunkSize, (i + 1) * chunkSize));
    }
    return pages;
  }

  // ── Generic Document Processing ───────────────────────────────────────────

  /**
   * Process any document by routing based on file extension.
   * Supports PDFs, images (with OCR), audio files, and text formats.
   */
  async processDocument(filePath: string): Promise<DocumentExtraction> {
    const ext = extname(filePath).toLowerCase();

    // PDF
    if (DOCUMENT_EXTENSIONS.has(ext)) {
      return this.extractPDF(filePath);
    }

    // Image -> analyze + OCR
    if (IMAGE_EXTENSIONS.has(ext)) {
      const analysis = await this.analyzeImage(filePath);
      return {
        text: analysis.text ?? analysis.description,
        pages: 1,
        metadata: {
          type: "image",
          format: ext.slice(1),
          objects: analysis.objects.join(", "),
          colors: analysis.colors.join(", "),
          confidence: String(analysis.confidence),
        },
      };
    }

    // Audio -> transcribe
    if (AUDIO_EXTENSIONS.has(ext)) {
      const transcription = await this.transcribeAudio(filePath);
      return {
        text: transcription.text,
        pages: 1,
        metadata: {
          type: "audio",
          format: ext.slice(1),
          language: transcription.language,
          duration_ms: String(transcription.durationMs),
          segments: String(transcription.segments.length),
        },
      };
    }

    // Text / data files -> read directly
    if (TEXT_EXTENSIONS.has(ext)) {
      const content = await readFile(filePath, "utf-8");

      // For CSV, try to extract table structure
      if (ext === ".csv") {
        const table = this.parseCSV(content);
        return {
          text: content,
          pages: 1,
          metadata: {
            type: "csv",
            rows: String(table.rows.length),
            columns: String(table.headers.length),
          },
          tables: [table],
        };
      }

      // For JSON, pretty-print
      if (ext === ".json") {
        try {
          const parsed = JSON.parse(content);
          return {
            text: JSON.stringify(parsed, null, 2),
            pages: 1,
            metadata: {
              type: "json",
              keys: Array.isArray(parsed)
                ? `array[${parsed.length}]`
                : Object.keys(parsed).join(", "),
            },
          };
        } catch {
          // Not valid JSON, return as-is
        }
      }

      return {
        text: content,
        pages: 1,
        metadata: { type: ext.slice(1) },
      };
    }

    // Unknown extension — try reading as text
    try {
      const content = await readFile(filePath, "utf-8");
      return {
        text: content,
        pages: 1,
        metadata: { type: "unknown", extension: ext },
      };
    } catch {
      throw new Error(
        `Unsupported file type "${ext}" and file is not readable as text: ${filePath}`,
      );
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  /** Parse CSV content into a table structure. */
  private parseCSV(
    content: string,
  ): { headers: string[]; rows: string[][] } {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };

    const parseLine = (line: string): string[] => {
      const fields: string[] = [];
      let current = "";
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i]!;
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === "," && !inQuotes) {
          fields.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      fields.push(current.trim());
      return fields;
    };

    const headers = parseLine(lines[0]!);
    const rows = lines.slice(1).map(parseLine);

    return { headers, rows };
  }

  /**
   * Convert input (URL, file path, or Buffer) to a base64 string.
   */
  async toBase64(input: string | Buffer): Promise<string> {
    if (Buffer.isBuffer(input)) {
      return input.toString("base64");
    }

    // Check if it's already a data URI
    if (input.startsWith("data:")) {
      const commaIdx = input.indexOf(",");
      if (commaIdx >= 0) {
        return input.slice(commaIdx + 1);
      }
    }

    // Check if it's already base64 (heuristic: long string with no slashes or dots)
    if (
      input.length > 100 &&
      !input.includes("/") &&
      !input.includes(".") &&
      /^[A-Za-z0-9+/=]+$/.test(input)
    ) {
      return input;
    }

    // Check if it's a URL
    if (input.startsWith("http://") || input.startsWith("https://")) {
      const response = await fetch(input, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; HIVEMIND/1.0; +https://github.com/hivemind)",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch image from ${input}: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer.toString("base64");
    }

    // Assume it's a file path
    try {
      const buffer = await readFile(input);
      return buffer.toString("base64");
    } catch (err) {
      throw new Error(
        `Failed to read file "${input}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Parse an LLM response into a structured ImageAnalysis. */
  private parseImageAnalysis(raw: string): ImageAnalysis {
    try {
      // Try to extract JSON from the response
      let json: Record<string, unknown>;

      // First try direct parse
      try {
        json = JSON.parse(raw);
      } catch {
        // Try extracting from markdown code block
        const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch?.[1]) {
          json = JSON.parse(codeBlockMatch[1].trim());
        } else {
          // Try finding JSON object in the text
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            json = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("No JSON found");
          }
        }
      }

      return {
        description: String(json["description"] ?? raw.slice(0, 500)),
        objects: Array.isArray(json["objects"])
          ? (json["objects"] as unknown[]).map(String)
          : [],
        text: json["text"] != null ? String(json["text"]) : undefined,
        colors: Array.isArray(json["colors"])
          ? (json["colors"] as unknown[]).map(String)
          : [],
        dimensions: json["dimensions"] as
          | { width: number; height: number }
          | undefined,
        confidence: typeof json["confidence"] === "number"
          ? (json["confidence"] as number)
          : 0.7,
      };
    } catch {
      // Couldn't parse structured response — return best-effort
      return {
        description: raw.slice(0, 1000),
        objects: [],
        colors: [],
        confidence: 0.3,
      };
    }
  }
}
