import {
  BaseAgent,
  type AgentIdentity,
  type ThinkResult,
  type ActResult,
  type Observation,
  type ToolCall,
  type ToolResult,
} from "./base-agent.js";
import {
  MultiModalEngine,
  type ImageAnalysis,
  type AudioTranscription,
  type DocumentExtraction,
} from "../core/multimodal.js";
import type { LLMAdapter } from "../core/llm.js";
import { createVisionProvider } from "../core/vision-provider.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  relevance: number;
}

interface FeedItem {
  source: string;
  title: string;
  url: string;
  publishedAt: string;
  summary: string;
}

interface ResearchBrief {
  query: string;
  sources: SearchResult[];
  feeds: FeedItem[];
  insights: string[];
  summary: string;
  confidence: number;
  timestamp: number;
  /** Multi-modal analysis results, keyed by input path/URL. */
  multiModalResults?: Record<string, ImageAnalysis | AudioTranscription | DocumentExtraction>;
}

export interface ScoutConfig {
  id?: string;
  llm?: LLMAdapter;
  openaiApiKey?: string;
}

/** Research and intelligence gathering agent. Specializes in web search, document analysis, multi-modal processing, and insight extraction. */
export class ScoutAgent extends BaseAgent {
  private activeBrief: ResearchBrief | null = null;
  private feedUrls: string[] = [];
  private multiModal: MultiModalEngine;

  constructor(config?: ScoutConfig | string) {
    // Support both old (just id string) and new (config object) constructor signatures
    const cfg: ScoutConfig =
      typeof config === "string" ? { id: config } : config ?? {};

    const identity: AgentIdentity = {
      id: cfg.id ?? `scout-${Date.now().toString(36)}`,
      name: "Scout",
      role: "research",
      version: "2.0.0",
    };
    super(identity);

    // Initialize multi-modal engine with available providers
    const visionProvider = createVisionProvider({
      openaiApiKey: cfg.openaiApiKey,
    });

    this.multiModal = new MultiModalEngine({
      llm: cfg.llm,
      visionProvider: visionProvider ?? undefined,
      openaiApiKey: cfg.openaiApiKey,
    });

    this.capabilities = [
      {
        name: "web_search",
        description: "Search the web for information on a topic",
        parameters: {
          query: { type: "string", required: true, description: "Search query" },
          maxResults: { type: "number", required: false, description: "Maximum results to return" },
        },
      },
      {
        name: "fetch_url",
        description: "Fetch and extract content from a URL",
        parameters: {
          url: { type: "string", required: true, description: "URL to fetch" },
          selector: { type: "string", required: false, description: "CSS selector to extract" },
        },
      },
      {
        name: "monitor_feeds",
        description: "Monitor RSS/Atom feeds for new entries",
        parameters: {
          feeds: { type: "string[]", required: true, description: "Feed URLs to monitor" },
        },
      },
      {
        name: "summarize",
        description: "Summarize a document or collection of data",
        parameters: {
          content: { type: "string", required: true, description: "Content to summarize" },
          maxLength: { type: "number", required: false, description: "Max summary length in words" },
        },
      },
      {
        name: "analyze_image",
        description: "Analyze an image using vision capabilities (describe, detect objects, OCR)",
        parameters: {
          url: { type: "string", required: true, description: "Image URL, file path, or base64 data" },
          prompt: { type: "string", required: false, description: "What to analyze in the image" },
        },
      },
      {
        name: "extract_pdf",
        description: "Extract text, metadata, and structure from a PDF document",
        parameters: {
          path: { type: "string", required: true, description: "Path to the PDF file" },
          pages: { type: "string", required: false, description: "Page range (e.g. '1-5')" },
        },
      },
      {
        name: "capture_screenshot",
        description: "Capture a screenshot of a URL and analyze its visual content",
        parameters: {
          url: { type: "string", required: true, description: "URL to capture and analyze" },
          prompt: { type: "string", required: false, description: "What to look for in the page" },
        },
      },
      {
        name: "transcribe_audio",
        description: "Transcribe audio from a file (mp3, wav, m4a, etc.) to text",
        parameters: {
          path: { type: "string", required: true, description: "Path to the audio file" },
        },
      },
      {
        name: "process_document",
        description: "Process any document type (PDF, image, audio, text) and extract content",
        parameters: {
          path: { type: "string", required: true, description: "Path to the document file" },
        },
      },
    ];
  }

