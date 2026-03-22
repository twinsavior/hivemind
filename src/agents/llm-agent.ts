import {
  BaseAgent,
  type AgentIdentity,
  type ThinkResult,
  type ActResult,
  type Observation,
  type ToolCall,
} from "./base-agent.js";
import type { LLMAdapter, CompletionResponse } from "../core/llm.js";

// ── Configuration ────────────────────────────────────────────────────────────

export interface LLMAgentConfig {
  identity: AgentIdentity;
  llm: LLMAdapter;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ── LLM-powered Agent ────────────────────────────────────────────────────────

/**
 * A concrete agent that uses an LLM to think, plan, and act.
 * This is the core building block — it takes a task, reasons about it
 * with the LLM, and returns structured results.
 */
export class LLMAgent extends BaseAgent {
  private llm: LLMAdapter;
  private systemPrompt: string;
  private model?: string;
  private temperature: number;
  private maxTokens: number;
  private lastThought: ThinkResult | null = null;
  private lastResult: ActResult | null = null;
  private conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  constructor(config: LLMAgentConfig) {
    super(config.identity);
    this.llm = config.llm;
    this.systemPrompt = config.systemPrompt;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async think(input: unknown): Promise<ThinkResult> {
    const taskDescription = typeof input === "string"
      ? input
      : (input as any)?.description ?? (input as any)?.objective ?? JSON.stringify(input);

    // Single direct prompt — no multi-turn, no JSON format requests
    const prompt = taskDescription;

    this.conversationHistory = [{ role: "user", content: prompt }];

    // Inject performance profile into system prompt for self-awareness
    const strategyContext = this.getStrategyContext();
    const effectiveSystemPrompt = strategyContext
      ? `${this.systemPrompt}\n\n${strategyContext}`
      : this.systemPrompt;

    const response = await this.llm.complete({
      messages: [
        { role: "system", content: effectiveSystemPrompt },
        ...this.conversationHistory,
      ],
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    });

    this.conversationHistory.push({ role: "assistant", content: response.content });

    this.lastThought = {
      reasoning: response.content,
      plan: [taskDescription],
      toolCalls: [],
      confidence: 0.8,
    };

    this.remember("lastThought", this.lastThought, 300_000);
    return this.lastThought;
  }

  async act(_plan: ThinkResult): Promise<ActResult> {
    // The think step already produced the full response via a single LLM call.
    // No need for a second round-trip — return the thought as the output.
    this.lastResult = {
      toolResults: [],
      output: this.lastThought?.reasoning ?? "",
      nextAction: "report",
    };

    this.remember("lastResult", this.lastResult.output, 300_000);
    return this.lastResult;
  }

  async observe(_context: Record<string, unknown>): Promise<Observation[]> {
    return [{
      source: this.identity.name,
      data: this.lastResult?.output ?? null,
      analysis: "Task execution completed",
      relevance: 1.0,
    }];
  }

  async report(): Promise<Record<string, unknown>> {
    // Persist the task result to long-term memory (no TTL = permanent)
    const output = typeof this.lastResult?.output === "string" ? this.lastResult.output : "";
    if (output.length > 20) {
      const taskLabel = this.lastThought?.plan?.[0] ?? "Task result";
      this.remember(taskLabel.slice(0, 100), output.slice(0, 2000));
    }

    return {
      agent: this.identity.name,
      role: this.identity.role,
      reasoning: this.lastThought?.reasoning ?? "",
      plan: this.lastThought?.plan ?? [],
      confidence: this.lastThought?.confidence ?? 0,
      output,
      timestamp: Date.now(),
    };
  }

  /** Get token usage from the last LLM call. */
  getConversationLength(): number {
    return this.conversationHistory.length;
  }

  /** Clear conversation history to free memory. */
  resetConversation(): void {
    this.conversationHistory = [];
  }

}
