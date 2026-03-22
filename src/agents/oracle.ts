import {
  BaseAgent,
  type AgentIdentity,
  type ThinkResult,
  type ActResult,
  type Observation,
  type ToolCall,
} from "./base-agent.js";

interface DataPoint {
  timestamp: number;
  value: number;
  label?: string;
  metadata?: Record<string, unknown>;
}

interface TrendAnalysis {
  direction: "rising" | "falling" | "stable" | "volatile";
  slope: number;
  confidence: number;
  periodMs: number;
}

interface Forecast {
  predictions: Array<{ timestamp: number; value: number; lower: number; upper: number }>;
  model: string;
  accuracy: number;
  horizon: number;
}

interface SentimentResult {
  score: number;       // -1.0 to 1.0
  magnitude: number;   // 0.0 to 1.0
  label: "positive" | "negative" | "neutral" | "mixed";
  breakdown: Record<string, number>;
}

interface ConsensusVote {
  agentId: string;
  position: string;
  confidence: number;
  reasoning: string;
  timestamp: number;
}

/** Prediction, analysis, and consensus agent. Performs trend analysis, forecasting, and swarm decision-making. */
export class OracleAgent extends BaseAgent {
  private dataStore: Map<string, DataPoint[]> = new Map();
  private consensusPool: ConsensusVote[] = [];
  private forecasts: Map<string, Forecast> = new Map();

  constructor(id?: string) {
    const identity: AgentIdentity = {
      id: id ?? `oracle-${Date.now().toString(36)}`,
      name: "Oracle",
      role: "analysis",
      version: "1.0.0",
    };
    super(identity);

    this.capabilities = [
      {
        name: "analyze_trend",
        description: "Analyze time-series data for trends and patterns",
        parameters: {
          series: { type: "string", required: true, description: "Named data series to analyze" },
          windowSize: { type: "number", required: false, description: "Rolling window size" },
        },
      },
      {
        name: "forecast",
        description: "Generate predictions for a data series",
        parameters: {
          series: { type: "string", required: true, description: "Data series to forecast" },
          horizon: { type: "number", required: true, description: "Number of periods to predict" },
        },
      },
      {
        name: "sentiment_analysis",
        description: "Analyze sentiment of text content",
        parameters: {
          text: { type: "string", required: true, description: "Text to analyze" },
          granularity: { type: "string", required: false, description: "Sentence or document level" },
        },
      },
      {
        name: "detect_anomalies",
        description: "Detect anomalies in a data series",
        parameters: {
          series: { type: "string", required: true, description: "Data series to check" },
          sensitivity: { type: "number", required: false, description: "Detection sensitivity 0-1" },
        },
      },
    ];
  }

  /** Ingest data points into a named series for analysis. */
  ingest(seriesName: string, points: DataPoint[]): void {
    const existing = this.dataStore.get(seriesName) ?? [];
    existing.push(...points);
    existing.sort((a, b) => a.timestamp - b.timestamp);
    this.dataStore.set(seriesName, existing);
  }

  /** Submit a vote to the swarm consensus mechanism. */
  submitVote(vote: ConsensusVote): void {
    this.consensusPool.push(vote);
  }

  /** Resolve consensus from all submitted votes using weighted confidence scoring. */
  resolveConsensus(): { position: string; confidence: number; votes: number; dissent: number } | null {
    if (this.consensusPool.length === 0) return null;

    const positionScores = new Map<string, { totalConfidence: number; count: number }>();
    for (const vote of this.consensusPool) {
      const entry = positionScores.get(vote.position) ?? { totalConfidence: 0, count: 0 };
      entry.totalConfidence += vote.confidence;
      entry.count++;
      positionScores.set(vote.position, entry);
    }

    let bestPosition = "";
    let bestScore = -1;
    for (const [position, { totalConfidence }] of positionScores) {
      if (totalConfidence > bestScore) {
        bestScore = totalConfidence;
        bestPosition = position;
      }
    }

    const winner = positionScores.get(bestPosition)!;
    const totalVotes = this.consensusPool.length;

    return {
      position: bestPosition,
      confidence: winner.totalConfidence / totalVotes,
      votes: winner.count,
      dissent: totalVotes - winner.count,
    };
  }

