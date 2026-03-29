import { spawn, type ChildProcess } from "child_process";
import { accessSync } from "fs";
import { readFile, stat } from "fs/promises";
import * as path from "node:path";
import type { ToolCall, ToolResult } from "../agents/base-agent.js";
import type { LLMAdapter } from "./llm.js";
import type { AgentPermissions } from "./trust.js";

// ── Path Sandboxing ──────────────────────────────────────────────────────────

/**
 * Resolve a user-provided path relative to workDir and verify it stays inside.
 * Rejects traversal attacks (e.g. ../../etc/passwd) and absolute paths outside workDir.
 * @throws Error if the resolved path escapes the sandbox.
 */
function resolveAndValidatePath(workDir: string, userPath: string): string {
  const resolved = path.resolve(workDir, userPath);
  const normalizedWorkDir = path.resolve(workDir);

  if (resolved !== normalizedWorkDir && !resolved.startsWith(normalizedWorkDir + path.sep)) {
    throw new Error(
      `Path traversal blocked: "${userPath}" resolves to "${resolved}" which is outside the workspace "${normalizedWorkDir}"`
    );
  }
  return resolved;
}

// ── Configuration ─────────────────────────────────────────────────────────────

export interface ToolExecutorConfig {
  /** LLM adapter for AI-powered tools (summarize, sentiment, code gen). */
  llm?: LLMAdapter;
  /** Working directory for shell commands. */
  workDir?: string;
  /** Channel webhook URLs for Courier (channel name -> URL). */
  webhooks?: Record<string, string>;
  /** Default timeout for HTTP requests (ms). */
  httpTimeoutMs?: number;
  /** Default timeout for shell commands (ms). */
  shellTimeoutMs?: number;
  /** User-Agent string for HTTP requests. */
  userAgent?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Run a shell command and return { stdout, stderr, exitCode }. */
function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const cwd = options.cwd ?? process.cwd();
    const timeoutMs = options.timeoutMs ?? 60_000;

    let stdout = "";
    let stderr = "";
    let killed = false;

    const proc: ChildProcess = spawn(command, args, {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      // Force kill after 5s if SIGTERM didn't work
      setTimeout(() => proc.kill("SIGKILL"), 5_000);
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      // Cap output at 512KB to prevent memory issues
      if (stdout.length > 512_000) {
        stdout = stdout.slice(0, 512_000) + "\n...[truncated]";
        proc.kill("SIGTERM");
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 512_000) {
        stderr = stderr.slice(0, 512_000) + "\n...[truncated]";
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ stdout, stderr: stderr + "\n[Process killed: timeout]", exitCode: code ?? 137 });
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Fetch a URL with timeout and return the response. */
async function safeFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    userAgent?: string;
  } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const headers: Record<string, string> = {
    "User-Agent": options.userAgent ?? "HIVEMIND-Agent/1.0",
    ...options.headers,
  };

  return fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Strip HTML tags and return plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract content within a CSS-selector-like tag (very simplified). */
function extractBySelector(html: string, selector: string): string {
  // Support simple tag, .class, and #id selectors
  let pattern: RegExp;

  if (selector.startsWith("#")) {
    const id = selector.slice(1);
    pattern = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/`, "i");
  } else if (selector.startsWith(".")) {
    const cls = selector.slice(1);
    pattern = new RegExp(`<[^>]+class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/`, "i");
  } else {
    pattern = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\\/${selector}>`, "gi");
  }

  const matches = html.match(pattern);
  if (matches) {
    return stripHtml(matches.join(" "));
  }
  return stripHtml(html);
}

/** Parse RSS/Atom XML into feed items. */
function parseXmlFeed(xml: string): Array<{ title: string; link: string; pubDate: string; description: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; description: string }> = [];

  // RSS <item> elements
  const rssItemRegex = /<item>([\s\S]*?)<\/item>/gi;
  // Atom <entry> elements
  const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/gi;

  const extractTag = (xml: string, tag: string): string => {
    // Handle CDATA
    const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, "i"));
    if (cdataMatch?.[1]) return cdataMatch[1].trim();

    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return match?.[1]?.trim() ?? "";
  };

  const extractAtomLink = (xml: string): string => {
    const match = xml.match(/<link[^>]+href=["']([^"']+)["']/i);
    return match?.[1] ?? "";
  };

  // Try RSS first
  let match: RegExpExecArray | null;
  while ((match = rssItemRegex.exec(xml)) !== null) {
    const itemXml = match[1]!;
    items.push({
      title: stripHtml(extractTag(itemXml, "title")),
      link: extractTag(itemXml, "link") || extractTag(itemXml, "guid"),
      pubDate: extractTag(itemXml, "pubDate") || extractTag(itemXml, "dc:date"),
      description: stripHtml(extractTag(itemXml, "description") || extractTag(itemXml, "content:encoded")).slice(0, 500),
    });
  }

  // Try Atom if no RSS items found
  if (items.length === 0) {
    while ((match = atomEntryRegex.exec(xml)) !== null) {
      const entryXml = match[1]!;
      items.push({
        title: stripHtml(extractTag(entryXml, "title")),
        link: extractAtomLink(entryXml) || extractTag(entryXml, "id"),
        pubDate: extractTag(entryXml, "published") || extractTag(entryXml, "updated"),
        description: stripHtml(extractTag(entryXml, "summary") || extractTag(entryXml, "content")).slice(0, 500),
      });
    }
  }

  return items;
}

// ── Tool Handler Type ─────────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

// ── ToolExecutor ──────────────────────────────────────────────────────────────

/**
 * Provides real implementations for all HIVEMIND agent tools.
 *
 * Each tool is a named async function that performs actual I/O:
 * HTTP requests, file reads, child process execution, LLM calls, etc.
 */
export class ToolExecutor {
  private handlers: Map<string, ToolHandler> = new Map();
  private llm?: LLMAdapter;
  private workDir: string;
  private webhooks: Record<string, string>;
  private httpTimeoutMs: number;
  private shellTimeoutMs: number;
  private userAgent: string;

