/**
 * HIVEMIND Learning Loop
 *
 * Self-improvement engine that analyzes agent performance over time,
 * detects trends, identifies strengths/weaknesses, and generates
 * actionable strategy hints that get injected into agent system prompts.
 *
 * All analysis is deterministic (moving averages, z-scores, linear
 * regression) — no LLM calls, so it runs in <1ms per analysis.
 */

import type { MetricsTracker, AgentMetrics } from './agent-metrics.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface LearningInsight {
  agentId: string;
  type: 'strength' | 'weakness' | 'pattern' | 'recommendation';
  description: string;
  evidence: Record<string, unknown>;
  actionable: boolean;
  suggestedAction?: string;
  confidence: number; // 0–1
  timestamp: number;
}

export interface PerformanceProfile {
  agentId: string;
  agentName: string;
  role: string;
  /** Windowed performance snapshots. */
  last10Tasks: { successRate: number; avgTimeMs: number; count: number };
  last50Tasks: { successRate: number; avgTimeMs: number; count: number };
  allTime: { successRate: number; avgTimeMs: number; count: number };
  /** Trend determined by linear regression on success-rate moving average. */
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  /** Slope of the trend line (positive = improving). */
  trendSlope: number;
  /** Identified insights from analysis. */
  insights: LearningInsight[];
  /** Short strategy hints injected into the agent's system prompt. */
  strategyHints: string[];
  /** Per-tool success rates (tool name -> { calls, successes, avgMs }). */
  toolPerformance: Record<string, { calls: number; successes: number; avgMs: number }>;
  generatedAt: number;
}

export interface TaskOutcome {
  taskId: string;
  agentId: string;
  description: string;
  success: boolean;
  durationMs: number;
  tokensUsed: number;
  toolsUsed: string[];
  toolFailures: string[];
  delegations: string[];
  errorMessage?: string;
  timestamp: number;
}

export interface LearningState {
  outcomes: Record<string, TaskOutcome[]>;
  insights: LearningInsight[];
}

// ---------------------------------------------------------------------------
// Math utilities (pure functions, no external deps)
// ---------------------------------------------------------------------------

/** Compute simple mean of an array. Returns 0 for empty arrays. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Compute standard deviation (population). */
function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sumSq = 0;
  for (const v of values) sumSq += (v - m) ** 2;
  return Math.sqrt(sumSq / values.length);
}

/**
 * Simple linear regression: y = slope * x + intercept.
 * x values are implicitly 0, 1, 2, ... (index-based).
 * Returns { slope, intercept, r2 }.
 */
function linearRegression(yValues: number[]): { slope: number; intercept: number; r2: number } {
  const n = yValues.length;
  if (n < 2) return { slope: 0, intercept: yValues[0] ?? 0, r2: 0 };

  // x = 0, 1, 2, ..., n-1
  const xMean = (n - 1) / 2;
  const yMean = mean(yValues);

  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;

  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    const dy = (yValues[i] ?? 0) - yMean;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }

  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = yMean - slope * xMean;
  const r2 = ssXX === 0 || ssYY === 0 ? 0 : (ssXY * ssXY) / (ssXX * ssYY);

  return { slope, intercept, r2 };
}

/**
 * Compute an exponentially weighted moving average for a series.
 * Alpha controls how much weight recent values get (0.1 = slow, 0.5 = fast).
 */
function ewma(values: number[], alpha: number = 0.3): number[] {
  if (values.length === 0) return [];
  const result: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    result.push(alpha * (values[i] ?? 0) + (1 - alpha) * result[i - 1]!);
  }
  return result;
}

/**
 * Z-score: how many standard deviations a value is from the mean.
 * Returns 0 if stddev is 0 (all values identical).
 */
function zScore(value: number, m: number, sd: number): number {
  return sd === 0 ? 0 : (value - m) / sd;
}

// ---------------------------------------------------------------------------
// Learning Loop
// ---------------------------------------------------------------------------

export class LearningLoop {
  private outcomes: Map<string, TaskOutcome[]> = new Map();
  private profiles: Map<string, PerformanceProfile> = new Map();
  private insights: LearningInsight[] = [];
  private maxOutcomesPerAgent: number;
  private maxInsights: number;

