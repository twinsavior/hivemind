/**
 * HIVEMIND Adaptive Strategy
 *
 * Computes per-agent execution strategy adjustments based on their
 * historical performance profile from the LearningLoop.
 *
 * All logic is deterministic — no LLM calls. Strategy adjustments
 * are conservative: small incremental changes derived from statistical
 * evidence, not drastic overhauls.
 */

import type { LearningLoop, PerformanceProfile } from './learning-loop.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface StrategyConfig {
  /** Temperature adjustment based on task type keywords. */
  temperatureByTaskType: Map<string, number>;
  /** Ordered tool preference (which tools to try first). */
  toolPriority: Map<string, string[]>;
  /** Minimum confidence to attempt a task directly vs delegating. */
  delegationThreshold: number;
  /** Maximum retries before escalating to the orchestrator. */
  maxRetriesBeforeEscalate: number;
  /** Token budget allocation ratios across cognitive phases (must sum to 1). */
  tokenBudget: { think: number; act: number; observe: number };
  /** Base temperature for the agent. */
  baseTemperature: number;
}

export interface PreTaskAdjustment {
  /** Adjusted temperature for this specific task (if changed). */
  temperature?: number;
  /** Adjusted max tokens for the task (if changed). */
  maxTokens?: number;
  /** Ordered list of tool names to prefer for this task. */
  toolHints?: string[];
  /** If true, the agent should delegate rather than attempt directly. */
  shouldDelegate?: boolean;
  /** Suggested role to delegate to. */
  delegateTo?: string;
  /** Extra context to prepend to the agent's thinking. */
  strategyContext?: string;
}

// ---------------------------------------------------------------------------
// Default strategy
// ---------------------------------------------------------------------------

function defaultStrategy(): StrategyConfig {
  return {
    temperatureByTaskType: new Map([
      ['research', 0.7],
      ['search', 0.5],
      ['code', 0.3],
      ['analysis', 0.5],
      ['creative', 0.9],
      ['debug', 0.3],
      ['write', 0.7],
    ]),
    toolPriority: new Map(),
    delegationThreshold: 0.4,
    maxRetriesBeforeEscalate: 3,
    tokenBudget: { think: 0.4, act: 0.4, observe: 0.2 },
    baseTemperature: 0.7,
  };
}

// ---------------------------------------------------------------------------
// Adaptive Strategy Engine
// ---------------------------------------------------------------------------

export class AdaptiveStrategy {
  private strategies: Map<string, StrategyConfig> = new Map();

  constructor(private learningLoop: LearningLoop) {}

  /**
   * Compute the optimal strategy for an agent based on its learning profile.
   * This is called periodically (not per-task) to update the cached strategy.
   */
  computeStrategy(agentId: string): StrategyConfig {
    const profile = this.learningLoop.analyzeAgent(agentId);
    const strategy = defaultStrategy();

    // 1. Adjust base temperature based on correction rate / success rate
    //    Lower success rate -> lower temperature (more conservative)
    //    High success rate -> can afford slightly higher temperature
    if (profile.allTime.count >= 5) {
      const rate = profile.allTime.successRate;
      // Map success rate [0.3, 1.0] to temperature adjustment [-0.2, +0.1]
      // Linear interpolation: rate=0.3 -> -0.2, rate=1.0 -> +0.1
      const tempAdjust = -0.2 + (rate - 0.3) * (0.3 / 0.7);
      strategy.baseTemperature = clamp(0.7 + tempAdjust, 0.1, 1.0);
    }

    // 2. Adjust delegation threshold based on success rate
    //    Low success rate -> lower threshold (delegate more aggressively)
    //    High success rate -> higher threshold (handle more directly)
    if (profile.allTime.count >= 10) {
      const rate = profile.allTime.successRate;
      // rate 0.3 -> threshold 0.25 (delegate eagerly)
      // rate 0.9 -> threshold 0.60 (only delegate for clearly unfit tasks)
      strategy.delegationThreshold = clamp(rate * 0.6 + 0.05, 0.2, 0.7);
    }

    // 3. Compute tool priorities from tool performance data
    const toolEntries = Object.entries(profile.toolPerformance);
    if (toolEntries.length > 0) {
      // Sort tools by success rate (descending), then by call count (descending)
      const sorted = toolEntries.sort(([, a], [, b]) => {
        const rateA = a.calls > 0 ? a.successes / a.calls : 0;
        const rateB = b.calls > 0 ? b.successes / b.calls : 0;
        if (Math.abs(rateA - rateB) > 0.1) return rateB - rateA;
        return b.calls - a.calls;
      });

      const preferred = sorted
        .filter(([, s]) => s.calls >= 2 && (s.successes / s.calls) >= 0.6)
        .map(([name]) => name);

      const avoided = sorted
        .filter(([, s]) => s.calls >= 3 && (s.successes / s.calls) < 0.4)
        .map(([name]) => name);

      if (preferred.length > 0) {
        strategy.toolPriority.set('preferred', preferred);
      }
      if (avoided.length > 0) {
        strategy.toolPriority.set('avoided', avoided);
      }
    }

    // 4. Adjust token budget based on where the agent spends time
    //    If the agent is slow, allocate more to thinking (better planning)
    //    If the agent has high success, lean into action
    if (profile.allTime.count >= 10) {
      if (profile.trend === 'declining') {
        // More thinking, less acting — plan more carefully
        strategy.tokenBudget = { think: 0.5, act: 0.35, observe: 0.15 };
      } else if (profile.allTime.successRate >= 0.85) {
        // Can be more action-oriented
        strategy.tokenBudget = { think: 0.3, act: 0.5, observe: 0.2 };
      }
    }

    // 5. Retry policy: fewer retries if agent consistently fails
    if (profile.allTime.count >= 10 && profile.allTime.successRate < 0.4) {
      strategy.maxRetriesBeforeEscalate = 1; // Escalate quickly
    }

    this.strategies.set(agentId, strategy);
    return strategy;
  }