  constructor(config: ToolExecutorConfig = {}) {
    this.llm = config.llm;
    this.workDir = config.workDir ?? process.cwd();
    this.webhooks = config.webhooks ?? {};
    this.httpTimeoutMs = config.httpTimeoutMs ?? 30_000;
    this.shellTimeoutMs = config.shellTimeoutMs ?? 60_000;
    this.userAgent = config.userAgent ?? "HIVEMIND-Agent/1.0";

    this.registerScoutTools();
    this.registerBuilderTools();
    this.registerSentinelTools();
    this.registerOracleTools();
    this.registerCourierTools();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Execute a tool call, checking permissions first.
   *
   * @param call - The tool name and arguments.
   * @param permissions - Optional permission set to enforce.
   * @returns A ToolResult with timing, success flag, and data or error.
   */
  async execute(call: ToolCall, permissions?: AgentPermissions): Promise<ToolResult> {
    const start = Date.now();

    // Map tool names to the permission-level tool categories
    const toolCategory = this.getToolCategory(call.tool);
    if (permissions && toolCategory) {
      if (!permissions.allowedTools.includes(toolCategory)) {
        return {
          tool: call.tool,
          success: false,
          data: null,
          error: `Tool "${call.tool}" requires "${toolCategory}" permission, which is not granted at this trust level.`,
          durationMs: Date.now() - start,
        };
      }
    }

    // Check for blocked commands on shell-executing tools
    if (permissions && this.isShellTool(call.tool)) {
      const command = (call.args["command"] as string) ?? (call.args["testCommand"] as string) ?? "";
      if (command) {
        for (const pattern of permissions.blockedCommands) {
          if (pattern.test(command)) {
            return {
              tool: call.tool,
              success: false,
              data: null,
              error: `Command blocked by security policy: matches pattern "${pattern.source}"`,
              durationMs: Date.now() - start,
            };
          }
        }
      }
    }

    const handler = this.handlers.get(call.tool);
    if (!handler) {
      return {
        tool: call.tool,
        success: false,
        data: null,
        error: `Tool "${call.tool}" is not registered in the ToolExecutor.`,
        durationMs: Date.now() - start,
      };
    }

    try {
      const data = await handler(call.args);
      return {
        tool: call.tool,
        success: true,
        data,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        tool: call.tool,
        success: false,
        data: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Create a callTool function bound to specific permissions.
   * Meant for injection into an agent's callTool method.
   */
  createBoundExecutor(permissions?: AgentPermissions): (call: ToolCall) => Promise<ToolResult> {
    return (call: ToolCall) => this.execute(call, permissions);
  }

  /** Register a custom tool handler at runtime. */
  registerTool(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  /** Check if a tool is registered. */
  hasTool(name: string): boolean {
    return this.handlers.has(name);
  }

  /** List all registered tool names. */
  listTools(): string[] {
    return Array.from(this.handlers.keys());
  }

  // ── Permission mapping ──────────────────────────────────────────────────

  /**
   * Map a specific tool name to the trust-system tool category.
   * The trust system uses categories like 'WebSearch', 'WebFetch', 'Bash', 'Read', etc.
   */
  private getToolCategory(toolName: string): string | null {
    const categoryMap: Record<string, string> = {
      // Scout
      web_search: "WebSearch",
      fetch_url: "WebFetch",
      monitor_feeds: "WebFetch",
      summarize: "Read",     // Uses LLM but only reads
      analyze_image: "Read",
      extract_pdf: "Read",
      // Builder
      generate_code: "Write",
      run_tests: "Bash",
      lint_code: "Bash",
      build_container: "Bash",
      deploy: "Bash",
      // Sentinel
      check_uptime: "WebFetch",
      analyze_logs: "Read",
      security_scan: "Bash",
      performance_check: "WebFetch",
      // Oracle
      analyze_trend: "Read",
      forecast: "Read",
      sentiment_analysis: "Read",
      detect_anomalies: "Read",
      // Courier
      send_message: "WebFetch",
      broadcast: "WebFetch",
      schedule_message: "WebFetch",
      send_report: "WebFetch",
    };
    return categoryMap[toolName] ?? null;
  }

  /** Tools that execute shell commands. */
  private isShellTool(toolName: string): boolean {
    return ["run_tests", "lint_code", "build_container", "deploy", "security_scan"].includes(toolName);
  }

  // ── Scout Tools ─────────────────────────────────────────────────────────

  private registerScoutTools(): void {
    // ── web_search ──
    // Uses DuckDuckGo HTML search (no API key required)
    this.handlers.set("web_search", async (args) => {
      const query = args["query"] as string;
      const maxResults = (args["maxResults"] as number) ?? 10;

      if (!query) throw new Error("web_search requires a 'query' argument");

      // DuckDuckGo HTML search endpoint
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await safeFetch(url, {
        timeoutMs: this.httpTimeoutMs,
        userAgent: this.userAgent,
        headers: { "Accept": "text/html" },
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo search failed with status ${response.status}`);
      }

      const html = await response.text();

      // Parse DuckDuckGo HTML results
      const results: Array<{ title: string; url: string; snippet: string; relevance: number }> = [];
      const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

      let match: RegExpExecArray | null;
      let rank = 0;
      while ((match = resultRegex.exec(html)) !== null && rank < maxResults) {
        // DuckDuckGo wraps URLs in a redirect — extract the actual URL
        let resultUrl = match[1] ?? "";
        const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
        if (uddgMatch?.[1]) {
          resultUrl = decodeURIComponent(uddgMatch[1]);
        }

        results.push({
          title: stripHtml(match[2] ?? ""),
          url: resultUrl,
          snippet: stripHtml(match[3] ?? ""),
          relevance: 1.0 - rank * 0.05,
        });
        rank++;
      }

      // Fallback: simpler pattern if the above didn't match
      if (results.length === 0) {
        const simpleRegex = /<a[^>]+class="result__url"[^>]*[^>]*>([^<]*)<\/a>/gi;
        const titleRegex = /<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

        const urls: string[] = [];
        const titles: string[] = [];
        const snippets: string[] = [];

        while ((match = simpleRegex.exec(html)) !== null) urls.push(stripHtml(match[1] ?? ""));
        while ((match = titleRegex.exec(html)) !== null) titles.push(stripHtml(match[1] ?? ""));
        while ((match = snippetRegex.exec(html)) !== null) snippets.push(stripHtml(match[1] ?? ""));

        const count = Math.min(urls.length, titles.length, snippets.length, maxResults);
        for (let i = 0; i < count; i++) {
          results.push({
            title: titles[i] ?? "",
            url: urls[i]?.startsWith("http") ? urls[i]! : `https://${urls[i] ?? ""}`,
            snippet: snippets[i] ?? "",
            relevance: 1.0 - i * 0.05,
          });
        }
      }

      return results;
    });

    // ── fetch_url ──
    this.handlers.set("fetch_url", async (args) => {
      const url = args["url"] as string;
      const selector = args["selector"] as string | undefined;

      if (!url) throw new Error("fetch_url requires a 'url' argument");

      const response = await safeFetch(url, {
        timeoutMs: this.httpTimeoutMs,
        userAgent: this.userAgent,
      });

      if (!response.ok) {
        throw new Error(`fetch_url failed: HTTP ${response.status} for ${url}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();

      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        const content = selector ? extractBySelector(body, selector) : stripHtml(body);
        // Limit output size to avoid memory issues
        return {
          url,
          contentType,
          content: content.slice(0, 100_000),
          length: content.length,
          truncated: content.length > 100_000,
        };
      }

      // For non-HTML (JSON, plain text, etc.), return raw
      return {
        url,
        contentType,
        content: body.slice(0, 100_000),
        length: body.length,
        truncated: body.length > 100_000,
      };
    });

    // ── monitor_feeds ──
    this.handlers.set("monitor_feeds", async (args) => {
      const feeds = args["feeds"] as string[];
      if (!feeds?.length) throw new Error("monitor_feeds requires a 'feeds' array");

      const allItems: Array<{
        source: string;
        title: string;
        url: string;
        publishedAt: string;
        summary: string;
      }> = [];

      const results = await Promise.allSettled(
        feeds.map(async (feedUrl) => {
          const response = await safeFetch(feedUrl, {
            timeoutMs: this.httpTimeoutMs,
            userAgent: this.userAgent,
          });

          if (!response.ok) {
            return { feedUrl, error: `HTTP ${response.status}`, items: [] };
          }

          const xml = await response.text();
          const parsed = parseXmlFeed(xml);

          return {
            feedUrl,
            items: parsed.map((item) => ({
              source: feedUrl,
              title: item.title,
              url: item.link,
              publishedAt: item.pubDate,
              summary: item.description,
            })),
          };
        }),
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.items.length > 0) {
          allItems.push(...result.value.items);
        }
      }

      // Sort by date (newest first) and limit
      allItems.sort((a, b) => {
        const da = new Date(a.publishedAt).getTime() || 0;
        const db = new Date(b.publishedAt).getTime() || 0;
        return db - da;
      });

      return allItems.slice(0, 50);
    });

    // ── summarize ──
    this.handlers.set("summarize", async (args) => {
      const content = args["content"] as string;
      const maxLength = (args["maxLength"] as number) ?? 200;

      if (!content) throw new Error("summarize requires a 'content' argument");

      // If LLM available, use it for high-quality summarization
      if (this.llm) {
        const response = await this.llm.complete({
          messages: [
            {
              role: "system",
              content: `You are a concise summarizer. Summarize the following content in at most ${maxLength} words. Return only the summary, no preamble.`,
            },
            { role: "user", content: content.slice(0, 50_000) },
          ],
          maxTokens: Math.min(maxLength * 2, 2000),
          temperature: 0.3,
        });
        return {
          summary: response.content,
          originalLength: content.length,
          method: "llm",
        };
      }

      // Fallback: extractive summarization (sentence scoring)
      const sentences = content
        .replace(/([.!?])\s+/g, "$1\n")
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 20);

      if (sentences.length === 0) {
        return {
          summary: content.slice(0, maxLength * 6),
          originalLength: content.length,
          method: "truncation",
        };
      }

      // Score sentences by position and keyword density
      const wordCounts = new Map<string, number>();
      for (const sentence of sentences) {
        for (const word of sentence.toLowerCase().split(/\s+/)) {
          wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
        }
      }

      const scored = sentences.map((sentence, i) => {
        const words = sentence.toLowerCase().split(/\s+/);
        const keywordScore = words.reduce((sum, w) => sum + (wordCounts.get(w) ?? 0), 0) / words.length;
        const positionScore = i < 3 ? 2.0 : i < 10 ? 1.5 : 1.0;
        const lengthPenalty = sentence.length > 300 ? 0.8 : 1.0;
        return { sentence, score: keywordScore * positionScore * lengthPenalty };
      });

      scored.sort((a, b) => b.score - a.score);

      let wordCount = 0;
      const selected: string[] = [];
      for (const { sentence } of scored) {
        const words = sentence.split(/\s+/).length;
        if (wordCount + words > maxLength) break;
        selected.push(sentence);
        wordCount += words;
      }

      // Re-order by original position
      selected.sort((a, b) => sentences.indexOf(a) - sentences.indexOf(b));

      return {
        summary: selected.join(" "),
        originalLength: content.length,
        sentenceCount: selected.length,
        method: "extractive",
      };
    });

    // ── analyze_image ──
    this.handlers.set("analyze_image", async (args) => {
      const url = args["url"] as string;
      const prompt = (args["prompt"] as string) ?? "Describe this image in detail.";

      if (!url) throw new Error("analyze_image requires a 'url' argument");

      if (!this.llm) {
        throw new Error("analyze_image requires an LLM adapter with vision capability. No LLM configured.");
      }

      // Send to LLM with the image URL — most providers support image URLs
      const response = await this.llm.complete({
        messages: [
          {
            role: "system",
            content: "You are an image analysis assistant. Describe and analyze images accurately.",
          },
          {
            role: "user",
            content: `[Image: ${url}]\n\n${prompt}`,
          },
        ],
        maxTokens: 1000,
        temperature: 0.3,
      });

      return {
        url,
        analysis: response.content,
        model: response.model,
      };
    });

    // ── extract_pdf ──
    this.handlers.set("extract_pdf", async (args) => {
      const pdfPath = args["path"] as string;
      const pages = args["pages"] as string | undefined;

      if (!pdfPath) throw new Error("extract_pdf requires a 'path' argument");

      const resolvedPath = resolveAndValidatePath(this.workDir, pdfPath);

      // Check file exists
      try {
        await stat(resolvedPath);
      } catch {
        throw new Error(`PDF file not found: ${resolvedPath}`);
      }

      // Use pdftotext if available (most Unix systems have it via poppler-utils)
      try {
        const pdfArgs = [resolvedPath];
        if (pages) {
          const [first, last] = pages.split("-");
          if (first) pdfArgs.unshift("-f", first);
          if (last) pdfArgs.unshift("-l", last);
        }
        pdfArgs.push("-"); // output to stdout

        const result = await runCommand("pdftotext", pdfArgs, {
          cwd: this.workDir,
          timeoutMs: 30_000,
        });

        if (result.exitCode === 0 && result.stdout.trim()) {
          return {
            path: resolvedPath,
            text: result.stdout.slice(0, 200_000),
            pages,
            method: "pdftotext",
            truncated: result.stdout.length > 200_000,
          };
        }
      } catch {
        // pdftotext not available — fall through to binary read
      }

      // Fallback: read raw bytes and extract visible text (crude but works)
      const buffer = await readFile(resolvedPath);
      const raw = buffer.toString("latin1");

      // Extract text between BT/ET operators (PDF text blocks)
      const textBlocks: string[] = [];
      const btRegex = /BT\s([\s\S]*?)ET/g;
      let btMatch: RegExpExecArray | null;
      while ((btMatch = btRegex.exec(raw)) !== null) {
        const block = btMatch[1] ?? "";
        // Extract text from Tj and TJ operators
        const tjRegex = /\(([^)]*)\)\s*Tj/g;
        let tjMatch: RegExpExecArray | null;
        while ((tjMatch = tjRegex.exec(block)) !== null) {
          if (tjMatch[1]) textBlocks.push(tjMatch[1]);
        }
      }

      const extractedText = textBlocks.join(" ").slice(0, 200_000);

      return {
        path: resolvedPath,
        text: extractedText || "[Could not extract text — install poppler-utils for better PDF support]",
        pages,
        method: "binary-parse",
        truncated: extractedText.length >= 200_000,
      };
    });
  }

  // ── Builder Tools ───────────────────────────────────────────────────────

  private registerBuilderTools(): void {
    // ── generate_code ──
    this.handlers.set("generate_code", async (args) => {
      const spec = args["spec"] as string;
      const language = (args["language"] as string) ?? "typescript";
      const framework = args["framework"] as string | undefined;

      if (!spec) throw new Error("generate_code requires a 'spec' argument");

      if (!this.llm) {
        throw new Error("generate_code requires an LLM adapter. No LLM configured.");
      }

      const systemPrompt = [
        `You are an expert ${language} developer.`,
        framework ? `You are building with ${framework}.` : "",
        "Generate clean, well-documented, production-quality code.",
        "Return only the code with appropriate comments. No markdown fencing.",
      ]
        .filter(Boolean)
        .join(" ");

      const response = await this.llm.complete({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: spec },
        ],
        maxTokens: 8000,
        temperature: 0.4,
      });

      return {
        code: response.content,
        language,
        framework,
        model: response.model,
        tokens: response.usage.totalTokens,
      };
    });

    // ── run_tests ──
    this.handlers.set("run_tests", async (args) => {
      const projectPath = resolveAndValidatePath(this.workDir, (args["projectPath"] as string) ?? ".");
      const testCommand = (args["testCommand"] as string) ?? this.detectTestCommand(projectPath);

      const [cmd, ...cmdArgs] = testCommand.split(/\s+/);
      if (!cmd) throw new Error("Could not determine test command");

      const result = await runCommand(cmd, cmdArgs, {
        cwd: projectPath,
        timeoutMs: this.shellTimeoutMs,
        env: { CI: "true", NODE_ENV: "test" },
      });

      // Parse test output for summary
      const passed = (result.stdout.match(/(\d+)\s*(pass|passed|passing)/i)?.[1]) ?? "?";
      const failed = (result.stdout.match(/(\d+)\s*(fail|failed|failing)/i)?.[1]) ?? "0";

      return {
        command: testCommand,
        exitCode: result.exitCode,
        passed: result.exitCode === 0,
        stdout: result.stdout.slice(-10_000), // Last 10K chars of output
        stderr: result.stderr.slice(-5_000),
        summary: {
          testsRun: passed,
          testsFailed: failed,
          success: result.exitCode === 0,
        },
      };
    });

    // ── lint_code ──
    this.handlers.set("lint_code", async (args) => {
      const projectPath = resolveAndValidatePath(this.workDir, (args["projectPath"] as string) ?? ".");
      const lintCommand = this.detectLintCommand(projectPath);

      const [cmd, ...cmdArgs] = lintCommand.split(/\s+/);
      if (!cmd) throw new Error("Could not determine lint command");

      const result = await runCommand(cmd, cmdArgs, {
        cwd: projectPath,
        timeoutMs: this.shellTimeoutMs,
      });

      // Count issues from output
      const errorCount = (result.stdout.match(/error/gi)?.length ?? 0) + (result.stderr.match(/error/gi)?.length ?? 0);
      const warningCount = (result.stdout.match(/warning/gi)?.length ?? 0);

      return {
        command: lintCommand,
        exitCode: result.exitCode,
        passed: result.exitCode === 0,
        stdout: result.stdout.slice(-10_000),
        stderr: result.stderr.slice(-5_000),
        summary: {
          errors: errorCount,
          warnings: warningCount,
          clean: result.exitCode === 0,
        },
      };
    });

    // ── build_container ──
    this.handlers.set("build_container", async (args) => {
      const dockerfile = (args["dockerfile"] as string) ?? "Dockerfile";
      const tag = (args["tag"] as string) ?? "hivemind-build:latest";

      const resolvedDockerfile = resolveAndValidatePath(this.workDir, dockerfile);
      const context = path.dirname(resolvedDockerfile);

      const result = await runCommand(
        "docker",
        ["build", "-f", resolvedDockerfile, "-t", tag, context],
        {
          cwd: this.workDir,
          timeoutMs: 300_000, // Docker builds can take a while
        },
      );

      return {
        dockerfile: resolvedDockerfile,
        tag,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        output: result.stdout.slice(-10_000),
        errors: result.stderr.slice(-5_000),
      };
    });

    // ── deploy ──
    this.handlers.set("deploy", async (args) => {
      const target = (args["target"] as string) ?? "local";
      const config = (args["config"] as Record<string, unknown>) ?? {};

      let result: { stdout: string; stderr: string; exitCode: number };

      switch (target) {
        case "vercel": {
          const prodFlag = config["production"] ? "--prod" : "";
          result = await runCommand("npx", ["vercel", "deploy", prodFlag].filter(Boolean), {
            cwd: this.workDir,
            timeoutMs: 120_000,
          });
          break;
        }
        case "railway": {
          result = await runCommand("railway", ["up"], {
            cwd: this.workDir,
            timeoutMs: 120_000,
          });
          break;
        }
        case "docker": {
          const image = (config["image"] as string) ?? "hivemind-build:latest";
          const port = (config["port"] as number) ?? 3000;
          result = await runCommand("docker", [
            "run", "-d",
            "-p", `${port}:${port}`,
            "--name", `hivemind-${Date.now().toString(36)}`,
            image,
          ], {
            cwd: this.workDir,
            timeoutMs: 60_000,
          });
          break;
        }
        case "local":
        default: {
          // For local deployment, run npm start or equivalent
          result = await runCommand("npm", ["run", "build"], {
            cwd: this.workDir,
            timeoutMs: 120_000,
          });
          break;
        }
      }

      return {
        target,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        output: result.stdout.slice(-10_000),
        errors: result.stderr.slice(-5_000),
        deployedAt: new Date().toISOString(),
      };
    });
  }

  // ── Sentinel Tools ──────────────────────────────────────────────────────

  private registerSentinelTools(): void {
    // ── check_uptime ──
    this.handlers.set("check_uptime", async (args) => {
      const url = args["url"] as string;
      const expectedStatus = (args["expectedStatus"] as number) ?? 200;

      if (!url) throw new Error("check_uptime requires a 'url' argument");

      const start = Date.now();

      try {
        const response = await safeFetch(url, {
          method: "HEAD",
          timeoutMs: 10_000,
          userAgent: this.userAgent,
        });

        const responseMs = Date.now() - start;
        const statusCode = response.status;
        const isUp = statusCode === expectedStatus;

        return {
          url,
          statusCode,
          expectedStatus,
          isUp,
          responseMs,
          headers: {
            server: response.headers.get("server"),
            contentType: response.headers.get("content-type"),
            cacheControl: response.headers.get("cache-control"),
          },
          checkedAt: new Date().toISOString(),
        };
      } catch (err) {
        const responseMs = Date.now() - start;
        return {
          url,
          statusCode: 0,
          expectedStatus,
          isUp: false,
          responseMs,
          error: err instanceof Error ? err.message : String(err),
          checkedAt: new Date().toISOString(),
        };
      }
    });

    // ── analyze_logs ──
    this.handlers.set("analyze_logs", async (args) => {
      const source = args["source"] as string;
      const pattern = (args["pattern"] as string) ?? "error|fatal|exception|warn";

      if (!source) throw new Error("analyze_logs requires a 'source' argument");

      const resolvedPath = resolveAndValidatePath(this.workDir, source);

      // Check if it's a file path
      try {
        const fileStat = await stat(resolvedPath);
        if (fileStat.isFile()) {
          const content = await readFile(resolvedPath, "utf-8");
          const lines = content.split("\n");
          const regex = new RegExp(pattern, "i");
          const matches = lines
            .map((line, i) => ({ line: i + 1, text: line }))
            .filter((entry) => regex.test(entry.text));

          // Categorize matches
          const errors = matches.filter((m) => /error|fatal/i.test(m.text));
          const warnings = matches.filter((m) => /warn/i.test(m.text));
          const exceptions = matches.filter((m) => /exception/i.test(m.text));

          return {
            source: resolvedPath,
            totalLines: lines.length,
            matchCount: matches.length,
            matches: matches.slice(0, 100).map((m) => ({
              line: m.line,
              text: m.text.slice(0, 500),
            })),
            summary: {
              errors: errors.length,
              warnings: warnings.length,
              exceptions: exceptions.length,
            },
            truncated: matches.length > 100,
          };
        }
      } catch {
        // Not a file — try running as a log command
      }

      // If not a file, try to read system logs (journalctl or similar)
      try {
        const result = await runCommand(
          "journalctl",
          ["-u", source, "-n", "200", "--no-pager", "--grep", pattern],
          { cwd: this.workDir, timeoutMs: 10_000 },
        );

        if (result.exitCode === 0) {
          const lines = result.stdout.split("\n").filter(Boolean);
          return {
            source,
            method: "journalctl",
            matchCount: lines.length,
            matches: lines.slice(0, 100).map((text, i) => ({ line: i + 1, text: text.slice(0, 500) })),
            truncated: lines.length > 100,
          };
        }
      } catch {
        // journalctl not available
      }

      throw new Error(`Could not read logs from "${source}" — provide a valid file path or systemd service name.`);
    });

    // ── security_scan ──
    this.handlers.set("security_scan", async (args) => {
      const target = (args["target"] as string) ?? ".";
      const scanType = (args["scanType"] as string) ?? "deps";

      const results: Record<string, unknown> = { target, scanType };

      switch (scanType) {
        case "deps": {
          // Run npm audit for dependency vulnerabilities
          const projectPath = resolveAndValidatePath(this.workDir, target === "all" ? "." : target);
          const auditResult = await runCommand("npm", ["audit", "--json"], {
            cwd: projectPath,
            timeoutMs: 60_000,
          });

          try {
            const auditData = JSON.parse(auditResult.stdout) as Record<string, unknown>;
            results["vulnerabilities"] = (auditData as any).metadata?.vulnerabilities ?? {};
            results["totalDependencies"] = (auditData as any).metadata?.totalDependencies ?? 0;
            results["advisories"] = Object.keys((auditData as any).advisories ?? (auditData as any).vulnerabilities ?? {}).length;
          } catch {
            results["raw"] = auditResult.stdout.slice(0, 5_000);
          }
          results["exitCode"] = auditResult.exitCode;
          break;
        }
        case "headers": {
          // Check security headers on a URL
          if (!target.startsWith("http")) {
            throw new Error("Security header scan requires a URL target");
          }
          const response = await safeFetch(target, {
            method: "HEAD",
            timeoutMs: 10_000,
            userAgent: this.userAgent,
          });

          const securityHeaders = [
            "strict-transport-security",
            "content-security-policy",
            "x-content-type-options",
            "x-frame-options",
            "x-xss-protection",
            "referrer-policy",
            "permissions-policy",
          ];

          const headerResults: Record<string, string | null> = {};
          const missing: string[] = [];
          for (const header of securityHeaders) {
            const value = response.headers.get(header);
            headerResults[header] = value;
            if (!value) missing.push(header);
          }

          results["headers"] = headerResults;
          results["missingHeaders"] = missing;
          results["score"] = ((securityHeaders.length - missing.length) / securityHeaders.length * 100).toFixed(0) + "%";
          break;
        }
        case "ports": {
          // Simple port scan using netcat or /dev/tcp
          const commonPorts = [22, 80, 443, 3000, 5432, 6379, 8080, 8443, 27017];
          const openPorts: number[] = [];

          for (const port of commonPorts) {
            try {
              const result = await runCommand(
                "nc",
                ["-z", "-w1", target, String(port)],
                { timeoutMs: 3_000 },
              );
              if (result.exitCode === 0) openPorts.push(port);
            } catch {
              // Port closed or nc not available
            }
          }

          results["openPorts"] = openPorts;
          results["scannedPorts"] = commonPorts;
          break;
        }
        default:
          throw new Error(`Unknown scan type: ${scanType}. Supported: deps, headers, ports`);
      }

      return results;
    });

    // ── performance_check ──
    this.handlers.set("performance_check", async (args) => {
      const url = args["url"] as string;
      const samples = Math.min((args["samples"] as number) ?? 5, 20);

      if (!url) throw new Error("performance_check requires a 'url' argument");

      const timings: number[] = [];
      const statusCodes: number[] = [];
      let contentLength = 0;

      for (let i = 0; i < samples; i++) {
        const start = Date.now();
        try {
          const response = await safeFetch(url, {
            timeoutMs: 15_000,
            userAgent: this.userAgent,
          });
          const elapsed = Date.now() - start;
          timings.push(elapsed);
          statusCodes.push(response.status);

          if (i === 0) {
            const body = await response.text();
            contentLength = body.length;
          } else {
            // Consume body to free resources
            await response.text();
          }
        } catch (err) {
          timings.push(Date.now() - start);
          statusCodes.push(0);
        }
      }

      const sortedTimings = [...timings].sort((a, b) => a - b);
      const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
      const median = sortedTimings[Math.floor(sortedTimings.length / 2)] ?? 0;
      const p95 = sortedTimings[Math.floor(sortedTimings.length * 0.95)] ?? sortedTimings[sortedTimings.length - 1] ?? 0;
      const min = sortedTimings[0] ?? 0;
      const max = sortedTimings[sortedTimings.length - 1] ?? 0;
      const successRate = statusCodes.filter((c) => c >= 200 && c < 400).length / samples;

      return {
        url,
        samples,
        timing: {
          mean: Math.round(mean),
          median,
          p95,
          min,
          max,
        },
        successRate: `${(successRate * 100).toFixed(1)}%`,
        contentLength,
        statusCodes,
        checkedAt: new Date().toISOString(),
      };
    });
  }

  // ── Oracle Tools ────────────────────────────────────────────────────────

  private registerOracleTools(): void {
    // ── analyze_trend ──
    this.handlers.set("analyze_trend", async (args) => {
      const series = args["series"] as unknown;
      const windowSize = (args["windowSize"] as number) ?? 10;

      // Accept both a series name (string) or direct data array
      let values: number[];

      if (Array.isArray(series)) {
        values = series.map((p: any) => typeof p === "number" ? p : p.value ?? 0);
      } else if (typeof series === "string") {
        // When called from OracleAgent, the series name is passed.
        // The agent should have ingested data. Return a stub indicating
        // the caller should pass actual data.
        return {
          series,
          error: "Pass numeric data array, not a series name. Use Oracle.ingest() then pass the data directly.",
          direction: "stable",
          slope: 0,
          confidence: 0,
          periodMs: 0,
        };
      } else {
        throw new Error("analyze_trend requires a 'series' argument (array of numbers or data points)");
      }

      if (values.length < 2) {
        return { direction: "stable", slope: 0, confidence: 0, periodMs: 0 };
      }

      // Simple Moving Average
      const window = Math.min(windowSize, values.length);
      const sma: number[] = [];
      for (let i = window - 1; i < values.length; i++) {
        const windowSlice = values.slice(i - window + 1, i + 1);
        sma.push(windowSlice.reduce((a, b) => a + b, 0) / window);
      }

      // Linear regression on SMA for slope
      const n = sma.length;
      const xMean = (n - 1) / 2;
      const yMean = sma.reduce((a, b) => a + b, 0) / n;

      let numerator = 0;
      let denominator = 0;
      for (let i = 0; i < n; i++) {
        numerator += (i - xMean) * ((sma[i] ?? 0) - yMean);
        denominator += (i - xMean) ** 2;
      }
      const slope = denominator !== 0 ? numerator / denominator : 0;

      // R-squared for confidence
      const yHat = sma.map((_, i) => yMean + slope * (i - xMean));
      const ssRes = sma.reduce((sum, y, i) => sum + (y - (yHat[i] ?? 0)) ** 2, 0);
      const ssTot = sma.reduce((sum, y) => sum + (y - yMean) ** 2, 0);
      const rSquared = ssTot !== 0 ? 1 - ssRes / ssTot : 0;

      // Classify direction
      let direction: string;
      const normalizedSlope = Math.abs(yMean) > 0 ? slope / Math.abs(yMean) : slope;
      if (Math.abs(normalizedSlope) < 0.01) direction = "stable";
      else if (normalizedSlope > 0) direction = "rising";
      else direction = "falling";

      // Volatility check
      const stdDev = Math.sqrt(sma.reduce((sum, y) => sum + (y - yMean) ** 2, 0) / n);
      const cv = Math.abs(yMean) > 0 ? stdDev / Math.abs(yMean) : 0;
      if (cv > 0.5 && Math.abs(normalizedSlope) < 0.05) direction = "volatile";

      return {
        direction,
        slope: parseFloat(slope.toFixed(6)),
        confidence: parseFloat(Math.max(0, Math.min(1, rSquared)).toFixed(3)),
        periodMs: 0, // Would need timestamps for real periodicity
        sma: sma.slice(-10).map((v) => parseFloat(v.toFixed(3))),
        mean: parseFloat(yMean.toFixed(3)),
        stdDev: parseFloat(stdDev.toFixed(3)),
      };
    });

    // ── forecast ──
    this.handlers.set("forecast", async (args) => {
      const series = args["series"] as unknown;
      const horizon = (args["horizon"] as number) ?? 5;

      let values: number[];
      if (Array.isArray(series)) {
        values = series.map((p: any) => typeof p === "number" ? p : p.value ?? 0);
      } else {
        throw new Error("forecast requires a 'series' argument (array of numbers or data points)");
      }

      if (values.length < 3) {
        throw new Error("forecast requires at least 3 data points");
      }

      // Linear regression
      const n = values.length;
      const xMean = (n - 1) / 2;
      const yMean = values.reduce((a, b) => a + b, 0) / n;

      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - xMean) * ((values[i] ?? 0) - yMean);
        den += (i - xMean) ** 2;
      }
      const slope = den !== 0 ? num / den : 0;
      const intercept = yMean - slope * xMean;

      // Calculate residual standard error for confidence bands
      const residuals = values.map((v, i) => v - (intercept + slope * i));
      const rse = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (n - 2));

      // Generate predictions
      const predictions: Array<{ timestamp: number; value: number; lower: number; upper: number }> = [];
      const now = Date.now();
      for (let i = 0; i < horizon; i++) {
        const x = n + i;
        const predicted = intercept + slope * x;
        // Widen confidence interval as we go further out
        const band = rse * 1.96 * Math.sqrt(1 + (1 / n) + ((x - xMean) ** 2) / den);

        predictions.push({
          timestamp: now + i * 3_600_000, // 1 hour intervals
          value: parseFloat(predicted.toFixed(3)),
          lower: parseFloat((predicted - band).toFixed(3)),
          upper: parseFloat((predicted + band).toFixed(3)),
        });
      }

      // R-squared
      const ssRes = residuals.reduce((sum, r) => sum + r * r, 0);
      const ssTot = values.reduce((sum, v) => sum + (v - yMean) ** 2, 0);
      const rSquared = ssTot !== 0 ? 1 - ssRes / ssTot : 0;

      return {
        predictions,
        model: "linear-regression",
        accuracy: parseFloat(Math.max(0, Math.min(1, rSquared)).toFixed(3)),
        horizon,
        slope: parseFloat(slope.toFixed(6)),
        intercept: parseFloat(intercept.toFixed(3)),
      };
    });

    // ── sentiment_analysis ──
    this.handlers.set("sentiment_analysis", async (args) => {
      const text = args["text"] as string;
      const granularity = (args["granularity"] as string) ?? "document";

      if (!text) throw new Error("sentiment_analysis requires a 'text' argument");

      // Use LLM for high-quality sentiment analysis
      if (this.llm) {
        const response = await this.llm.complete({
          messages: [
            {
              role: "system",
              content: `You are a sentiment analysis system. Analyze the sentiment of the given text.
Return a JSON object with these fields:
- score: number from -1.0 (very negative) to 1.0 (very positive)
- magnitude: number from 0.0 (low emotion) to 1.0 (high emotion)
- label: one of "positive", "negative", "neutral", "mixed"
- breakdown: object mapping aspects/topics to their individual scores (-1.0 to 1.0)
Return ONLY the JSON object, no other text.`,
            },
            { role: "user", content: text.slice(0, 10_000) },
          ],
          maxTokens: 500,
          temperature: 0.1,
          responseFormat: "json",
        });

        try {
          const parsed = JSON.parse(response.content) as Record<string, unknown>;
          return {
            ...parsed,
            method: "llm",
            model: response.model,
          };
        } catch {
          // LLM returned non-JSON, fall through to lexicon
        }
      }

      // Fallback: lexicon-based sentiment analysis
      const positiveWords = new Set([
        "good", "great", "excellent", "amazing", "wonderful", "fantastic", "love",
        "best", "perfect", "happy", "beautiful", "awesome", "brilliant", "superb",
        "outstanding", "positive", "improved", "success", "win", "benefit",
        "efficient", "elegant", "innovative", "remarkable", "impressive", "delightful",
      ]);
      const negativeWords = new Set([
        "bad", "terrible", "awful", "horrible", "worst", "hate", "ugly", "poor",
        "failure", "broken", "error", "bug", "crash", "slow", "expensive",
        "negative", "problem", "issue", "wrong", "difficult", "pain", "frustrating",
        "disappointing", "useless", "annoying", "confusing", "complicated", "risky",
      ]);

      const words = text.toLowerCase().split(/\s+/);
      let posCount = 0;
      let negCount = 0;

      for (const word of words) {
        const cleaned = word.replace(/[^a-z]/g, "");
        if (positiveWords.has(cleaned)) posCount++;
        if (negativeWords.has(cleaned)) negCount++;
      }

      const total = posCount + negCount || 1;
      const score = (posCount - negCount) / total;
      const magnitude = total / words.length;

      let label: string;
      if (Math.abs(score) < 0.1) label = "neutral";
      else if (score > 0.1 && negCount > 0 && negCount / total > 0.25) label = "mixed";
      else if (score > 0) label = "positive";
      else label = "negative";

      return {
        score: parseFloat(score.toFixed(3)),
        magnitude: parseFloat(Math.min(1, magnitude).toFixed(3)),
        label,
        breakdown: { positive: posCount, negative: negCount, total: words.length },
        method: "lexicon",
      };
    });

    // ── detect_anomalies ──
    this.handlers.set("detect_anomalies", async (args) => {
      const series = args["series"] as unknown;
      const sensitivity = (args["sensitivity"] as number) ?? 0.8;

      let values: number[];
      if (Array.isArray(series)) {
        values = series.map((p: any) => typeof p === "number" ? p : p.value ?? 0);
      } else {
        throw new Error("detect_anomalies requires a 'series' argument (array of numbers or data points)");
      }

      if (values.length < 5) {
        return { anomalies: [], message: "Need at least 5 data points for anomaly detection" };
      }

      // Z-score based anomaly detection
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);

      // Threshold based on sensitivity (higher sensitivity = lower threshold)
      const zThreshold = 3.0 - sensitivity * 2.0; // sensitivity 0.8 -> threshold 1.4

      const anomalies: Array<{ index: number; value: number; zScore: number; deviation: string }> = [];

      for (let i = 0; i < values.length; i++) {
        const v = values[i]!;
        const zScore = stdDev !== 0 ? Math.abs(v - mean) / stdDev : 0;
        if (zScore > zThreshold) {
          anomalies.push({
            index: i,
            value: v,
            zScore: parseFloat(zScore.toFixed(3)),
            deviation: v > mean ? "above" : "below",
          });
        }
      }

      // Also check for sudden changes (rate-of-change anomalies)
      const rateAnomalies: Array<{ index: number; change: number; from: number; to: number }> = [];
      for (let i = 1; i < values.length; i++) {
        const prev = values[i - 1]!;
        const curr = values[i]!;
        const change = Math.abs(curr - prev);
        const normalizedChange = stdDev !== 0 ? change / stdDev : 0;
        if (normalizedChange > zThreshold * 1.5) {
          rateAnomalies.push({
            index: i,
            change: parseFloat(normalizedChange.toFixed(3)),
            from: prev,
            to: curr,
          });
        }
      }

      return {
        anomalies,
        rateAnomalies,
        statistics: {
          mean: parseFloat(mean.toFixed(3)),
          stdDev: parseFloat(stdDev.toFixed(3)),
          zThreshold: parseFloat(zThreshold.toFixed(2)),
          totalPoints: values.length,
        },
        sensitivity,
      };
    });
  }

  // ── Courier Tools ───────────────────────────────────────────────────────

  private registerCourierTools(): void {
    // ── send_message ──
    this.handlers.set("send_message", async (args) => {
      const channel = args["channel"] as string;
      const recipient = args["recipient"] as string;
      const body = args["body"] as string;
      const priority = (args["priority"] as string) ?? "normal";

      if (!channel || !body) throw new Error("send_message requires 'channel' and 'body'");

      // Look up webhook URL for the channel
      const webhookUrl = this.webhooks[channel];

      if (webhookUrl) {
        // Send via webhook (works for Slack, Discord, generic webhooks)
        const payload = this.formatWebhookPayload(channel, body, recipient, priority);

        const response = await safeFetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          timeoutMs: this.httpTimeoutMs,
          userAgent: this.userAgent,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Webhook delivery failed (${response.status}): ${errText.slice(0, 500)}`);
        }

        return {
          channel,
          recipient,
          status: "sent",
          method: "webhook",
          statusCode: response.status,
          sentAt: new Date().toISOString(),
        };
      }

      // No webhook configured — log the message for future delivery
      return {
        channel,
        recipient,
        status: "queued",
        method: "local-queue",
        message: `No webhook configured for channel "${channel}". Message queued locally.`,
        body: body.slice(0, 200),
        priority,
        queuedAt: new Date().toISOString(),
      };
    });

    // ── broadcast ──
    this.handlers.set("broadcast", async (args) => {
      const body = args["body"] as string;
      const priority = (args["priority"] as string) ?? "normal";

      if (!body) throw new Error("broadcast requires a 'body' argument");

      const results: Array<{ channel: string; status: string; error?: string }> = [];

      for (const [channel, webhookUrl] of Object.entries(this.webhooks)) {
        try {
          const payload = this.formatWebhookPayload(channel, body, "", priority);
          const response = await safeFetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            timeoutMs: this.httpTimeoutMs,
            userAgent: this.userAgent,
          });

          results.push({
            channel,
            status: response.ok ? "sent" : "failed",
            error: response.ok ? undefined : `HTTP ${response.status}`,
          });
        } catch (err) {
          results.push({
            channel,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const sent = results.filter((r) => r.status === "sent").length;
      const failed = results.filter((r) => r.status === "failed").length;

      return {
        broadcastTo: Object.keys(this.webhooks).length,
        sent,
        failed,
        results,
        sentAt: new Date().toISOString(),
      };
    });

    // ── schedule_message ──
    this.handlers.set("schedule_message", async (args) => {
      const channel = args["channel"] as string;
      const recipient = args["recipient"] as string;
      const body = args["body"] as string;
      const sendAt = args["sendAt"] as number;

      if (!channel || !body || !sendAt) {
        throw new Error("schedule_message requires 'channel', 'body', and 'sendAt'");
      }

      const delayMs = sendAt - Date.now();
      if (delayMs < 0) {
        throw new Error("sendAt must be in the future");
      }

      // Cap at 24 hours for in-process scheduling
      if (delayMs > 86_400_000) {
        return {
          status: "rejected",
          reason: "Cannot schedule more than 24 hours ahead with in-process scheduling.",
          sendAt: new Date(sendAt).toISOString(),
        };
      }

      // Schedule the delivery
      const messageId = `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const timer = setTimeout(async () => {
        try {
          await this.execute({
            tool: "send_message",
            args: { channel, recipient, body, priority: "normal" },
          });
        } catch (err) {
          console.error(`[ToolExecutor] Scheduled message ${messageId} failed:`, err);
        }
      }, delayMs);

      // Prevent the timer from keeping the process alive
      if (timer.unref) timer.unref();

      return {
        messageId,
        channel,
        recipient,
        status: "scheduled",
        sendAt: new Date(sendAt).toISOString(),
        delayMs,
      };
    });

    // ── send_report ──
    this.handlers.set("send_report", async (args) => {
      const report = args["report"] as Record<string, unknown>;
      const channels = args["channels"] as string[] | undefined;

      if (!report) throw new Error("send_report requires a 'report' argument");

      // Format report as a readable message
      const formatted = this.formatReport(report);
      const targetChannels = channels ?? Object.keys(this.webhooks);

      const results: Array<{ channel: string; status: string; error?: string }> = [];

      for (const channel of targetChannels) {
        try {
          const result = await this.execute({
            tool: "send_message",
            args: { channel, recipient: "", body: formatted, priority: "normal" },
          });
          results.push({ channel, status: result.success ? "sent" : "failed", error: result.error });
        } catch (err) {
          results.push({ channel, status: "failed", error: err instanceof Error ? err.message : String(err) });
        }
      }

      return {
        reportType: (report["type"] as string) ?? "unknown",
        channels: targetChannels.length,
        sent: results.filter((r) => r.status === "sent").length,
        failed: results.filter((r) => r.status === "failed").length,
        results,
      };
    });
  }

  // ── Courier Helpers ─────────────────────────────────────────────────────

  /** Format a webhook payload appropriate for the channel type. */
  private formatWebhookPayload(
    channel: string,
    body: string,
    recipient: string,
    priority: string,
  ): Record<string, unknown> {
    // Slack format
    if (channel === "slack" || channel.includes("slack")) {
      return {
        text: body,
        channel: recipient || undefined,
        username: "HIVEMIND",
        icon_emoji: priority === "urgent" ? ":rotating_light:" : ":robot_face:",
      };
    }

    // Discord format
    if (channel === "discord" || channel.includes("discord")) {
      return {
        content: body.slice(0, 2000), // Discord 2000 char limit
        username: "HIVEMIND",
      };
    }

    // Telegram format
    if (channel === "telegram" || channel.includes("telegram")) {
      return {
        chat_id: recipient,
        text: body,
        parse_mode: "Markdown",
      };
    }

    // Generic webhook format
    return {
      text: body,
      recipient,
      priority,
      source: "hivemind",
      timestamp: new Date().toISOString(),
    };
  }

  /** Format a report object as a human-readable message. */
  private formatReport(report: Record<string, unknown>): string {
    const lines: string[] = [];
    const type = (report["type"] as string) ?? "Report";
    lines.push(`=== HIVEMIND ${type.toUpperCase()} ===`);
    lines.push(`Time: ${new Date().toISOString()}`);
    lines.push("");

    for (const [key, value] of Object.entries(report)) {
      if (key === "type" || key === "timestamp") continue;

      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        lines.push(`${key}:`);
        for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
          lines.push(`  ${subKey}: ${JSON.stringify(subValue)}`);
        }
      } else if (Array.isArray(value)) {
        lines.push(`${key}: [${value.length} items]`);
        for (const item of value.slice(0, 5)) {
          lines.push(`  - ${typeof item === "object" ? JSON.stringify(item) : String(item)}`);
        }
        if (value.length > 5) lines.push(`  ... and ${value.length - 5} more`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }

    return lines.join("\n");
  }

  // ── Builder Helpers ─────────────────────────────────────────────────────

  /** Detect the appropriate test command for a project. */
  private detectTestCommand(projectPath: string): string {
    // Check for common test runners
    const checks: Array<{ file: string; command: string }> = [
      { file: "vitest.config.ts", command: "npx vitest run" },
      { file: "vitest.config.js", command: "npx vitest run" },
      { file: "jest.config.ts", command: "npx jest" },
      { file: "jest.config.js", command: "npx jest" },
      { file: "jest.config.json", command: "npx jest" },
      { file: ".mocharc.yml", command: "npx mocha" },
      { file: ".mocharc.json", command: "npx mocha" },
      { file: "pytest.ini", command: "pytest" },
      { file: "setup.py", command: "python -m pytest" },
      { file: "Cargo.toml", command: "cargo test" },
      { file: "go.mod", command: "go test ./..." },
    ];

    for (const check of checks) {
      const fullPath = path.join(projectPath, check.file);
      try {
        // Synchronous check is OK here — it's a one-time detection
        accessSync(fullPath);
        return check.command;
      } catch {
        // File not found, continue
      }
    }

    // Default to npm test
    return "npm test";
  }

  /** Detect the appropriate lint command for a project. */
  private detectLintCommand(projectPath: string): string {
    const checks: Array<{ file: string; command: string }> = [
      { file: ".eslintrc.json", command: "npx eslint . --max-warnings 0" },
      { file: ".eslintrc.js", command: "npx eslint . --max-warnings 0" },
      { file: ".eslintrc.yml", command: "npx eslint . --max-warnings 0" },
      { file: "eslint.config.js", command: "npx eslint . --max-warnings 0" },
      { file: "eslint.config.ts", command: "npx eslint . --max-warnings 0" },
      { file: "biome.json", command: "npx biome check ." },
      { file: ".pylintrc", command: "pylint ." },
      { file: "setup.cfg", command: "flake8" },
      { file: "clippy.toml", command: "cargo clippy" },
      { file: ".golangci.yml", command: "golangci-lint run" },
    ];

    for (const check of checks) {
      const fullPath = path.join(projectPath, check.file);
      try {
        accessSync(fullPath);
        return check.command;
      } catch {
        // File not found, continue
      }
    }

    // Default
    return "npx eslint . --max-warnings 0";
  }
}
