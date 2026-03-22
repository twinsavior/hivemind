import * as path from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export type GuardrailTiming = 'pre-execution' | 'post-execution' | 'both';
export type GuardrailSeverity = 'block' | 'warn' | 'log';

export interface GuardrailResult {
  passed: boolean;
  guardrailName: string;
  severity: GuardrailSeverity;
  message: string;
  details?: Record<string, unknown>;
}

export interface Guardrail {
  name: string;
  description: string;
  timing: GuardrailTiming;
  severity: GuardrailSeverity;
  /** The check function. Returns true if the check passes (content is safe). */
  check: (input: GuardrailInput) => Promise<boolean> | boolean;
  /** Optional custom message when the check fails */
  failMessage?: string;
}

export interface GuardrailInput {
  content: string;
  agentId: string;
  taskDescription: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

// ── GuardrailEngine ──────────────────────────────────────────────────────────

/**
 * Configurable engine for running pluggable validation functions alongside
 * the cognitive loop. Extends the existing trust system with runtime checks
 * on agent inputs and outputs.
 */
export class GuardrailEngine {
  private guardrails: Map<string, Guardrail> = new Map();

  /** Register a guardrail. Overwrites any existing guardrail with the same name. */
  register(guardrail: Guardrail): void {
    this.guardrails.set(guardrail.name, guardrail);
  }

  /** Unregister a guardrail by name. No-op if the name is not registered. */
  unregister(name: string): void {
    this.guardrails.delete(name);
  }