  /** Add RSS/Atom feed URLs for continuous monitoring. */
  addFeeds(urls: string[]): void {
    this.feedUrls.push(...urls);
    this.remember("feed_urls", this.feedUrls);
  }

  /** Provide an LLM adapter after construction (e.g. when the runtime injects it). */
  setLLM(llm: LLMAdapter): void {
    this.multiModal = new MultiModalEngine({
      llm,
      visionProvider: createVisionProvider() ?? undefined,
    });
  }

  /** Keywords that indicate a task requires code generation or file modification. */
  private static readonly CODING_SIGNALS = [
    "code", "implement", "build", "create file", "write file", "edit file",
    "fix bug", "refactor", "deploy", "test", "compile", "generate code",
    "add feature", "modify", "update code", "patch", "commit",
  ];

  /** Check if a task description suggests coding work that should go to Builder. */
  private requiresCoding(text: string): boolean {
    const lower = text.toLowerCase();
    return ScoutAgent.CODING_SIGNALS.some((signal) => lower.includes(signal));
  }

  async think(input: unknown): Promise<ThinkResult> {
    const task = input as {
      objective?: string;
      query?: string;
      urls?: string[];
      changes?: string[];
      images?: string[];
      documents?: string[];
      audio?: string[];
      screenshots?: string[];
    };
    const query = task.query ?? task.objective ?? "general research";

    // If the task requires coding, delegate to Builder — Scout is research-only
    if (this.requiresCoding(query) || task.changes?.length) {
      const reason = task.changes
        ? `Coding task with ${task.changes.length} changes requested`
        : `Task requires code modification: "${query}"`;

      this.delegate("engineering", input, reason);
      this.remember("last_delegation", { targetRole: "engineering", reason });

      return {
        reasoning: `This task requires code changes — delegating to Builder agent. ${reason}`,
        plan: ["Delegate coding task to Builder agent"],
        toolCalls: [],
        confidence: 0.95,
      };
    }

    const toolCalls: ToolCall[] = [];
    const planSteps: string[] = [];

    toolCalls.push({ tool: "web_search", args: { query, maxResults: 10 } });
    planSteps.push("Execute web search for primary query");

    if (task.urls?.length) {
      for (const url of task.urls.slice(0, 5)) {
        toolCalls.push({ tool: "fetch_url", args: { url } });
      }
      planSteps.push(`Fetch and parse ${task.urls.length} URLs`);
    }

    if (this.feedUrls.length > 0) {
      toolCalls.push({ tool: "monitor_feeds", args: { feeds: this.feedUrls } });
      planSteps.push("Check RSS feeds for relevant updates");
    }

    // Multi-modal: analyze images if provided
    if (task.images?.length) {
      for (const img of task.images.slice(0, 5)) {
        toolCalls.push({ tool: "analyze_image", args: { url: img, prompt: query } });
      }
      planSteps.push(`Analyze ${task.images.length} images with vision`);
    }

    // Multi-modal: capture and analyze screenshots
    if (task.screenshots?.length) {
      for (const url of task.screenshots.slice(0, 3)) {
        toolCalls.push({ tool: "capture_screenshot", args: { url, prompt: query } });
      }
      planSteps.push(`Capture and analyze ${task.screenshots.length} screenshots`);
    }

    // Multi-modal: transcribe audio files
    if (task.audio?.length) {
      for (const audioPath of task.audio.slice(0, 3)) {
        toolCalls.push({ tool: "transcribe_audio", args: { path: audioPath } });
      }
      planSteps.push(`Transcribe ${task.audio.length} audio files`);
    }

    // Multi-modal: extract PDF and other document content
    if (task.documents?.length) {
      for (const doc of task.documents.slice(0, 5)) {
        // Route by extension: PDFs use extract_pdf, everything else uses process_document
        if (doc.toLowerCase().endsWith(".pdf")) {
          toolCalls.push({ tool: "extract_pdf", args: { path: doc } });
        } else {
          toolCalls.push({ tool: "process_document", args: { path: doc } });
        }
      }
      planSteps.push(`Extract and analyze ${task.documents.length} documents`);
    }

    planSteps.push("Cross-reference and synthesize findings");
    planSteps.push("Generate research brief with insights");

    const multiModalCount =
      (task.images?.length ?? 0) +
      (task.screenshots?.length ?? 0) +
      (task.audio?.length ?? 0) +
      (task.documents?.length ?? 0);

    return {
      reasoning: `Researching "${query}" — will search the web, fetch ${task.urls?.length ?? 0} URLs, process ${multiModalCount} multi-modal inputs, and check ${this.feedUrls.length} feeds.`,
      plan: planSteps,
      toolCalls,
      confidence: 0.8,
    };
  }