  constructor(
    private metrics: MetricsTracker,
    options?: { maxOutcomesPerAgent?: number; maxInsights?: number },
  ) {
    this.maxOutcomesPerAgent = options?.maxOutcomesPerAgent ?? 200;
    this.maxInsights = options?.maxInsights ?? 500;
  }

  // -----------------------------------------------------------------------
  // Recording
  // -----------------------------------------------------------------------

  /** Record a completed task outcome with full context. */
  recordOutcome(outcome: TaskOutcome): void {
    const agentOutcomes = this.outcomes.get(outcome.agentId) ?? [];
    agentOutcomes.push(outcome);

    // Sliding window — keep last N outcomes
    if (agentOutcomes.length > this.maxOutcomesPerAgent) {
      agentOutcomes.splice(0, agentOutcomes.length - this.maxOutcomesPerAgent);
    }
    this.outcomes.set(outcome.agentId, agentOutcomes);

    // Also record in MetricsTracker for aggregate stats
    if (outcome.success) {
      this.metrics.recordSuccess(outcome.agentId, outcome.durationMs, outcome.tokensUsed);
    } else {
      this.metrics.recordFailure(outcome.agentId);
    }

    // Record per-tool metrics
    for (const tool of outcome.toolsUsed) {
      const failed = outcome.toolFailures.includes(tool);
      this.metrics.recordToolUse(outcome.agentId, tool, !failed, outcome.durationMs);
    }

    // Record delegations
    for (const _del of outcome.delegations) {
      this.metrics.recordDelegation(outcome.agentId);
    }

    // Trigger analysis after every 5 outcomes
    if (agentOutcomes.length % 5 === 0) {
      this.analyzeAgent(outcome.agentId);
    }
  }

  // -----------------------------------------------------------------------
  // Analysis
  // -----------------------------------------------------------------------

  /** Analyze an agent's performance and generate a fresh profile. */
  analyzeAgent(agentId: string): PerformanceProfile {
    const outcomes = this.outcomes.get(agentId) ?? [];
    const metricsData = this.metrics.get(agentId);

    const agentName = metricsData?.agentName ?? agentId;
    const role = agentId; // role gets overridden by caller if known

    // -- Windowed performance --
    const last10 = this.computeWindow(outcomes, 10);
    const last50 = this.computeWindow(outcomes, 50);
    const allTime = this.computeWindow(outcomes, outcomes.length);

    // -- Trend analysis via linear regression on rolling success rate --
    const trend = this.computeTrend(outcomes);

    // -- Per-tool performance --
    const toolPerformance = this.computeToolPerformance(outcomes);

    // -- Generate insights --
    const newInsights = this.generateInsights(agentId, outcomes, last10, last50, allTime, toolPerformance, trend);

    // -- Generate strategy hints --
    const strategyHints = this.generateStrategyHints(newInsights, toolPerformance, trend, allTime);

    const profile: PerformanceProfile = {
      agentId,
      agentName,
      role,
      last10Tasks: last10,
      last50Tasks: last50,
      allTime,
      trend: trend.direction,
      trendSlope: trend.slope,
      insights: newInsights,
      strategyHints,
      toolPerformance,
      generatedAt: Date.now(),
    };

    this.profiles.set(agentId, profile);

    // Add to global insights list
    for (const insight of newInsights) {
      this.insights.push(insight);
    }
    // Cap total insights
    if (this.insights.length > this.maxInsights) {
      this.insights.splice(0, this.insights.length - this.maxInsights);
    }

    return profile;
  }

  /** Get the cached profile for an agent (call analyzeAgent first). */
  getProfile(agentId: string): PerformanceProfile | undefined {
    return this.profiles.get(agentId);
  }

  /** Get all insights across all agents. */
  getAllInsights(): LearningInsight[] {
    return [...this.insights];
  }

  // -----------------------------------------------------------------------
  // Self-awareness prompt generation
  // -----------------------------------------------------------------------