  /**
   * Get pre-task adjustments based on the cached strategy and the
   * specific task description. Called before each task execution.
   */
  applyPreTask(agentId: string, taskDescription: string): PreTaskAdjustment {
    const strategy = this.strategies.get(agentId) ?? this.computeStrategy(agentId);
    const profile = this.learningLoop.getProfile(agentId);
    const adjustment: PreTaskAdjustment = {};

    // 1. Temperature: match task type to temperature map, or use base
    const desc = taskDescription.toLowerCase();
    let matchedTemp: number | undefined;
    for (const [keyword, temp] of strategy.temperatureByTaskType) {
      if (desc.includes(keyword)) {
        matchedTemp = temp;
        break;
      }
    }
    // Blend the task-type temperature with the agent's base temperature
    if (matchedTemp !== undefined) {
      adjustment.temperature = (matchedTemp + strategy.baseTemperature) / 2;
    } else {
      adjustment.temperature = strategy.baseTemperature;
    }

    // 2. Tool hints
    const preferred = strategy.toolPriority.get('preferred');
    const avoided = strategy.toolPriority.get('avoided');
    if (preferred && preferred.length > 0) {
      adjustment.toolHints = preferred;
    }

    // 3. Delegation check — should this agent handle the task?
    if (profile && profile.allTime.count >= 5) {
      // Check if the task description mentions tools the agent is weak at
      if (avoided && avoided.length > 0) {
        const mentionsWeakTool = avoided.some(tool =>
          desc.includes(tool.toLowerCase()),
        );
        if (mentionsWeakTool && profile.allTime.successRate < 0.6) {
          adjustment.shouldDelegate = true;
          // Suggest a role that might be better (heuristic: "builder" for code,
          // "scout" for research, "sentinel" for security)
          adjustment.delegateTo = suggestDelegationTarget(desc);
        }
      }
    }

    // 4. Strategy context — build a short prompt fragment
    const contextLines: string[] = [];
    if (profile && profile.strategyHints.length > 0) {
      contextLines.push('Strategy notes for this task:');
      for (const hint of profile.strategyHints.slice(0, 3)) {
        contextLines.push(`- ${hint}`);
      }
    }
    if (avoided && avoided.length > 0) {
      contextLines.push(`Caution with tools: ${avoided.join(', ')} (low success rate)`);
    }
    if (contextLines.length > 0) {
      adjustment.strategyContext = contextLines.join('\n');
    }

    return adjustment;
  }

  /** Get the cached strategy for an agent. */
  getStrategy(agentId: string): StrategyConfig | undefined {
    return this.strategies.get(agentId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Simple heuristic to suggest a delegation target role based on task keywords. */
function suggestDelegationTarget(taskDescription: string): string {
  const desc = taskDescription.toLowerCase();

  if (desc.includes('code') || desc.includes('build') || desc.includes('implement') || desc.includes('fix')) {
    return 'builder';
  }
  if (desc.includes('research') || desc.includes('search') || desc.includes('find') || desc.includes('discover')) {
    return 'scout';
  }
  if (desc.includes('security') || desc.includes('audit') || desc.includes('review') || desc.includes('check')) {
    return 'sentinel';
  }
  if (desc.includes('analyze') || desc.includes('predict') || desc.includes('recommend')) {
    return 'oracle';
  }
  if (desc.includes('send') || desc.includes('notify') || desc.includes('report') || desc.includes('deliver')) {
    return 'courier';
  }

  return 'builder'; // default fallback
}