  /**
   * Run all guardrails matching the given timing against the provided input.
   * Guardrails with timing 'both' run for either 'pre-execution' or 'post-execution'.
   *
   * @param input  - The content and metadata to validate.
   * @param timing - When this evaluation is happening in the cognitive loop.
   * @returns Array of results, one per matching guardrail.
   */
  async evaluate(input: GuardrailInput, timing: GuardrailTiming): Promise<GuardrailResult[]> {
    const results: GuardrailResult[] = [];

    for (const guardrail of this.guardrails.values()) {
      if (guardrail.timing !== timing && guardrail.timing !== 'both') {
        continue;
      }

      try {
        const passed = await guardrail.check(input);
        results.push({
          passed,
          guardrailName: guardrail.name,
          severity: guardrail.severity,
          message: passed
            ? `${guardrail.name}: passed`
            : guardrail.failMessage ?? `${guardrail.name}: check failed`,
        });
      } catch (err) {
        // A guardrail that throws is treated as a failure
        results.push({
          passed: false,
          guardrailName: guardrail.name,
          severity: guardrail.severity,
          message: `${guardrail.name}: error — ${err instanceof Error ? err.message : String(err)}`,
          details: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    return results;
  }

  /** Check if any blocking guardrail failed in the given results. */
  hasBlockingFailure(results: GuardrailResult[]): boolean {
    return results.some((r) => !r.passed && r.severity === 'block');
  }

  /** Get all registered guardrails as an array. */
  list(): Guardrail[] {
    return [...this.guardrails.values()];
  }
}

// ── Built-in Guardrail: PII Detection ────────────────────────────────────────

/** Patterns that match common PII formats. */
const PII_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: 'phone', pattern: /(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'credit_card', pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g },
];

/** Detects potential PII in agent output (emails, phone numbers, SSNs, credit cards). */
export const piiDetectionGuardrail: Guardrail = {
  name: 'pii-detection',
  description: 'Detects potential PII in agent output (emails, phone numbers, SSNs, credit cards)',
  timing: 'post-execution',
  severity: 'warn',
  failMessage: 'Potential PII detected in agent output',
  check(input: GuardrailInput): boolean {
    for (const { pattern } of PII_PATTERNS) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      if (pattern.test(input.content)) {
        return false;
      }
    }
    return true;
  },
};

// ── Built-in Guardrail: Cost Limit ───────────────────────────────────────────

/**
 * Enforces token/cost budget limits per task.
 * Tracks cumulative token counts via metadata.tokensUsed.
 *
 * @param maxTokens - Maximum tokens allowed per task.
 */
export const costLimitGuardrail = (maxTokens: number): Guardrail => ({
  name: 'cost-limit',
  description: `Enforces a token budget of ${maxTokens} tokens per task`,
  timing: 'pre-execution',
  severity: 'block',
  failMessage: `Token budget exceeded (limit: ${maxTokens})`,
  check(input: GuardrailInput): boolean {
    const tokensUsed = input.metadata?.['tokensUsed'];
    if (typeof tokensUsed !== 'number') {
      // No token data available — pass (can't enforce without data)
      return true;
    }
    return tokensUsed <= maxTokens;
  },
});

// ── Built-in Guardrail: Content Safety ───────────────────────────────────────

/** Patterns indicating potentially harmful content. Case-insensitive. */
const CONTENT_SAFETY_PATTERNS: RegExp[] = [
  /\b(?:kill|murder|assassinate)\s+(?:yourself|himself|herself|themselves|someone|people)\b/i,
  /\bhow\s+to\s+(?:make|build|create)\s+(?:a\s+)?(?:bomb|explosive|weapon)\b/i,
  /\bstep[- ]?by[- ]?step\s+(?:guide|instructions?)\s+(?:to|for)\s+(?:harm|hurt|kill)\b/i,
  /\b(?:hate|exterminate|eliminate)\s+(?:all\s+)?(?:jews|muslims|christians|blacks|whites|asians|hispanics|gays|lesbians|transgender)\b/i,
  /\bi\s+(?:will|am going to|want to)\s+(?:kill|harm|hurt|attack)\b/i,
  /\b(?:cut|slit)\s+(?:your|my|their)\s+(?:wrists?|throat)\b/i,
  /\b(?:commit|committing)\s+suicide\b/i,
  /\bdetailed\s+(?:instructions?|guide|steps?)\s+(?:for|to|on)\s+(?:self[- ]?harm|suicide)\b/i,
];

/** Prevents agents from outputting harmful or toxic content patterns. */
export const contentSafetyGuardrail: Guardrail = {
  name: 'content-safety',
  description: 'Prevents agents from outputting harmful or toxic content patterns',
  timing: 'both',
  severity: 'block',
  failMessage: 'Content safety violation detected',
  check(input: GuardrailInput): boolean {
    for (const pattern of CONTENT_SAFETY_PATTERNS) {
      if (pattern.test(input.content)) {
        return false;
      }
    }
    return true;
  },
};

// ── Built-in Guardrail: Loop Detection ───────────────────────────────────────

/**
 * Simple string similarity using character bigram overlap (Dice coefficient).
 * Returns a value between 0 (no similarity) and 1 (identical).
 * Designed to be fast (<1ms for typical agent outputs).
 */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.slice(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.slice(i, i + 2);
    const count = bigramsA.get(bigram);
    if (count !== undefined && count > 0) {
      bigramsA.set(bigram, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

/** Per-agent output history for loop detection. */
const agentOutputHistory = new Map<string, string[]>();

/** Maximum number of recent outputs to track per agent. */
const LOOP_HISTORY_SIZE = 5;

/** Similarity threshold above which two outputs are considered "the same". */
const LOOP_SIMILARITY_THRESHOLD = 0.8;

/** Minimum number of similar outputs to trigger loop detection. */
const LOOP_MIN_REPEATS = 3;

/** Detects when an agent is stuck in a loop (repeating the same output). */
export const loopDetectionGuardrail: Guardrail = {
  name: 'loop-detection',
  description: 'Detects when an agent is stuck in a loop (repeating the same output)',
  timing: 'post-execution',
  severity: 'warn',
  failMessage: 'Agent appears to be stuck in a loop (repeated similar output)',
  check(input: GuardrailInput): boolean {
    const history = agentOutputHistory.get(input.agentId) ?? [];

    // Add the current output to history
    history.push(input.content);
    if (history.length > LOOP_HISTORY_SIZE) {
      history.shift();
    }
    agentOutputHistory.set(input.agentId, history);

    // Need at least LOOP_MIN_REPEATS entries to detect a loop
    if (history.length < LOOP_MIN_REPEATS) {
      return true;
    }

    // Check if the latest output is highly similar to enough previous outputs
    const latest = history[history.length - 1]!;
    let similarCount = 0;

    for (let i = 0; i < history.length - 1; i++) {
      if (diceCoefficient(latest, history[i]!) >= LOOP_SIMILARITY_THRESHOLD) {
        similarCount++;
      }
    }

    // Fail if 3+ outputs (including the current one) are similar
    // similarCount counts how many *previous* outputs match the latest,
    // so we need similarCount >= LOOP_MIN_REPEATS - 1
    return similarCount < LOOP_MIN_REPEATS - 1;
  },
};

/**
 * Clear loop detection history for a specific agent or all agents.
 * Useful for testing or when an agent is reset.
 */
export function clearLoopHistory(agentId?: string): void {
  if (agentId) {
    agentOutputHistory.delete(agentId);
  } else {
    agentOutputHistory.clear();
  }
}

// ── Built-in Guardrail: File Access ──────────────────────────────────────────

/**
 * Validates that file operations stay within allowed directories.
 * Extends the TrustGate.validatePath pattern with guardrail semantics.
 *
 * @param allowedPaths - Array of directory paths that are allowed for file operations.
 */
export const fileAccessGuardrail = (allowedPaths: string[]): Guardrail => ({
  name: 'file-access',
  description: 'Validates that file operations stay within allowed directories',
  timing: 'pre-execution',
  severity: 'block',
  failMessage: 'File operation targets a path outside allowed directories',
  check(input: GuardrailInput): boolean {
    // Only applies to file-related tools
    const fileTools = new Set(['Read', 'Edit', 'Write', 'Glob', 'Grep']);
    if (input.toolName && !fileTools.has(input.toolName)) {
      return true;
    }

    // Extract file paths from content using common patterns
    const pathPatterns = [
      // Absolute paths (Unix-style)
      /(?:^|\s)(\/[^\s"'`]+)/g,
      // Quoted paths
      /"(\/[^"]+)"/g,
      /'(\/[^']+)'/g,
    ];

    const extractedPaths: string[] = [];
    for (const pattern of pathPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(input.content)) !== null) {
        const filePath = match[1];
        if (filePath) {
          extractedPaths.push(filePath);
        }
      }
    }

    // If no paths found, pass (nothing to check)
    if (extractedPaths.length === 0) {
      return true;
    }

    // Validate each extracted path against allowed directories
    for (const filePath of extractedPaths) {
      const resolved = path.resolve(filePath);
      let withinAllowed = false;

      for (const allowedDir of allowedPaths) {
        const resolvedAllowed = path.resolve(allowedDir);
        if (resolved === resolvedAllowed || resolved.startsWith(resolvedAllowed + path.sep)) {
          withinAllowed = true;
          break;
        }
      }

      if (!withinAllowed) {
        return false;
      }
    }

    return true;
  },
});

// ── Built-in Guardrail: Secret Leak ──────────────────────────────────────────

/** Patterns that match common API key and secret formats. */
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  // OpenAI / Anthropic style keys
  { name: 'openai_key', pattern: /\bsk-[a-zA-Z0-9]{20,}/g },
  // GitHub personal access tokens
  { name: 'github_pat', pattern: /\bghp_[a-zA-Z0-9]{36,}/g },
  // GitHub fine-grained tokens
  { name: 'github_fine_grained', pattern: /\bgithub_pat_[a-zA-Z0-9_]{22,}/g },
  // AWS access key IDs
  { name: 'aws_key', pattern: /\bAKIA[A-Z0-9]{16}\b/g },
  // Bearer tokens in authorization headers
  { name: 'bearer_token', pattern: /\bBearer\s+[a-zA-Z0-9._\-]{20,}/g },
  // Generic API key patterns (key= or api_key= or apikey=)
  { name: 'generic_api_key', pattern: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[=:]\s*['"]?[a-zA-Z0-9._\-]{20,}/gi },
  // Private keys (PEM format header)
  { name: 'private_key', pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g },
  // Slack tokens
  { name: 'slack_token', pattern: /\bxox[bpras]-[a-zA-Z0-9-]{10,}/g },
  // npm tokens
  { name: 'npm_token', pattern: /\bnpm_[a-zA-Z0-9]{36,}/g },
];

/** Prevents secrets/API keys from appearing in agent output. */
export const secretLeakGuardrail: Guardrail = {
  name: 'secret-leak',
  description: 'Prevents secrets/API keys from appearing in agent output',
  timing: 'post-execution',
  severity: 'block',
  failMessage: 'Potential secret or API key detected in agent output',
  check(input: GuardrailInput): boolean {
    for (const { pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(input.content)) {
        return false;
      }
    }
    return true;
  },
};

// ── Default Factory ──────────────────────────────────────────────────────────

/**
 * Creates a GuardrailEngine pre-loaded with all built-in guardrails.
 *
 * @param config - Optional configuration for parameterized guardrails.
 * @returns A configured GuardrailEngine instance.
 */
export function createDefaultGuardrails(config?: {
  maxTokensPerTask?: number;
  allowedPaths?: string[];
}): GuardrailEngine {
  const engine = new GuardrailEngine();

  engine.register(piiDetectionGuardrail);
  engine.register(costLimitGuardrail(config?.maxTokensPerTask ?? 200_000));
  engine.register(contentSafetyGuardrail);
  engine.register(loopDetectionGuardrail);
  engine.register(fileAccessGuardrail(config?.allowedPaths ?? [process.cwd()]));
  engine.register(secretLeakGuardrail);

  return engine;
}