  async act(plan: ThinkResult): Promise<ActResult> {
    const searchResults: SearchResult[] = [];
    const feedItems: FeedItem[] = [];
    const multiModalResults: Record<string, ImageAnalysis | AudioTranscription | DocumentExtraction> = {};
    const toolResults: ToolResult[] = [];

    const failedTools: string[] = [];
    for (const call of plan.toolCalls) {
      // Route multi-modal tool calls through the MultiModalEngine
      const result = await this.executeToolCall(call);
      toolResults.push(result);

      if (!result.success) {
        failedTools.push(`${call.tool}: ${result.error || "unknown error"}`);
      }

      if (result.success && call.tool === "web_search") {
        const data = result.data as SearchResult[] | undefined;
        if (data) searchResults.push(...data);
      }
      if (result.success && call.tool === "monitor_feeds") {
        const data = result.data as FeedItem[] | undefined;
        if (data) feedItems.push(...data);
      }

      // Collect multi-modal results
      if (result.success && result.data) {
        const key =
          (call.args["url"] as string | undefined) ??
          (call.args["path"] as string | undefined);
        if (
          key &&
          (call.tool === "analyze_image" ||
            call.tool === "capture_screenshot" ||
            call.tool === "transcribe_audio" ||
            call.tool === "extract_pdf" ||
            call.tool === "process_document")
        ) {
          multiModalResults[key] = result.data as
            | ImageAnalysis
            | AudioTranscription
            | DocumentExtraction;
        }
      }
    }

    // Surface tool failures so they're visible — don't silently return empty results
    if (failedTools.length > 0 && searchResults.length === 0) {
      console.warn(`[${this.identity.id}] All tools failed: ${failedTools.join("; ")}`);
    }

    // Build multi-modal insights
    const mmInsights = this.extractMultiModalInsights(multiModalResults);

    this.activeBrief = {
      query: plan.reasoning,
      sources: searchResults,
      feeds: feedItems,
      insights: failedTools.length > 0
        ? [
            `Warning: ${failedTools.length} tool(s) failed — research could not be completed. Tool errors: ${failedTools.slice(0, 3).join("; ")}`,
            ...mmInsights,
            ...this.extractInsights(searchResults, feedItems),
          ]
        : [...mmInsights, ...this.extractInsights(searchResults, feedItems)],
      summary: "",
      confidence: failedTools.length > 0 ? 0.1 : plan.confidence,
      timestamp: Date.now(),
      multiModalResults:
        Object.keys(multiModalResults).length > 0 ? multiModalResults : undefined,
    };

    this.remember("last_brief", this.activeBrief, 3_600_000);

    const hasResults =
      searchResults.length > 0 || Object.keys(multiModalResults).length > 0;

    return {
      toolResults,
      output: this.activeBrief,
      nextAction: hasResults ? "observe" : "report",
    };
  }

