import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';

/**
 * SessionManager — keeps track of Claude CLI session IDs per agent
 * so conversations persist across tasks AND across app restarts.
 *
 * When an agent completes a task, we capture the session ID from
 * Claude CLI's JSON output. On the next task, we pass --resume <id>
 * so the agent has full context of previous work.
 *
 * Sessions are persisted to ~/.hivemind/sessions.json so that closing
 * and reopening the app doesn't lose Nova's context.
 */

export interface AgentSession {
  agentId: string;
  sessionId: string | null;
  taskCount: number;
  lastActive: number;
  /** Max tasks before forcing a fresh session (prevents context bloat) */
  maxTasks: number;
  /** Cumulative token usage for this session */
  tokenUsage: { input: number; output: number; cached: number };
  /** Summary from the previous session (injected into the next one) */
  carryoverSummary: string | null;
  /** Whether a summarization is currently in progress */
  summarizing: boolean;
}

/** Estimated max context tokens before quality degrades */
const MAX_CONTEXT_TOKENS = 180_000;
/** Trigger summarization at this percentage of max */
const SUMMARIZE_THRESHOLD = 0.75;

/** Path to persisted sessions file */
const SESSIONS_FILE = nodePath.join(os.homedir(), '.hivemind', 'sessions.json');

export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private readonly defaultMaxTasks: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: { maxTasksPerSession?: number } = {}) {
    this.defaultMaxTasks = config.maxTasksPerSession ?? 20;
    this.loadFromDisk();
  }

  /** Load persisted sessions from disk */
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(SESSIONS_FILE)) return;
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
      const data: Record<string, AgentSession> = JSON.parse(raw);
      for (const [key, session] of Object.entries(data)) {
        // Skip sessions older than 24 hours (they're likely stale)
        if (Date.now() - session.lastActive > 24 * 60 * 60 * 1000) continue;
        // Reset transient state
        session.summarizing = false;
        session.maxTasks = session.maxTasks || this.defaultMaxTasks;
        this.sessions.set(key, session);
      }
      console.log(`[SessionManager] Loaded ${this.sessions.size} sessions from disk`);
    } catch (err) {
      console.warn('[SessionManager] Failed to load sessions from disk:', err);
    }
  }

  /** Persist sessions to disk (debounced — writes at most once per second) */
  private saveToDisk(): void {
    if (this.saveTimer) return; // Already scheduled
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const dir = nodePath.dirname(SESSIONS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const data: Record<string, AgentSession> = {};
        for (const [key, session] of this.sessions) {
          data[key] = session;
        }
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
      } catch (err) {
        console.warn('[SessionManager] Failed to save sessions to disk:', err);
      }
    }, 1000);
  }

  /** Get or create a session for an agent */
  getSession(agentId: string): AgentSession {
    let session = this.sessions.get(agentId);
    if (!session) {
      session = {
        agentId,
        sessionId: null,
        taskCount: 0,
        lastActive: Date.now(),
        maxTasks: this.defaultMaxTasks,
        tokenUsage: { input: 0, output: 0, cached: 0 },
        carryoverSummary: null,
        summarizing: false,
      };
      this.sessions.set(agentId, session);
    }
    return session;
  }

  /** Get the resume session ID for an agent (null if no prior session) */
  getResumeId(agentId: string): string | null {
    const session = this.sessions.get(agentId);
    if (!session?.sessionId) return null;

    // Force fresh session if too many tasks (context getting too big)
    if (session.taskCount >= session.maxTasks) {
      this.resetSession(agentId);
      return null;
    }

    // Force fresh session if stale (>30 min since last task)
    if (Date.now() - session.lastActive > 30 * 60 * 1000) {
      this.resetSession(agentId);
      return null;
    }

    return session.sessionId;
  }

  /** Update session after a task completes */
  updateSession(agentId: string, sessionId: string): void {
    const session = this.getSession(agentId);
    session.sessionId = sessionId;
    session.taskCount++;
    session.lastActive = Date.now();
    this.saveToDisk();
  }

  /** Update token usage after a task completes */
  updateTokenUsage(agentId: string, usage: { input?: number; output?: number; cached?: number }): void {
    const session = this.getSession(agentId);
    // Use nullish checks — value of 0 is valid but falsy (#8: null-safety fix)
    if (usage.input != null) session.tokenUsage.input += usage.input;
    if (usage.output != null) session.tokenUsage.output += usage.output;
    if (usage.cached != null) session.tokenUsage.cached += usage.cached;
    this.saveToDisk();
  }

  /** Check if session is approaching context limits */
  needsSummarization(agentId: string): boolean {
    const session = this.sessions.get(agentId);
    if (!session?.sessionId || session.summarizing) return false;
    const totalUsed = session.tokenUsage.input + session.tokenUsage.output;
    return totalUsed > MAX_CONTEXT_TOKENS * SUMMARIZE_THRESHOLD;
  }

  /** Get context usage as a percentage (0-100) */
  getContextUsagePercent(agentId: string): number {
    const session = this.sessions.get(agentId);
    if (!session) return 0;
    const totalUsed = session.tokenUsage.input + session.tokenUsage.output;
    return Math.min(100, Math.round((totalUsed / MAX_CONTEXT_TOKENS) * 100));
  }

  /** Store a summary to carry into the next session */
  setCarryoverSummary(agentId: string, summary: string): void {
    const session = this.getSession(agentId);
    session.carryoverSummary = summary;
    this.saveToDisk();
  }

  /** Get and clear the carryover summary for a new session */
  consumeCarryoverSummary(agentId: string): string | null {
    const session = this.sessions.get(agentId);
    if (!session?.carryoverSummary) return null;
    const summary = session.carryoverSummary;
    session.carryoverSummary = null;
    return summary;
  }

  /** Mark an agent as currently summarizing (prevents re-triggering) */
  setSummarizing(agentId: string, value: boolean): void {
    const session = this.sessions.get(agentId);
    if (session) session.summarizing = value;
  }

  /** Check if a session exists for the given agent */
  hasSession(agentId: string): boolean {
    return this.sessions.has(agentId);
  }

  /** Get active session count */
  getActiveSessionCount(): number {
    return [...this.sessions.values()].filter((s) => s.sessionId !== null).length;
  }

  /** Force a fresh session for an agent, preserving carryover summary */
  resetSession(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      // Carryover is preserved so next session can resume context (#8)
      session.sessionId = null;
      session.taskCount = 0;
      session.tokenUsage = { input: 0, output: 0, cached: 0 };
      session.summarizing = false;
      this.saveToDisk();
    }
  }

  /** Reset all sessions */
  resetAll(): void {
    for (const session of this.sessions.values()) {
      session.sessionId = null;
      session.taskCount = 0;
      session.tokenUsage = { input: 0, output: 0, cached: 0 };
      session.summarizing = false;
    }
    this.saveToDisk();
  }

  /** Get stats for all sessions */
  getStats(): Array<{
    agentId: string;
    sessionId: string | null;
    taskCount: number;
    lastActive: number;
    contextUsagePercent: number;
    tokenUsage: { input: number; output: number; cached: number };
  }> {
    return Array.from(this.sessions.values()).map(s => ({
      agentId: s.agentId,
      sessionId: s.sessionId,
      taskCount: s.taskCount,
      lastActive: s.lastActive,
      contextUsagePercent: this.getContextUsagePercent(s.agentId),
      tokenUsage: { ...s.tokenUsage },
    }));
  }
}

/**
 * Extract the session ID from Claude CLI JSON output.
 * The CLI includes it in the result message.
 */
export function extractSessionId(jsonOutput: string): string | null {
  const lines = jsonOutput.trim().split('\n');

  // Search from the end (session ID is usually in the last few lines)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const msg = JSON.parse(lines[i]!);

      // The result message contains the session_id
      if (msg.type === 'result' && msg.session_id) {
        return msg.session_id;
      }

      // Also check for session_id at top level
      if (msg.session_id) {
        return msg.session_id;
      }

      // Check in system messages
      if (msg.type === 'system' && msg.session_id) {
        return msg.session_id;
      }
    } catch {
      continue;
    }
  }

  return null;
}