  async think(input: unknown): Promise<ThinkResult> {
    const task = input as { action?: string; series?: string; text?: string; horizon?: number };
    const toolCalls: ToolCall[] = [];

    if (task.series && this.dataStore.has(task.series)) {
      toolCalls.push({ tool: "analyze_trend", args: { series: task.series, windowSize: 10 } });
      toolCalls.push({ tool: "detect_anomalies", args: { series: task.series, sensitivity: 0.8 } });

      if (task.horizon) {
        toolCalls.push({ tool: "forecast", args: { series: task.series, horizon: task.horizon } });
      }
    }

    if (task.text) {
      toolCalls.push({ tool: "sentiment_analysis", args: { text: task.text, granularity: "document" } });
    }

    return {
      reasoning: `Analyzing ${task.series ?? "input"} with ${toolCalls.length} analytical passes`,
      plan: toolCalls.map((tc) => `Run ${tc.tool}`),
      toolCalls,
      confidence: this.dataStore.has(task.series ?? "") ? 0.85 : 0.6,
    };
  }

  async act(plan: ThinkResult): Promise<ActResult> {
    const toolResults = [];
    let trend: TrendAnalysis | null = null;
    let sentiment: SentimentResult | null = null;

    for (const call of plan.toolCalls) {
      const result = await this.callTool(call);
      toolResults.push(result);

      if (result.success) {
        if (call.tool === "analyze_trend") trend = result.data as TrendAnalysis;
        if (call.tool === "sentiment_analysis") sentiment = result.data as SentimentResult;
        if (call.tool === "forecast") {
          const forecast = result.data as Forecast;
          this.forecasts.set(call.args["series"] as string, forecast);
        }
      }
    }

    if (trend) this.remember("last_trend", trend, 1_800_000);
    if (sentiment) this.remember("last_sentiment", sentiment, 1_800_000);

    return { toolResults, output: { trend, sentiment }, nextAction: "report" };
  }

  async observe(context: Record<string, unknown>): Promise<Observation[]> {
    const observations: Observation[] = [];

    for (const [name, points] of this.dataStore) {
      if (points.length < 3) continue;

      const recent = points.slice(-10);
      const values = recent.map((p) => p.value);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
      const cv = stdDev / (Math.abs(mean) || 1);

      if (cv > 0.5) {
        observations.push({
          source: `series:${name}`,
          data: { mean, stdDev, cv, sampleSize: values.length },
          analysis: `High volatility detected in "${name}" (CV: ${cv.toFixed(2)})`,
          relevance: Math.min(cv, 1.0),
        });
      }
    }

    const consensus = this.resolveConsensus();
    if (consensus) {
      observations.push({
        source: "consensus",
        data: consensus,
        analysis: `Consensus reached: "${consensus.position}" (${consensus.votes} votes, confidence: ${consensus.confidence.toFixed(2)})`,
        relevance: consensus.confidence,
      });
    }

    return observations;
  }

  async report(): Promise<Record<string, unknown>> {
    const seriesStats: Record<string, unknown> = {};
    for (const [name, points] of this.dataStore) {
      seriesStats[name] = { points: points.length, latest: points[points.length - 1] };
    }

    return {
      agent: this.identity.id,
      type: "analysis_report",
      seriesCount: this.dataStore.size,
      seriesStats,
      activeForecastCount: this.forecasts.size,
      consensusPool: this.consensusPool.length,
      consensus: this.resolveConsensus(),
      lastTrend: this.recall("last_trend"),
      lastSentiment: this.recall("last_sentiment"),
      timestamp: Date.now(),
    };
  }
}