  /**
   * Execute a tool call, routing multi-modal tools through the MultiModalEngine.
   * Falls back to the base callTool() for non-multi-modal tools (web_search, fetch_url, etc.).
   */
  private async executeToolCall(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();

    try {
      switch (call.tool) {
        case "analyze_image": {
          const url = call.args["url"] as string;
          const prompt = call.args["prompt"] as string | undefined;
          const analysis = await this.multiModal.analyzeImage(url, prompt);
          return {
            tool: call.tool,
            success: true,
            data: analysis,
            durationMs: Date.now() - start,
          };
        }

        case "extract_pdf": {
          const path = call.args["path"] as string;
          const pages = call.args["pages"] as string | undefined;
          const extraction = await this.multiModal.extractPDF(path, pages);
          return {
            tool: call.tool,
            success: true,
            data: extraction,
            durationMs: Date.now() - start,
          };
        }

        case "capture_screenshot": {
          const url = call.args["url"] as string;
          const prompt = call.args["prompt"] as string | undefined;
          const result = await this.multiModal.captureAndAnalyze(url, prompt);
          return {
            tool: call.tool,
            success: true,
            data: result,
            durationMs: Date.now() - start,
          };
        }

        case "transcribe_audio": {
          const path = call.args["path"] as string;
          const transcription = await this.multiModal.transcribeAudio(path);
          return {
            tool: call.tool,
            success: true,
            data: transcription,
            durationMs: Date.now() - start,
          };
        }

        case "process_document": {
          const path = call.args["path"] as string;
          const extraction = await this.multiModal.processDocument(path);
          return {
            tool: call.tool,
            success: true,
            data: extraction,
            durationMs: Date.now() - start,
          };
        }

        default:
          // Non-multi-modal tools — delegate to the base agent's callTool
          return this.callTool(call);
      }
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

  async observe(context: Record<string, unknown>): Promise<Observation[]> {
    const observations: Observation[] = [];

    if (this.activeBrief) {
      observations.push({
        source: "search_results",
        data: this.activeBrief.sources,
        analysis: `Found ${this.activeBrief.sources.length} relevant sources`,
        relevance: this.activeBrief.sources.length > 0 ? 0.9 : 0.2,
      });

      if (this.activeBrief.feeds.length > 0) {
        observations.push({
          source: "rss_feeds",
          data: this.activeBrief.feeds,
          analysis: `${this.activeBrief.feeds.length} new feed items detected`,
          relevance: 0.7,
        });
      }

      // Multi-modal observations
      if (this.activeBrief.multiModalResults) {
        const mmResults = this.activeBrief.multiModalResults;
        const mmCount = Object.keys(mmResults).length;

        observations.push({
          source: "multimodal_analysis",
          data: mmResults,
          analysis: `Processed ${mmCount} multi-modal input(s): ${Object.keys(mmResults).map((k) => k.split("/").pop() ?? k).join(", ")}`,
          relevance: 0.85,
        });
      }
    }

    return observations;
  }

  async report(): Promise<Record<string, unknown>> {
    if (!this.activeBrief) {
      // Check if we delegated the task
      const lastDelegation = this.recall("last_delegation") as
        | { targetRole: string; reason: string }
        | undefined;
      if (lastDelegation) {
        return {
          agent: this.identity.id,
          type: "delegation_notice",
          status: "delegated",
          delegatedTo: lastDelegation.targetRole,
          reason: lastDelegation.reason,
          message: `Task delegated to ${lastDelegation.targetRole} agent — this requires capabilities outside Scout's research scope.`,
          timestamp: Date.now(),
        };
      }
      return { status: "no_data", message: "No research conducted yet" };
    }

    const brief = this.activeBrief;
    return {
      agent: this.identity.id,
      type: "research_brief",
      query: brief.query,
      sourceCount: brief.sources.length,
      feedItemCount: brief.feeds.length,
      multiModalCount: brief.multiModalResults
        ? Object.keys(brief.multiModalResults).length
        : 0,
      insights: brief.insights,
      topSources: brief.sources.slice(0, 5).map((s) => ({ title: s.title, url: s.url })),
      multiModalSummary: brief.multiModalResults
        ? Object.entries(brief.multiModalResults).map(([key, value]) => ({
            input: key,
            type: "text" in value && "language" in value
              ? "audio_transcription"
              : "description" in value
                ? "image_analysis"
                : "document_extraction",
            preview: this.summarizeMultiModalResult(value),
          }))
        : undefined,
      confidence: brief.confidence,
      timestamp: brief.timestamp,
    };
  }

  private extractInsights(sources: SearchResult[], feeds: FeedItem[]): string[] {
    const insights: string[] = [];
    const highRelevance = sources.filter((s) => s.relevance > 0.7);

    if (highRelevance.length > 0) {
      insights.push(`${highRelevance.length} highly relevant sources identified`);
    }
    if (feeds.length > 0) {
      const recentFeeds = feeds.filter((f) => {
        const age = Date.now() - new Date(f.publishedAt).getTime();
        return age < 86_400_000; // last 24 hours
      });
      if (recentFeeds.length > 0) {
        insights.push(`${recentFeeds.length} feed items published in the last 24 hours`);
      }
    }
    if (sources.length === 0) {
      insights.push("No search results found — consider broadening the query");
    }

    return insights;
  }

  /** Extract insights from multi-modal analysis results. */
  private extractMultiModalInsights(
    results: Record<string, ImageAnalysis | AudioTranscription | DocumentExtraction>,
  ): string[] {
    const insights: string[] = [];

    for (const [key, result] of Object.entries(results)) {
      const shortKey = key.split("/").pop() ?? key;

      if ("description" in result && "objects" in result) {
        // ImageAnalysis
        const img = result as ImageAnalysis;
        if (img.objects.length > 0) {
          insights.push(
            `Image "${shortKey}": detected ${img.objects.length} objects (${img.objects.slice(0, 5).join(", ")})`,
          );
        }
        if (img.text) {
          insights.push(
            `Image "${shortKey}": OCR extracted ${img.text.length} characters of text`,
          );
        }
      } else if ("language" in result && "segments" in result) {
        // AudioTranscription
        const audio = result as AudioTranscription;
        insights.push(
          `Audio "${shortKey}": transcribed ${Math.round(audio.durationMs / 1000)}s of ${audio.language} speech (${audio.segments.length} segments)`,
        );
      } else if ("pages" in result) {
        // DocumentExtraction
        const doc = result as DocumentExtraction;
        insights.push(
          `Document "${shortKey}": extracted ${doc.text.length} characters from ${doc.pages} page(s)`,
        );
        if (doc.tables?.length) {
          insights.push(
            `Document "${shortKey}": found ${doc.tables.length} table(s)`,
          );
        }
      }
    }

    return insights;
  }

  /** Create a short preview string for a multi-modal result. */
  private summarizeMultiModalResult(
    result: ImageAnalysis | AudioTranscription | DocumentExtraction,
  ): string {
    if ("description" in result && "objects" in result) {
      return (result as ImageAnalysis).description.slice(0, 200);
    }
    if ("language" in result && "segments" in result) {
      return (result as AudioTranscription).text.slice(0, 200);
    }
    if ("pages" in result) {
      return (result as DocumentExtraction).text.slice(0, 200);
    }
    return "[unknown format]";
  }
}