  /**
   * Generate a system prompt fragment that gives an agent awareness
   * of its own performance, injected before task execution.
   */
  generateSelfAwarenessPrompt(agentId: string): string {
    const profile = this.profiles.get(agentId);
    if (!profile || profile.allTime.count === 0) return '';

    const lines: string[] = ['## Your Performance Profile'];

    // Overall stats
    const rate = (profile.allTime.successRate * 100).toFixed(0);
    const trendEmoji = profile.trend === 'improving' ? '(improving)'
      : profile.trend === 'declining' ? '(declining)'
      : profile.trend === 'stable' ? '(stable)'
      : '(not enough data)';
    lines.push(`Success rate: ${rate}% over ${profile.allTime.count} tasks ${trendEmoji}`);

    // Recent performance vs all-time
    if (profile.last10Tasks.count >= 5) {
      const recent = (profile.last10Tasks.successRate * 100).toFixed(0);
      lines.push(`Recent (last ${profile.last10Tasks.count}): ${recent}% success`);
    }

    // Average response time
    if (profile.allTime.avgTimeMs > 0) {
      const avgSec = (profile.allTime.avgTimeMs / 1000).toFixed(1);
      lines.push(`Average task time: ${avgSec}s`);
    }

    // Strengths
    const strengths = profile.insights.filter(i => i.type === 'strength');
    if (strengths.length > 0) {
      lines.push('');
      lines.push('Strengths:');
      for (const s of strengths.slice(0, 3)) {
        lines.push(`- ${s.description}`);
      }
    }

    // Weaknesses
    const weaknesses = profile.insights.filter(i => i.type === 'weakness');
    if (weaknesses.length > 0) {
      lines.push('');
      lines.push('Weaknesses:');
      for (const w of weaknesses.slice(0, 3)) {
        const action = w.suggestedAction ? ` -> ${w.suggestedAction}` : '';
        lines.push(`- ${w.description}${action}`);
      }
    }

    // Patterns
    const patterns = profile.insights.filter(i => i.type === 'pattern');
    if (patterns.length > 0) {
      lines.push('');
      lines.push('Observed patterns:');
      for (const p of patterns.slice(0, 3)) {
        lines.push(`- ${p.description}`);
      }
    }

    // Strategy hints
    if (profile.strategyHints.length > 0) {
      lines.push('');
      lines.push('Strategy adjustments:');
      for (const hint of profile.strategyHints.slice(0, 5)) {
        lines.push(`- ${hint}`);
      }
    }

    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  /** Get the full learning state for serialization. */
  getState(): LearningState {
    const outcomesObj: Record<string, TaskOutcome[]> = {};
    for (const [agentId, outcomeList] of this.outcomes) {
      outcomesObj[agentId] = outcomeList;
    }
    return { outcomes: outcomesObj, insights: this.insights };
  }

  /** Restore from persisted state. */
  loadState(state: LearningState): void {
    this.outcomes.clear();
    for (const [agentId, outcomeList] of Object.entries(state.outcomes)) {
      this.outcomes.set(agentId, outcomeList);
    }
    this.insights = state.insights ?? [];

    // Re-analyze all agents to rebuild profiles
    for (const agentId of this.outcomes.keys()) {
      this.analyzeAgent(agentId);
    }
  }

  // -----------------------------------------------------------------------
  // Private: windowed stats
  // -----------------------------------------------------------------------

  private computeWindow(
    outcomes: TaskOutcome[],
    windowSize: number,
  ): { successRate: number; avgTimeMs: number; count: number } {
    if (outcomes.length === 0) {
      return { successRate: 0, avgTimeMs: 0, count: 0 };
    }

    const window = outcomes.slice(-windowSize);
    const successes = window.filter(o => o.success).length;
    const successRate = window.length > 0 ? successes / window.length : 0;
    const durations = window.map(o => o.durationMs);
    const avgTimeMs = mean(durations);

    return { successRate, avgTimeMs, count: window.length };
  }

  // -----------------------------------------------------------------------
  // Private: trend detection
  // -----------------------------------------------------------------------

  private computeTrend(outcomes: TaskOutcome[]): {
    direction: PerformanceProfile['trend'];
    slope: number;
    r2: number;
  } {
    // Need at least 10 outcomes to detect a meaningful trend
    if (outcomes.length < 10) {
      return { direction: 'insufficient_data', slope: 0, r2: 0 };
    }

    // Build a rolling success rate series using windows of 5
    const windowSize = 5;
    const rollingRates: number[] = [];
    for (let i = windowSize; i <= outcomes.length; i++) {
      const window = outcomes.slice(i - windowSize, i);
      const successes = window.filter(o => o.success).length;
      rollingRates.push(successes / windowSize);
    }

    if (rollingRates.length < 3) {
      return { direction: 'insufficient_data', slope: 0, r2: 0 };
    }

    // Apply EWMA smoothing to reduce noise
    const smoothed = ewma(rollingRates, 0.3);

    // Linear regression on the smoothed series
    const { slope, r2 } = linearRegression(smoothed);

    // Classify the trend:
    // - slope > 0.005 with r2 > 0.1 = improving
    // - slope < -0.005 with r2 > 0.1 = declining
    // - otherwise stable
    const slopeThreshold = 0.005;
    const r2Threshold = 0.1;

    let direction: PerformanceProfile['trend'] = 'stable';
    if (r2 > r2Threshold) {
      if (slope > slopeThreshold) direction = 'improving';
      else if (slope < -slopeThreshold) direction = 'declining';
    }

    return { direction, slope, r2 };
  }

  // -----------------------------------------------------------------------
  // Private: per-tool performance
  // -----------------------------------------------------------------------

  private computeToolPerformance(
    outcomes: TaskOutcome[],
  ): Record<string, { calls: number; successes: number; avgMs: number }> {
    const toolStats = new Map<string, { calls: number; successes: number; totalMs: number }>();

    for (const outcome of outcomes) {
      for (const tool of outcome.toolsUsed) {
        const current = toolStats.get(tool) ?? { calls: 0, successes: 0, totalMs: 0 };
        current.calls++;
        if (!outcome.toolFailures.includes(tool)) {
          current.successes++;
        }
        // Approximate per-tool time by splitting outcome duration across tools
        const toolCount = outcome.toolsUsed.length || 1;
        current.totalMs += outcome.durationMs / toolCount;
        toolStats.set(tool, current);
      }
    }

    const result: Record<string, { calls: number; successes: number; avgMs: number }> = {};
    for (const [tool, stats] of toolStats) {
      result[tool] = {
        calls: stats.calls,
        successes: stats.successes,
        avgMs: stats.calls > 0 ? stats.totalMs / stats.calls : 0,
      };
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Private: insight generation
  // -----------------------------------------------------------------------

  private generateInsights(
    agentId: string,
    outcomes: TaskOutcome[],
    last10: { successRate: number; avgTimeMs: number; count: number },
    last50: { successRate: number; avgTimeMs: number; count: number },
    allTime: { successRate: number; avgTimeMs: number; count: number },
    toolPerf: Record<string, { calls: number; successes: number; avgMs: number }>,
    trend: { direction: string; slope: number; r2: number },
  ): LearningInsight[] {
    const now = Date.now();
    const insights: LearningInsight[] = [];

    if (outcomes.length < 3) return insights;

    // 1. Tool-level strengths and weaknesses
    for (const [tool, stats] of Object.entries(toolPerf)) {
      if (stats.calls < 3) continue; // Need enough data

      const toolRate = stats.successes / stats.calls;

      if (toolRate >= 0.9 && stats.calls >= 5) {
        insights.push({
          agentId,
          type: 'strength',
          description: `${tool}: ${(toolRate * 100).toFixed(0)}% success rate (${stats.calls} uses)`,
          evidence: { tool, successRate: toolRate, calls: stats.calls },
          actionable: false,
          confidence: Math.min(0.5 + stats.calls * 0.05, 0.95),
          timestamp: now,
        });
      }

      if (toolRate < 0.5) {
        insights.push({
          agentId,
          type: 'weakness',
          description: `${tool}: only ${(toolRate * 100).toFixed(0)}% success rate (${stats.calls} uses)`,
          evidence: { tool, successRate: toolRate, calls: stats.calls },
          actionable: true,
          suggestedAction: `Consider delegating tasks requiring ${tool} to a more capable agent`,
          confidence: Math.min(0.5 + stats.calls * 0.05, 0.95),
          timestamp: now,
        });
      }
    }

    // 2. Recent performance vs all-time (detect regression / improvement)
    if (last10.count >= 5 && allTime.count >= 15) {
      const diff = last10.successRate - allTime.successRate;

      if (diff < -0.15) {
        insights.push({
          agentId,
          type: 'pattern',
          description: `Recent performance dropped: ${(last10.successRate * 100).toFixed(0)}% vs ${(allTime.successRate * 100).toFixed(0)}% all-time`,
          evidence: {
            recentRate: last10.successRate,
            allTimeRate: allTime.successRate,
            delta: diff,
          },
          actionable: true,
          suggestedAction: 'Review recent task types for increased complexity or new failure modes',
          confidence: 0.8,
          timestamp: now,
        });
      }

      if (diff > 0.15) {
        insights.push({
          agentId,
          type: 'pattern',
          description: `Recent performance improved: ${(last10.successRate * 100).toFixed(0)}% vs ${(allTime.successRate * 100).toFixed(0)}% all-time`,
          evidence: {
            recentRate: last10.successRate,
            allTimeRate: allTime.successRate,
            delta: diff,
          },
          actionable: false,
          confidence: 0.8,
          timestamp: now,
        });
      }
    }

    // 3. Speed analysis: detect slowdown
    if (last10.count >= 5 && allTime.count >= 15 && allTime.avgTimeMs > 0) {
      const speedRatio = last10.avgTimeMs / allTime.avgTimeMs;
      if (speedRatio > 1.5) {
        insights.push({
          agentId,
          type: 'pattern',
          description: `Tasks taking ${speedRatio.toFixed(1)}x longer than average recently`,
          evidence: {
            recentAvgMs: last10.avgTimeMs,
            allTimeAvgMs: allTime.avgTimeMs,
            ratio: speedRatio,
          },
          actionable: true,
          suggestedAction: 'Break complex tasks into smaller sub-tasks to reduce execution time',
          confidence: 0.7,
          timestamp: now,
        });
      }
    }

    // 4. Delegation pattern analysis
    const delegationOutcomes = outcomes.filter(o => o.delegations.length > 0);
    if (delegationOutcomes.length >= 3) {
      const delegationRate = delegationOutcomes.length / outcomes.length;

      if (delegationRate > 0.5) {
        insights.push({
          agentId,
          type: 'pattern',
          description: `High delegation rate: ${(delegationRate * 100).toFixed(0)}% of tasks delegated`,
          evidence: {
            delegationRate,
            totalTasks: outcomes.length,
            delegatedTasks: delegationOutcomes.length,
          },
          actionable: true,
          suggestedAction: 'Handle more tasks directly instead of delegating — you may be over-relying on others',
          confidence: 0.75,
          timestamp: now,
        });
      }
    }

    // 5. Error pattern detection — find recurring error messages
    const failedOutcomes = outcomes.filter(o => !o.success && o.errorMessage);
    if (failedOutcomes.length >= 3) {
      const errorCounts = new Map<string, number>();
      for (const o of failedOutcomes) {
        // Normalize error messages (take first 80 chars)
        const normalized = (o.errorMessage ?? '').slice(0, 80).toLowerCase();
        errorCounts.set(normalized, (errorCounts.get(normalized) ?? 0) + 1);
      }

      for (const [error, count] of errorCounts) {
        if (count >= 2) {
          insights.push({
            agentId,
            type: 'weakness',
            description: `Recurring error (${count}x): "${error}"`,
            evidence: { error, count, totalFailures: failedOutcomes.length },
            actionable: true,
            suggestedAction: `This error has occurred ${count} times — investigate root cause or avoid triggering conditions`,
            confidence: Math.min(0.6 + count * 0.1, 0.95),
            timestamp: now,
          });
        }
      }
    }

    // 6. Multi-tool complexity correlation
    if (outcomes.length >= 10) {
      const simpleOutcomes = outcomes.filter(o => o.toolsUsed.length <= 2);
      const complexOutcomes = outcomes.filter(o => o.toolsUsed.length > 3);

      if (simpleOutcomes.length >= 3 && complexOutcomes.length >= 3) {
        const simpleRate = simpleOutcomes.filter(o => o.success).length / simpleOutcomes.length;
        const complexRate = complexOutcomes.filter(o => o.success).length / complexOutcomes.length;

        if (simpleRate - complexRate > 0.2) {
          insights.push({
            agentId,
            type: 'pattern',
            description: `Complex tasks (>3 tools) succeed ${(complexRate * 100).toFixed(0)}% vs ${(simpleRate * 100).toFixed(0)}% for simple tasks`,
            evidence: {
              simpleRate,
              complexRate,
              simpleCount: simpleOutcomes.length,
              complexCount: complexOutcomes.length,
            },
            actionable: true,
            suggestedAction: 'For tasks requiring many tools, break into sequential sub-tasks with fewer tools each',
            confidence: 0.8,
            timestamp: now,
          });
        }
      }
    }

    // 7. Token efficiency analysis
    if (outcomes.length >= 10) {
      const tokensPerTask = outcomes.filter(o => o.tokensUsed > 0).map(o => o.tokensUsed);
      if (tokensPerTask.length >= 5) {
        const tokenMean = mean(tokensPerTask);
        const tokenStd = stddev(tokensPerTask);
        const recent5 = tokensPerTask.slice(-5);
        const recentMean = mean(recent5);

        const z = zScore(recentMean, tokenMean, tokenStd);
        if (z > 1.5) {
          insights.push({
            agentId,
            type: 'pattern',
            description: `Token usage increased: recent avg ${Math.round(recentMean)} vs overall avg ${Math.round(tokenMean)} (z=${z.toFixed(1)})`,
            evidence: { recentMean, overallMean: tokenMean, zScore: z },
            actionable: true,
            suggestedAction: 'Allocate more tokens to the thinking phase; reduce verbose tool outputs',
            confidence: 0.7,
            timestamp: now,
          });
        }
      }
    }

    return insights;
  }

  // -----------------------------------------------------------------------
  // Private: strategy hint generation
  // -----------------------------------------------------------------------

  private generateStrategyHints(
    insights: LearningInsight[],
    toolPerf: Record<string, { calls: number; successes: number; avgMs: number }>,
    trend: { direction: string; slope: number; r2: number },
    allTime: { successRate: number; avgTimeMs: number; count: number },
  ): string[] {
    const hints: string[] = [];

    // Hint based on declining trend
    if (trend.direction === 'declining' && trend.r2 > 0.2) {
      hints.push('Performance is declining — be more conservative, verify outputs before returning');
    }

    // Hint based on overall success rate
    if (allTime.count >= 10) {
      if (allTime.successRate < 0.6) {
        hints.push('Overall success rate is low — prefer simpler approaches and ask for clarification when uncertain');
      } else if (allTime.successRate >= 0.9) {
        hints.push('Success rate is high — you can take on more complex tasks with confidence');
      }
    }

    // Tool-specific hints: build avoid/prefer lists
    const weakTools: string[] = [];
    const strongTools: string[] = [];

    for (const [tool, stats] of Object.entries(toolPerf)) {
      if (stats.calls < 3) continue;
      const rate = stats.successes / stats.calls;
      if (rate < 0.5) weakTools.push(tool);
      if (rate >= 0.9 && stats.calls >= 5) strongTools.push(tool);
    }

    if (weakTools.length > 0) {
      hints.push(`Avoid or delegate when task requires: ${weakTools.join(', ')}`);
    }
    if (strongTools.length > 0) {
      hints.push(`Leverage your strengths: ${strongTools.join(', ')}`);
    }

    // Actionable insight summaries
    for (const insight of insights.filter(i => i.actionable && i.suggestedAction)) {
      // De-duplicate — don't repeat tool-level hints
      if (insight.suggestedAction && !hints.some(h => h.includes(insight.suggestedAction!.slice(0, 30)))) {
        hints.push(insight.suggestedAction);
      }
      if (hints.length >= 7) break; // Cap at 7 hints
    }

    return hints;
  }
}
