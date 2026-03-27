import express from 'express';
import { createServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { timingSafeEqual } from 'node:crypto';
import { TrustLevel, type TaskSource, trustGate } from '../core/trust.js';
import {
  buildWorkspaceReviewContext,
  diffWorkspaceSnapshots,
  formatWorkspaceMutationSummary,
  snapshotWorkspace,
  type WorkspaceMutationSummary,
} from './workspace-tracker.js';
import { createMarketplaceRouter } from '../skills/marketplace-server.js';
import { SwarmGraphTracker, type SwarmGraphState, type SwarmNode, type SwarmEdge } from './swarm-graph.js';
import {
  buildFirstTaskSuggestion,
  detectProviderStatuses,
  isFirstRun,
  loadProfileOrDefault,
  normalizeProfile,
  saveProfile,
} from '../cli/onboarding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentInfo {
  id: string;
  name: string;
  type: 'orchestrator' | 'worker' | 'specialist' | 'sentinel' | 'coordinator';
  status: 'active' | 'idle' | 'error' | 'spawning';
  currentTask?: string;
  skills: string[];
  memoryUsageMB: number;
  uptime: number;
  tasksCompleted: number;
  location?: { lat: number; lng: number };
  connections: string[];
}

interface SwarmMetrics {
  totalAgents: number;
  activeAgents: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalMemoryMB: number;
  uptimeSeconds: number;
  messagesPerSecond: number;
}

interface TaskEvent {
  id: string;
  agentId: string;
  agentName: string;
  agentType: AgentInfo['type'];
  action: string;
  detail: string;
  timestamp: number;
  duration?: number;
  status: 'started' | 'completed' | 'failed' | 'delegated';
}

type WSMessage =
  | { type: 'agent:update'; payload: AgentInfo }
  | { type: 'agent:added'; payload: AgentInfo }
  | { type: 'agent:removed'; payload: { id: string } }
  | { type: 'swarm:metrics'; payload: SwarmMetrics }
  | { type: 'task:event'; payload: TaskEvent }
  | { type: 'workdir:changed'; path: string }
  | { type: 'swarm:graph'; payload: SwarmGraphState }
  | { type: 'swarm:edge:add'; payload: SwarmEdge }
  | { type: 'swarm:edge:remove'; payload: { id: string } }
  | { type: 'swarm:node:update'; payload: SwarmNode }
  | { type: 'ping' };

// ─── State ───────────────────────────────────────────────────────────────────

const agents = new Map<string, AgentInfo>();
const taskEvents: TaskEvent[] = [];
const taskFollowups = new Map<string, string[]>();  // taskId -> queued follow-up messages
const taskToAgent = new Map<string, string>();       // taskId -> agentId (for delivering mid-task context)
const taskMapTimestamps = new Map<string, number>(); // taskId -> creation timestamp (for periodic eviction)
const taskAbortControllers = new Map<string, AbortController>();  // taskId -> abort controller for Nova's stream
const taskQuestionResolvers = new Map<string, (answer: string) => void>(); // taskId -> question answer resolver
const MAX_TASK_EVENTS = 500;
let providerStatusCache: Awaited<ReturnType<typeof detectProviderStatuses>> = [];
let providerStatusRefresh: Promise<Awaited<ReturnType<typeof detectProviderStatuses>>> | null = null;

const bus = new EventEmitter();
bus.setMaxListeners(200);

// ─── Swarm Graph Tracker ─────────────────────────────────────────────────────

const swarmGraph = new SwarmGraphTracker();
swarmGraph.attachBus(bus);

// Broadcast incremental graph updates to all WebSocket clients
swarmGraph.on('node:update', (node: SwarmNode) => {
  broadcast({ type: 'swarm:node:update', payload: node });
});
swarmGraph.on('edge:add', (edge: SwarmEdge) => {
  broadcast({ type: 'swarm:edge:add', payload: edge });
});
swarmGraph.on('edge:remove', (payload: { id: string }) => {
  broadcast({ type: 'swarm:edge:remove', payload });
});

// Full graph sync every 5 seconds (lightweight — only agent nodes + active edges)
setInterval(() => {
  broadcast({ type: 'swarm:graph', payload: swarmGraph.getState() });
}, 5_000);

// Periodic cleanup: evict stale taskFollowups / taskToAgent entries (every 2 minutes, TTL 10 minutes)
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, ts] of taskMapTimestamps) {
    if (ts < cutoff) {
      // Resolve any pending question resolvers before deleting — otherwise the
      // waitForTaskAnswer Promise hangs forever and the agent silently dies.
      const resolver = taskQuestionResolvers.get(id);
      if (resolver) {
        console.warn(`[Dashboard] Evicting stale question resolver for task ${id}`);
        resolver('[Question expired — no answer received. Continue with your best judgment.]');
      }
      taskFollowups.delete(id);
      taskToAgent.delete(id);
      taskQuestionResolvers.delete(id);
      taskMapTimestamps.delete(id);
    }
  }
}, 2 * 60 * 1000);

interface TaskExecutionResult {
  content: string;
  workspaceSummary?: WorkspaceMutationSummary;
}

interface AskUserOption {
  label: string;
  description?: string;
}

interface AskUserQuestion {
  header: string;
  question: string;
  options: AskUserOption[];
  multiSelect: boolean;
  placeholder?: string;
  otherLabel: string;
}

const ASK_USER_START = '[ASK_USER]';
const ASK_USER_END = '[/ASK_USER]';

function normalizeAskUserQuestion(raw: unknown): AskUserQuestion | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  const questionVal = typeof candidate['question'] === 'string' ? (candidate['question'] as string).trim() : '';
  if (!questionVal) return null;

  const rawOptions = Array.isArray(candidate['options']) ? candidate['options'] as unknown[] : [];
  const options = rawOptions
    .map((option): AskUserOption | null => {
      if (typeof option === 'string') {
        const label = option.trim();
        return label ? { label } : null;
      }
      if (!option || typeof option !== 'object') return null;
      const optionObj = option as Record<string, unknown>;
      const label = typeof optionObj['label'] === 'string' ? (optionObj['label'] as string).trim() : '';
      if (!label) return null;
      const description = typeof optionObj['description'] === 'string' ? (optionObj['description'] as string).trim() : undefined;
      return { label, description };
    })
    .filter((option): option is AskUserOption => Boolean(option));

  const headerVal = candidate['header'];
  const placeholderVal = candidate['placeholder'];
  const otherLabelVal = candidate['otherLabel'];

  return {
    header: typeof headerVal === 'string' && headerVal.trim() ? headerVal.trim() : 'Question',
    question: questionVal,
    options,
    multiSelect: Boolean(candidate['multiSelect']),
    placeholder: typeof placeholderVal === 'string' && placeholderVal.trim() ? placeholderVal.trim() : undefined,
    otherLabel: typeof otherLabelVal === 'string' && otherLabelVal.trim() ? otherLabelVal.trim() : 'Other',
  };
}

function extractAskUserBlocks(text: string): { cleanText: string; questions: AskUserQuestion[] } {
  if (!text) return { cleanText: '', questions: [] };

  const questions: AskUserQuestion[] = [];
  let cleanText = '';
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(ASK_USER_START, cursor);
    if (start === -1) {
      cleanText += text.slice(cursor);
      break;
    }

    cleanText += text.slice(cursor, start);
    const end = text.indexOf(ASK_USER_END, start + ASK_USER_START.length);
    if (end === -1) {
      cleanText += text.slice(start);
      break;
    }

    const payload = text.slice(start + ASK_USER_START.length, end).trim();
    try {
      const parsed = JSON.parse(payload);
      const question = normalizeAskUserQuestion(parsed);
      if (question) questions.push(question);
    } catch (error) {
      console.warn('[ASK_USER] Failed to parse question block:', error);
    }

    cursor = end + ASK_USER_END.length;
  }

  return { cleanText: cleanText.trimEnd(), questions };
}

function getAskUserPrefixRemainder(text: string): string {
  const maxLen = Math.min(text.length, ASK_USER_START.length - 1);
  for (let len = maxLen; len > 0; len--) {
    if (text.endsWith(ASK_USER_START.slice(0, len))) {
      return text.slice(-len);
    }
  }
  return '';
}

function consumeAskUserStreamBuffer(buffer: string): { displayText: string; remainder: string } {
  if (!buffer) return { displayText: '', remainder: '' };

  let displayText = '';
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(ASK_USER_START, cursor);
    if (start === -1) {
      const tail = buffer.slice(cursor);
      const prefixRemainder = getAskUserPrefixRemainder(tail);
      const safeTail = prefixRemainder ? tail.slice(0, -prefixRemainder.length) : tail;
      displayText += safeTail;
      return { displayText, remainder: prefixRemainder };
    }

    displayText += buffer.slice(cursor, start);
    const end = buffer.indexOf(ASK_USER_END, start + ASK_USER_START.length);
    if (end === -1) {
      return { displayText, remainder: buffer.slice(start) };
    }

    cursor = end + ASK_USER_END.length;
  }

  return { displayText, remainder: '' };
}

async function waitForTaskAnswer(taskId: string, timeoutMs = 5 * 60 * 1000): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      taskQuestionResolvers.delete(taskId);
      console.warn(`[Dashboard] Question for task ${taskId} timed out after ${timeoutMs / 1000}s — auto-resolving`);
      resolve('[No answer received — question timed out. Continue with your best judgment.]');
    }, timeoutMs);

    taskQuestionResolvers.set(taskId, (answer: string) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

async function streamAssistantTurn(params: {
  ws: WebSocket;
  taskId: string;
  agentId: string;
  parentTaskId?: string;
  provider: any;
  request: {
    messages: Array<{ role: string; content: string }>;
    agentId: string;
    signal?: AbortSignal;
    permissions?: any;
  };
}): Promise<{ cleanContent: string; questions: AskUserQuestion[]; rawContent: string }> {
  const { ws, taskId, agentId, parentTaskId, provider, request } = params;
  let visibleContent = '';
  let streamRemainder = '';

  const response = await provider.completeStreaming(
    request,
    (data: { text: string; type: string }) => {
      if (data.type !== 'text') {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'task:token', taskId, text: data.text, tokenType: data.type, agentId }));
          if (parentTaskId) {
            ws.send(JSON.stringify({ type: 'task:token', taskId: parentTaskId, text: data.text, tokenType: data.type, agentId }));
          }
        }
        return;
      }

      streamRemainder += data.text;
      const consumed = consumeAskUserStreamBuffer(streamRemainder);
      streamRemainder = consumed.remainder;
      if (consumed.displayText && ws.readyState === WebSocket.OPEN) {
        visibleContent += consumed.displayText;
        ws.send(JSON.stringify({ type: 'task:token', taskId, text: consumed.displayText, tokenType: 'text', agentId }));
        if (parentTaskId) {
          ws.send(JSON.stringify({ type: 'task:token', taskId: parentTaskId, text: consumed.displayText, tokenType: 'text', agentId }));
        }
      }
    }
  );

  const responseContent = typeof response?.content === 'string' ? response.content : `${visibleContent}${streamRemainder}`;
  const { cleanText, questions } = extractAskUserBlocks(responseContent);
  return { cleanContent: cleanText, questions, rawContent: responseContent };
}

async function resolveInteractiveQuestions(params: {
  ws: WebSocket;
  taskId: string;
  agentId: string;
  provider: any;
  sessionKey: string;
  systemPrompt: string;
  baseMessages: Array<{ role: string; content: string }>;
  initialContent: string;
  initialQuestions: AskUserQuestion[];
  waitingText?: string;
  resumedText?: string;
  permissions?: any;
}): Promise<string> {
  const {
    ws,
    taskId,
    agentId,
    provider,
    sessionKey,
    systemPrompt,
    baseMessages,
    initialContent,
    initialQuestions,
    waitingText = '\n\n---\n*Waiting for your answer...*\n\n',
    resumedText = '\n\n---\n*Reading your answer and continuing...*\n\n',
    permissions,
  } = params;

  let fullContent = initialContent;
  let pendingQuestions = [...initialQuestions];
  const transcript = [...baseMessages];
  if (fullContent) {
    transcript.push({ role: 'assistant', content: fullContent });
  }

  while (pendingQuestions.length > 0) {
    const currentQuestion = pendingQuestions[0]!;
    pendingQuestions = [];

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'task:question',
        taskId,
        header: currentQuestion.header,
        question: currentQuestion.question,
        options: currentQuestion.options,
        multiSelect: currentQuestion.multiSelect,
        placeholder: currentQuestion.placeholder,
        otherLabel: currentQuestion.otherLabel,
      }));

      if (waitingText) {
        ws.send(JSON.stringify({
          type: 'task:token',
          taskId,
          text: waitingText,
          tokenType: 'text',
          agentId,
        }));
      }
    }

    const answer = await waitForTaskAnswer(taskId);
    transcript.push({ role: 'user', content: answer });

    if (ws.readyState === WebSocket.OPEN && resumedText) {
      ws.send(JSON.stringify({
        type: 'task:token',
        taskId,
        text: resumedText,
        tokenType: 'text',
        agentId,
      }));
    }

    const nextTurn = await streamAssistantTurn({
      ws,
      taskId,
      agentId,
      provider,
      request: {
        messages: [{ role: 'system', content: systemPrompt }, ...transcript],
        agentId: sessionKey,
        permissions,
      },
    });

    if (nextTurn.cleanContent) {
      fullContent = fullContent
        ? `${fullContent}\n\n${nextTurn.cleanContent}`
        : nextTurn.cleanContent;
      transcript.push({ role: 'assistant', content: nextTurn.cleanContent });
    }
    pendingQuestions = nextTurn.questions;
  }

  return fullContent;
}

// ─── Memory helpers ─────────────────────────────────────────────────────────

import { ContextManager } from '../memory/context.js';

// Per-conversation pending action plans (conversationId -> { plan, timestamp })
const pendingActionPlans = new Map<string, { plan: string; timestamp: number }>();
const MAX_PENDING_PLANS = 100;
const PLAN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Detect numbered action items / recommendations in Nova's response and
 * save them as a pending action plan. This survives message truncation
 * so follow-ups like "do all 3" still have the full plan in context.
 */
function extractAndSavePendingActions(
  novaResponse: string,
  conversationId?: string,
): void {
  if (!conversationId || novaResponse.length < 100) return;

  // Match numbered lists (1. ... 2. ... 3. ...) with substantial content
  const numberedItems = novaResponse.match(/^\s*\d+\.\s+\*?\*?.{20,}/gm);
  if (!numberedItems || numberedItems.length < 2) return;

  // Also look for signals that this is a plan / recommendation, not just any list
  const planSignals = /recommend|action|should|fix|implement|wire up|strip|move|jump|upgrade|refactor|migrate|add|create|build|deploy/i;
  const hasSignal = numberedItems.some(item => planSignals.test(item));
  if (!hasSignal) return;

  // Extract the action plan section — find the block containing the numbered items
  const lines = novaResponse.split('\n');
  let planStart = -1;
  let planEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*1\.\s+/.test(lines[i]!)) {
      // Walk backwards to find a header
      planStart = i;
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        if (lines[j]!.trim().length > 0) {
          planStart = j;
          break;
        }
      }
      // Walk forward to find end of numbered list
      planEnd = i;
      for (let k = i + 1; k < lines.length; k++) {
        if (/^\s*\d+\.\s+/.test(lines[k]!) || /^\s{2,}/.test(lines[k]!) || lines[k]!.trim() === '') {
          planEnd = k;
        } else if (lines[k]!.trim().length > 0 && !/^\s*\d+\.\s+/.test(lines[k]!)) {
          // Include one more line of context after the list
          planEnd = k;
          break;
        }
      }
      break;
    }
  }

  if (planStart >= 0 && planEnd > planStart) {
    const actionPlan = lines.slice(planStart, planEnd + 1).join('\n').trim();
    if (actionPlan.length > 50) {
      pendingActionPlans.set(conversationId, { plan: actionPlan, timestamp: Date.now() });
      // Evict oldest entries if map exceeds max size
      if (pendingActionPlans.size > MAX_PENDING_PLANS) {
        let oldestKey: string | undefined;
        let oldestTs = Infinity;
        for (const [key, entry] of pendingActionPlans) {
          if (entry.timestamp < oldestTs) {
            oldestTs = entry.timestamp;
            oldestKey = key;
          }
        }
        if (oldestKey) pendingActionPlans.delete(oldestKey);
      }
      console.log(`[ActionPlan] Saved pending action plan (${actionPlan.length} chars) for conversation ${conversationId.slice(0, 8)}`);
    }
  }
}

/**
 * Detect if a user message is a short execution command referring to a prior plan.
 * Returns the pending action plan if found, or empty string.
 */
function loadPendingActionPlan(
  userMessage: string,
  conversationId?: string,
): string {
  if (!conversationId) return '';

  const entry = pendingActionPlans.get(conversationId);
  if (!entry) return '';

  // Evict stale plans (older than TTL)
  if (Date.now() - entry.timestamp > PLAN_TTL_MS) {
    pendingActionPlans.delete(conversationId);
    return '';
  }

  // Short messages that reference prior context are execution commands
  const isShort = userMessage.trim().split(/\s+/).length <= 15;
  const executionPatterns = /\b(do\s+(all|it|that|this|them|those|the\s+\d)|go\s+ahead|yes|yeah|yep|proceed|execute|make\s+(it|those|the)|start|begin|let'?s\s+(go|do)|ok(ay)?|ship\s+it|implement|fix\s+(all|it|them|those|the)|build|deploy|run)\b/i;
  const referencesNumber = /\b(all\s+\d|\d\s+things?|both|each|every)\b/i;

  if (isShort && (executionPatterns.test(userMessage) || referencesNumber.test(userMessage))) {
    return entry.plan;
  }

  return '';
}

/**
 * Save a completed task to hierarchical memory (L0 summary + L1 overview).
 * Runs in background — never blocks the response.
 */
async function saveTaskMemory(
  taskDescription: string,
  agentId: string,
  content: string,
  conversationId?: string,
): Promise<void> {
  const swarm = getInjectedSwarmState();
  if (!swarm?.memoryStore || content.length < 30) return;

  try {
    const agent = swarm.agents?.get(agentId);
    const agentName = agent ? (agent as any).identity?.name || agentId : agentId;

    // Create a concise L0 summary (first meaningful sentence or truncated)
    const firstLine = content.replace(/\*\*Actions taken:\*\*[\s\S]*?\n\n/, '').trim();
    const summary = firstLine.length > 200
      ? firstLine.slice(0, 200).replace(/\s\S*$/, '') + '...'
      : firstLine.split('\n')[0]?.slice(0, 200) || firstLine.slice(0, 200);

    // L1 overview: first ~1500 chars of actual content (skip action blocks)
    const overview = content
      .replace(/\*\*Actions taken:\*\*[\s\S]*?\n\n/, '')
      .slice(0, 1500)
      .trim();

    // Write L0 summary (dedup: update if same task title already exists)
    const ns = conversationId ? `tasks.${conversationId.slice(0, 8)}` : 'tasks';
    const l0Id = await swarm.memoryStore.writeOrUpdate({
      namespace: ns,
      title: taskDescription.slice(0, 100),
      content: summary,
      level: 0,
      source: agentId,
      metadata: { agentName, conversationId, timestamp: Date.now() },
    });

    // Write L1 overview linked to L0 (dedup: update if exists)
    if (overview.length > summary.length) {
      await swarm.memoryStore.writeOrUpdate({
        namespace: ns,
        title: `${taskDescription.slice(0, 80)} (overview)`,
        content: overview,
        level: 1,
        parentId: l0Id,
        source: agentId,
        metadata: { agentName, conversationId, timestamp: Date.now() },
      });
    }

    console.log(`[Memory] Saved task: "${taskDescription.slice(0, 60)}" (${summary.length} + ${overview.length} tokens) by ${agentName}`);
  } catch (err) {
    console.error('[Memory] Failed to save task:', err);
  }
}

/**
 * Load project knowledge (CLAUDE.md, MEMORY.md, relevant reference skills).
 * Mirrors Claude Code's native .claude/ loading so agents stay informed.
 */
async function loadProjectKnowledge(description: string): Promise<string> {
  const swarm = getInjectedSwarmState();
  const workDir = (swarm as any)?.workDir || process.cwd();
  let context = '';

  try {
    const fs = await import('fs');

    // CLAUDE.md — always loaded
    for (const p of [path.join(workDir, 'CLAUDE.md'), path.join(workDir, '.claude', 'CLAUDE.md')]) {
      if (fs.existsSync(p)) {
        context += `\n\n## Project Instructions\n${fs.readFileSync(p, 'utf-8').slice(0, 6000)}`;
      }
    }

    // MEMORY.md — project-local + global user memory
    const memPaths = [
      path.join(workDir, '.claude', 'memory', 'MEMORY.md'),
      path.join(process.env['HOME'] || '', '.claude', 'projects',
        `-${workDir.replace(/\//g, '-')}`, 'memory', 'MEMORY.md'),
    ];
    for (const mp of memPaths) {
      if (fs.existsSync(mp)) {
        const label = mp.includes('.claude/projects/') ? 'Global Memory' : 'Project Memory';
        context += `\n\n## ${label}\n${fs.readFileSync(mp, 'utf-8').slice(0, 4000)}`;
      }
    }

    // Reference skills — keyword-matched to task description
    const skillsDir = path.join(workDir, '.claude', 'skills');
    if (fs.existsSync(skillsDir)) {
      const descLower = description.toLowerCase();
      const skillMatches: Array<{ dir: string; keywords: string[] }> = [
        { dir: 'server-reference', keywords: ['server', 'dashboard', 'websocket', 'orchestrat', 'delegat', 'streaming', 'task:'] },
        { dir: 'desktop-reference', keywords: ['desktop', 'electron', 'renderer', 'index.html', 'chat ui', 'frontend'] },
        { dir: 'agents-reference', keywords: ['agent', 'nova', 'builder', 'scout', 'sentinel', 'oracle', 'courier', 'provider', 'prompt'] },
        { dir: 'memory-reference', keywords: ['memory', 'context', 'sqlite', 'l0', 'l1', 'l2', 'token budget'] },
      ];
      for (const skill of skillMatches) {
        if (skill.keywords.some(kw => descLower.includes(kw))) {
          const skillPath = path.join(skillsDir, skill.dir, 'SKILL.md');
          if (fs.existsSync(skillPath)) {
            const content = fs.readFileSync(skillPath, 'utf-8')
              .replace(/^---[\s\S]*?---\n*/m, '')
              .slice(0, 4000);
            context += `\n\n## Reference: ${skill.dir}\n${content}`;
          }
        }
      }
    }

    // Executable skills — explicit slash-command or trigger-matched from the skill registry
    const skillRegistry = (swarm as any)?.skillRegistry;
    const slashMatch = description.match(/^\/([\w-]+)\s*/);
    if (slashMatch && skillRegistry) {
      // Explicit slash-command invocation: load full skill with NO truncation
      const skillName = slashMatch[1];
      const skill = skillRegistry.get(skillName);
      if (skill) {
        context += `\n\n## Skill: ${skill.metadata.name} (activated)\n${skill.instructions}`;
      }
    } else if (skillRegistry?.matchTriggers) {
      // Background trigger matching — increased limit for trigger-matched skills
      const matched = skillRegistry.matchTriggers(description);
      for (const skill of matched.slice(0, 3)) { // Max 3 skills per task
        context += `\n\n## Skill: ${skill.metadata.name}\n${skill.instructions.slice(0, 12000)}`;
      }
    }
  } catch { /* non-critical */ }

  return context;
}

/**
 * Load relevant memories for a task and format them for injection
 * into the system prompt. Returns empty string if nothing relevant.
 */
async function loadMemoryContext(taskDescription: string): Promise<string> {
  const swarm = getInjectedSwarmState();
  if (!swarm?.memoryStore) return '';

  try {
    const ctx = new ContextManager(swarm.memoryStore, 4096);

    // Step 1: Search-first — load the most relevant memories for THIS task.
    // This ensures task-relevant context always gets priority over bulk loading.
    await ctx.loadRelevant(taskDescription, { limit: 10 });

    // Step 2: Fill remaining budget with recent L0 summaries from known namespaces.
    // Cap at 50 most recent to prevent unbounded growth from swamping the budget.
    const recentSummaries = swarm.memoryStore.listByNamespace('tasks', 0 /* L0 */)
      .slice(0, 50);

    for (const entry of recentSummaries) {
      if (ctx.getBudget().remaining < entry.tokenCount) break;
      if (!ctx.isLoaded(entry.id)) {
        // Use load() with a single-entry namespace to respect budget
        try {
          await ctx.load({ namespaces: [entry.namespace], budget: ctx.getBudget().remaining + ctx.getBudget().used });
        } catch {
          break; // Budget exhausted
        }
      }
    }

    const rendered = ctx.renderContext();
    if (rendered.length > 10) {
      console.log(`[Memory] Loaded ${ctx.getLoadedEntries().length} memories (${rendered.length} chars) for task`);
    }
    return rendered;
  } catch (err) {
    console.error('[Memory] Failed to load context:', err);
    return '';
  }
}

/**
 * Load seller business context (marketplace briefing) for injection into agent prompts.
 * Gives agents real-time knowledge of the seller's orders, inventory, health, and alerts.
 */
async function loadSellerContext(): Promise<string> {
  const lines: string[] = [];

  // ── Marketplace data ────────────────────────────────────────────────
  try {
    const svc = getMarketplaceService();
    const connected = svc.getConnectedMarketplaces();
    if (connected.length > 0) {
      const briefing = await svc.getDailyBriefing();
      lines.push('## Seller Business Context (live data)');
      lines.push(`Date: ${briefing.date}`);
      lines.push(`Connected marketplaces: ${connected.join(', ')}`);
      lines.push(`Orders (24h): ${briefing.totalOrders} | Revenue: $${briefing.totalRevenue.toFixed(2)}`);
      lines.push(`Active FBA shipments: ${briefing.activeShipments}`);

      if (briefing.summaries.length > 0) {
        lines.push('\nPer-marketplace breakdown:');
        for (const s of briefing.summaries) {
          lines.push(`- ${s.marketplace}: ${s.pendingOrders} orders, $${(s.recentRevenue || 0).toFixed(2)} revenue, ${s.alerts.length} alerts`);
        }
      }

      if (briefing.alerts.length > 0) {
        lines.push('\nAccount health alerts:');
        for (const a of briefing.alerts.slice(0, 10)) {
          lines.push(`- [${a.severity.toUpperCase()}] ${a.marketplace}: ${a.title}${a.actionRequired ? ' (ACTION REQUIRED)' : ''}`);
        }
      }

      if (briefing.suggestedActions.length > 0) {
        lines.push('\nSuggested actions:');
        for (const action of briefing.suggestedActions) {
          lines.push(`- ${action}`);
        }
      }
    }
  } catch (err) {
    console.warn('[Seller] Failed to load marketplace context:', err instanceof Error ? err.message : err);
  }

  // ── Financial data (SimpleFIN) ──────────────────────────────────────
  try {
    const finRes: any = await fetch(`http://localhost:${(globalThis as any).__hivemindPort || 4000}/api/finance/summary`).then(r => r.json()).catch(() => null);
    if (finRes && finRes.connected) {
      lines.push('\n## Financial Summary (from connected bank/credit card accounts)');
      lines.push(`Available credit across all cards: $${(finRes.totalAvailableCredit || 0).toLocaleString()}`);
      lines.push(`Total credit limit: $${(finRes.totalCreditLimit || 0).toLocaleString()}`);
      lines.push(`Spent this week: $${(finRes.spentThisWeek || 0).toLocaleString()}`);
      lines.push(`Spent today: $${(finRes.spentToday || 0).toLocaleString()}`);
      if (finRes.accounts && finRes.accounts.length > 0) {
        lines.push('\nAccounts:');
        for (const a of finRes.accounts) {
          const avail = a.availableCredit != null ? ` | Available: $${a.availableCredit.toLocaleString()}` : '';
          lines.push(`- ${a.name}${a.institution ? ' (' + a.institution + ')' : ''}: Balance $${a.balance.toLocaleString()}${avail}`);
        }
      }
    }
  } catch {
    // Finance module may not be loaded yet — non-critical
  }

  // ── Pipeline data (source-to-sale) ───────────────────────────────
  try {
    const pipeRes: any = await fetch(`http://localhost:${(globalThis as any).__hivemindPort || 4000}/api/finance/pipeline/summary`).then(r => r.json()).catch(() => null);
    if (pipeRes && pipeRes.totalBatches > 0) {
      lines.push('\n## Inventory Pipeline (source-to-sale)');
      lines.push(`Total batches in pipeline: ${pipeRes.totalBatches} (${pipeRes.totalUnits} units, $${pipeRes.totalCostInPipeline.toFixed(2)} invested)`);
      if (pipeRes.byStatus) {
        for (const [status, data] of Object.entries(pipeRes.byStatus)) {
          const d = data as { count: number; units: number; cost: number };
          lines.push(`- ${status.replace(/_/g, ' ')}: ${d.count} batches, ${d.units} units, $${d.cost.toFixed(2)}`);
        }
      }
    }
  } catch {
    // Pipeline module may not be loaded yet — non-critical
  }

  if (lines.length === 0) return '';
  return '\n\n' + lines.join('\n');
}

// ─── Express App ─────────────────────────────────────────────────────────────

const app: ReturnType<typeof express> = express();
app.use(express.json({ limit: '1mb' }));

// ─── Security headers + CORS ─────────────────────────────────────────────────

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Allow iframe embedding from Electron (file:// origin) and localhost
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; frame-ancestors 'self' file: http://localhost:* http://127.0.0.1:*");
  // CORS: restrict to localhost origins
  const origin = _req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (_req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

// ─── Optional auth: if DASHBOARD_PASSWORD is set, require it ─────────────────

const DASH_PASSWORD = process.env["DASHBOARD_PASSWORD"];

function refreshProviderStatuses(): Promise<Awaited<ReturnType<typeof detectProviderStatuses>>> {
  if (providerStatusRefresh) return providerStatusRefresh;

  providerStatusRefresh = detectProviderStatuses()
    .then((providers) => {
      providerStatusCache = providers;
      return providers;
    })
    .catch((error) => {
      console.warn('[Dashboard] Failed to detect provider statuses:', error);
      return providerStatusCache;
    })
    .finally(() => {
      providerStatusRefresh = null;
    });

  return providerStatusRefresh;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!DASH_PASSWORD) return next(); // no password set → open access (localhost only)
  // Accept password via Authorization: Bearer <password> or ?token=<password>
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req.query["token"] as string);
  if (token && token.length === DASH_PASSWORD.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(DASH_PASSWORD))) return next();
  res.status(401).json({ error: 'Unauthorized. Set Authorization: Bearer <password> or ?token=<password>' });
}

// Apply auth to all API routes
app.use('/api', requireAuth);

// Serve the desktop renderer from the root URL too so first-run onboarding is reachable.
app.get('/', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(`/app${query}`);
});

// Serve static dashboard assets from public/
app.use(express.static(path.join(__dirname, '../../public')));

// Serve the desktop chat UI at /app (and /chat alias)
const desktopRendererPath = path.join(__dirname, '../../desktop/renderer');
app.use('/app', express.static(desktopRendererPath));
app.get('/chat', (_req, res) => {
  res.sendFile(path.join(desktopRendererPath, 'index.html'));
});

// ─── REST API ────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/profile', (_req, res) => {
  try {
    const profile = loadProfileOrDefault();
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load profile' });
  }
});

app.get('/api/onboarding/bootstrap', async (_req, res) => {
  try {
    const profile = loadProfileOrDefault();
    void refreshProviderStatuses();
    res.json({
      isFirstRun: isFirstRun(),
      profile,
      providers: providerStatusCache,
      firstTaskSuggestion: buildFirstTaskSuggestion(profile),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load onboarding bootstrap',
    });
  }
});

app.get('/api/onboarding/providers', async (_req, res) => {
  try {
    const providers = await refreshProviderStatuses();
    res.json({ providers });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to detect providers',
      providers: providerStatusCache,
    });
  }
});

app.post('/api/profile', (req, res) => {
  try {
    const draft = normalizeProfile(req.body ?? {});
    const profile = saveProfile(draft);
    res.json({
      ok: true,
      profile,
      firstTaskSuggestion: buildFirstTaskSuggestion(profile),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to save profile',
    });
  }
});

app.get('/api/agents', (_req, res) => {
  res.json({ agents: Array.from(agents.values()) });
});

app.get('/api/agents/:id', (req, res) => {
  const agent = agents.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

const VALID_AGENT_TYPES = ['orchestrator', 'worker', 'specialist', 'sentinel'] as const;

app.post('/api/agents', (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.slice(0, 100) : '';
  if (!name) return res.status(400).json({ error: 'Agent name is required' });

  const type = VALID_AGENT_TYPES.includes(req.body.type) ? req.body.type : 'worker';
  const skills = Array.isArray(req.body.skills) ? req.body.skills.filter((s: unknown) => typeof s === 'string').slice(0, 20) : [];

  const agent: AgentInfo = {
    id: crypto.randomUUID(),
    name,
    type,
    status: 'spawning',
    skills,
    memoryUsageMB: 0,
    uptime: 0,
    tasksCompleted: 0,
    connections: [],
  };
  agents.set(agent.id, agent);
  broadcast({ type: 'agent:added', payload: agent });
  bus.emit('agent:added', agent);
  res.status(201).json(agent);
});

app.patch('/api/agents/:id', (req, res) => {
  const existing = agents.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Agent not found' });

  // Whitelist updatable fields
  const updated = { ...existing };
  if (typeof req.body.name === 'string') updated.name = req.body.name.slice(0, 100);
  if (VALID_AGENT_TYPES.includes(req.body.type)) updated.type = req.body.type;
  if (typeof req.body.status === 'string' && ['active', 'idle', 'error', 'spawning'].includes(req.body.status)) updated.status = req.body.status as AgentInfo['status'];
  if (Array.isArray(req.body.skills)) updated.skills = req.body.skills.filter((s: unknown) => typeof s === 'string').slice(0, 20);
  if (typeof req.body.currentTask === 'string') updated.currentTask = req.body.currentTask.slice(0, 200);

  agents.set(updated.id, updated);
  broadcast({ type: 'agent:update', payload: updated });
  bus.emit('agent:update', updated);
  res.json(updated);
});

app.delete('/api/agents/:id', (req, res) => {
  if (!agents.has(req.params.id)) return res.status(404).json({ error: 'Agent not found' });
  agents.delete(req.params.id);
  broadcast({ type: 'agent:removed', payload: { id: req.params.id } });
  bus.emit('agent:removed', { id: req.params.id });
  res.status(204).end();
});

app.get('/api/metrics', (_req, res) => {
  res.json(computeMetrics());
});

app.get('/api/tasks/feed', (req, res) => {
  const limit = Math.min(Number(req.query["limit"]) || 50, MAX_TASK_EVENTS);
  const agentType = req.query["agentType"] as string | undefined;
  let feed = taskEvents.slice(-limit).reverse();
  if (agentType) {
    feed = feed.filter((e) => e.agentType === agentType);
  }
  res.json({ events: feed });
});

// ─── Working Directory ─────────────────────────────────────────────────────

let activeWorkDir = process.cwd();

app.post('/api/workdir', (req, res) => {
  const newPath = req.body?.path;
  if (!newPath || typeof newPath !== 'string') {
    res.status(400).json({ error: 'Path is required' });
    return;
  }
  activeWorkDir = newPath;
  // Update all providers' workDir
  const swarm = getInjectedSwarmState();
  if (swarm?.agents) {
    for (const [, agent] of swarm.agents) {
      const llm = (agent as any).llm;
      // Update Claude Code provider
      const claudeProvider = llm?.getProvider?.('claude-code');
      if (claudeProvider) {
        (claudeProvider as any).workDir = newPath;
      }
      // Update Codex provider
      const codexProvider = llm?.getProvider?.('codex');
      if (codexProvider) {
        (codexProvider as any).workDir = newPath;
      }
    }
  }
  console.log(`[HIVEMIND] Working directory changed to: ${newPath}`);
  broadcast({ type: 'workdir:changed', path: newPath });
  res.json({ path: newPath });
});

app.get('/api/workdir', (_req, res) => {
  res.json({ path: activeWorkDir });
});

// ─── Trust Classification Helpers ──────────────────────────────────────────

/**
 * Build a TaskSource for an incoming HTTP request.
 * If DASHBOARD_PASSWORD is set and the request is authenticated → OWNER.
 * If DASHBOARD_PASSWORD is not set and request is from localhost → OWNER.
 * Otherwise → UNTRUSTED.
 */
function classifyHttpRequest(req: express.Request): TaskSource {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req.query["token"] as string);
  const isAuthenticated = DASH_PASSWORD ? token === DASH_PASSWORD : true; // no password = open access

  // Check if request is from localhost
  const remoteAddr = req.ip || req.socket.remoteAddress || '';
  const isLocalhost = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1|localhost)$/.test(remoteAddr);

  const authenticated = isAuthenticated && (DASH_PASSWORD ? true : isLocalhost);

  return {
    type: 'dashboard',
    authenticated,
  };
}

/**
 * Build a TaskSource for an incoming WebSocket message.
 * WebSocket connections are already behind the auth middleware for /ws,
 * but we classify based on whether a password is configured.
 */
function classifyWsConnection(): TaskSource {
  // WS connections are now verified by verifyWsClient before reaching here.
  // If DASHBOARD_PASSWORD is set, only authenticated clients pass the upgrade.
  // If no password is set, localhost is trusted (open access).
  return {
    type: 'dashboard',
    authenticated: true,
  };
}

// ─── Task Submission (real LLM execution) ─────────────────────────────────

app.post('/api/tasks', async (req, res) => {
  // Tool-using tasks can take 5-10 minutes
  req.setTimeout(600000);
  res.setTimeout(600000);

  let dashAgent: AgentInfo | undefined;

  try {
    // Validate input
    const rawDescription = req.body?.description;
    if (!rawDescription || typeof rawDescription !== 'string' || rawDescription.length > 10000) {
      res.status(400).json({ error: 'Task description is required (max 10000 chars)' });
      return;
    }

    // Classify the request source and sanitize input based on trust level
    const taskSource = classifyHttpRequest(req);
    const taskTrustLevel = trustGate.classifySource(taskSource);
    const description = trustGate.sanitizeInput(rawDescription, taskTrustLevel);

    // Get swarm state — prefer directly injected state, fall back to module import
    let swarm = getInjectedSwarmState();
    if (!swarm) {
      try {
        const commands = await import('../cli/commands.js');
        swarm = commands.getSwarmState?.();
      } catch {
        // ignore
      }
    }
    if (!swarm) {
      res.status(503).json({ error: 'Swarm not ready. LLM agents are not initialized.' });
      return;
    }

    // Pick agent: requested ID, or auto-select based on task keywords
    const requestedAgent = req.body?.agentId;
    let agentId = requestedAgent;

    if (!agentId) {
      agentId = 'nova-1'; // All unrouted tasks go through Nova
    }

    const agent = swarm.agents.get(agentId);
    if (!agent) {
      const available = [...swarm.agents.keys()];
      console.error(`[TASK] Agent "${agentId}" not found. swarm.agents has ${available.length} entries: ${available.join(', ')}`);
      if (available.length === 0) {
        res.status(503).json({ error: 'No LLM provider configured. Set up Claude Code CLI, Anthropic API, OpenAI API, or Ollama to enable agents.' });
      } else {
        res.status(404).json({ error: `Agent "${agentId}" not found. Available: ${available.join(', ')}` });
      }
      return;
    }

    // Emit task started event to dashboard
    const taskEventId = `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    dashAgent = swarm.dashboardAgents.get(agentId);
    const agentName = dashAgent?.name ?? agentId;

    bus.emit('task:event', {
      id: taskEventId,
      agentId,
      agentName,
      agentType: dashAgent?.type ?? 'worker',
      action: 'execute',
      detail: description.slice(0, 100),
      timestamp: Date.now(),
      status: 'started',
    });

    // Update dashboard agent status
    if (dashAgent) {
      dashAgent.status = 'active';
      bus.emit('agent:update', dashAgent);
    }

    // Execute with the real LLM agent
    const result = await agent.execute(description);

    // Auto-save code output to files
    const output = typeof result.output === 'string' ? result.output : '';
    const codeBlocks = [...output.matchAll(/```(\w+)?\n([\s\S]*?)```/g)];
    const savedFiles: string[] = [];
    if (codeBlocks.length > 0) {
      const fs = await import('fs');
      const nodePath = await import('path');
      const outputDir = nodePath.default.resolve('output');
      fs.default.mkdirSync(outputDir, { recursive: true });

      const extMap: Record<string, string> = {
        python: '.py', py: '.py', javascript: '.js', js: '.js',
        typescript: '.ts', ts: '.ts', rust: '.rs', go: '.go',
        java: '.java', cpp: '.cpp', c: '.c', html: '.html',
        css: '.css', sh: '.sh', bash: '.sh', sql: '.sql',
        ruby: '.rb', php: '.php', swift: '.swift', kotlin: '.kt',
      };

      for (let i = 0; i < codeBlocks.length; i++) {
        const lang = (codeBlocks[i][1] || '').toLowerCase();
        const code = codeBlocks[i][2];
        const ext = extMap[lang] || '.txt';
        const slug = description.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '').toLowerCase();
        const filename = codeBlocks.length === 1
          ? `${slug}${ext}`
          : `${slug}-${i + 1}${ext}`;
        const filePath = nodePath.default.join(outputDir, filename);
        fs.default.writeFileSync(filePath, code.trim() + '\n', 'utf-8');
        savedFiles.push(filePath);
      }
    }

    // Emit task completed
    bus.emit('task:event', {
      id: `${taskEventId}-done`,
      agentId,
      agentName,
      agentType: dashAgent?.type ?? 'worker',
      action: 'complete',
      detail: `Completed: ${description.slice(0, 60)}`,
      timestamp: Date.now(),
      status: 'completed',
    });

    // Update dashboard agent stats
    if (dashAgent) {
      dashAgent.status = 'idle';
      dashAgent.tasksCompleted++;
      dashAgent.uptime = Math.floor(process.uptime());
      bus.emit('agent:update', dashAgent);
    }

    // Persist task result to memory store (if available)
    try {
      const swarm = getInjectedSwarmState();
      if (swarm?.memoryStore) {
        const outputText = typeof result.output === 'string'
          ? result.output.slice(0, 2000)
          : typeof result.reasoning === 'string'
            ? result.reasoning.slice(0, 2000)
            : '';
        if (outputText.length > 20) {
          await swarm.memoryStore.write({
            namespace: 'tasks',
            title: description.slice(0, 100),
            content: outputText,
            level: 1,
            source: agentId,
            metadata: { taskId: taskEventId, agentName },
          });
        }
      }
    } catch { /* non-critical */ }

    // Sanitize output before sending (strip raw JSONL that leaked through provider parsing)
    const sanitizedResult = { ...result };
    if (typeof sanitizedResult.output === 'string') {
      sanitizedResult.output = sanitizeAgentOutput(sanitizedResult.output);
    }
    if (typeof sanitizedResult.reasoning === 'string') {
      sanitizedResult.reasoning = sanitizeAgentOutput(sanitizedResult.reasoning);
    }

    res.json({ ...sanitizedResult, savedFiles });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Reset agent status on error too
    if (dashAgent) {
      dashAgent.status = 'idle';
      bus.emit('agent:update', dashAgent);
    }

    bus.emit('task:event', {
      id: `evt-${Date.now().toString(36)}-err`,
      agentId: req.body?.agentId ?? 'unknown',
      agentName: 'System',
      agentType: 'worker' as const,
      action: 'error',
      detail: message.slice(0, 100),
      timestamp: Date.now(),
      status: 'failed',
    });

    res.status(500).json({ error: message });
  }
});

// ─── Skills API ─────────────────────────────────────────────────────────────

app.get('/api/skills', (_req, res) => {
  // Use the real SkillRegistry if available (loaded by CLI on startup)
  const swarm = getInjectedSwarmState();
  const skillRegistry = (swarm as any)?.skillRegistry;

  if (skillRegistry?.list) {
    const skills = skillRegistry.list().map((s: any) => ({
      name: s.metadata.name,
      version: s.metadata.version,
      agent: s.metadata.agent,
      description: s.metadata.description,
      triggers: s.metadata.triggers,
      tags: s.metadata.tags ?? [],
      dependencies: s.metadata.dependencies ?? [],
      timeout: s.metadata.timeout ?? 300,
      author: s.metadata.author ?? 'unknown',
      sourcePath: s.sourcePath,
      optional: s.metadata.optional ?? false,
      enabled: true,
    }));
    res.json(skills);
    return;
  }

  // Fallback: scan filesystem directly (for standalone dashboard without CLI)
  const skillsDir = path.resolve('skills');
  try {
    const fs = require('fs');
    if (fs.existsSync(skillsDir)) {
      const skills: any[] = [];
      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.endsWith('.md') && entry !== 'SKILL_DESIGN_GUIDE.md') {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
              if (frontmatter) {
                const fm = frontmatter[1];
                const nameMatch = fm.match(/name:\s*["']?(.+?)["']?\s*$/m);
                if (!nameMatch) continue; // Skip files without a name (not skills)
                const descMatch = fm.match(/description:\s*["']?(.+?)["']?\s*$/m);
                const verMatch = fm.match(/version:\s*["']?(.+?)["']?\s*$/m);
                const agentMatch = fm.match(/agent:\s*["']?(.+?)["']?\s*$/m);
                const trigMatch = fm.match(/triggers:\s*\[(.+?)\]/);
                const tagMatch = fm.match(/tags:\s*\[(.+?)\]/);
                const optionalMatch = fm.match(/optional:\s*(true|false)/);
                skills.push({
                  name: nameMatch[1],
                  version: verMatch?.[1] ?? '1.0.0',
                  agent: agentMatch?.[1] ?? 'any',
                  description: descMatch?.[1] ?? '',
                  triggers: trigMatch ? trigMatch[1].split(',').map((t: string) => t.trim().replace(/["']/g, '')) : [],
                  tags: tagMatch ? tagMatch[1].split(',').map((t: string) => t.trim().replace(/["']/g, '')) : [],
                  sourcePath: fullPath,
                  optional: optionalMatch?.[1] === 'true',
                  enabled: true,
                });
              }
            } catch {
              // Skip unparseable files
            }
          }
        }
      };
      scanDir(skillsDir);
      res.json(skills);
      return;
    }
  } catch {
    // Fall through to empty
  }
  res.json([]);
});

// ─── Memory API ─────────────────────────────────────────────────────────────

app.get('/api/memory', async (_req, res) => {
  // Use the injected MemoryStore if available
  try {
    const swarm = getInjectedSwarmState();
    if (swarm?.memoryStore) {
      // Fetch from all namespaces — listByNamespace with '%' matches everything
      const entries = swarm.memoryStore.listByNamespace('%');
      // Map to a flat JSON-friendly format for the frontend
      res.json(entries.map((e: any) => ({
        id: e.id,
        namespace: e.namespace,
        title: e.title,
        content: e.content,
        level: e.level,
        parentId: e.parentId,
        tokenCount: e.tokenCount,
        source: e.source,
        updatedAt: e.updatedAt,
        createdAt: e.createdAt,
        metadata: e.metadata,
      })));
      return;
    }
  } catch {
    // Store not available
  }

  // Fallback: try to read directly from DB file
  try {
    const dbPath = path.resolve('data/hivemind.db');
    const fs = require('fs');
    if (fs.existsSync(dbPath)) {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare('SELECT * FROM memories ORDER BY updated_at DESC LIMIT 200').all();
      db.close();
      res.json(rows);
      return;
    }
  } catch {
    // DB not available
  }
  res.json([]);
});

app.post('/api/memory', async (req, res) => {
  try {
    const swarm = getInjectedSwarmState();
    if (!swarm?.memoryStore) {
      res.status(503).json({ error: 'Memory store not initialized' });
      return;
    }
    const { namespace, title, content, level, source } = req.body;
    if (!namespace || !title || !content) {
      res.status(400).json({ error: 'namespace, title, and content are required' });
      return;
    }
    const id = await swarm.memoryStore.write({
      namespace,
      title,
      content,
      level: level ?? 0,
      source: source ?? 'user',
    });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/memory/:id', async (req, res) => {
  try {
    const swarm = getInjectedSwarmState();
    if (!swarm?.memoryStore) {
      res.status(503).json({ error: 'Memory store not initialized' });
      return;
    }
    const deleted = swarm.memoryStore.delete(req.params.id);
    res.json({ deleted });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Config API ─────────────────────────────────────────────────────────────

app.get('/api/config', (_req, res) => {
  // Return current config (in demo mode, returns empty to use client defaults)
  res.json({});
});

app.post('/api/config', (req, res) => {
  // In a full implementation, persist to hivemind.yaml
  // For now, accept and acknowledge
  res.json({ status: 'ok' });
});

// ─── Marketplace API ────────────────────────────────────────────────────────

const marketplaceSkillsDir = path.resolve('.hivemind', 'marketplace-data');
const marketplaceDbPath = path.resolve('.hivemind', 'marketplace.db');

try {
  const fs = require('fs');
  fs.mkdirSync(path.resolve('.hivemind'), { recursive: true });
} catch {
  // Directory may already exist
}

app.use('/api/marketplace', createMarketplaceRouter({
  skillsDir: marketplaceSkillsDir,
  dbPath: marketplaceDbPath,
  authSecret: process.env['MARKETPLACE_AUTH_SECRET'],
}));

// ─── Seller Marketplace API (Amazon SP-API, Walmart, eBay) ───────────────────
// These routes connect to sellers' actual marketplace accounts for live data.

import { getMarketplaceService } from '../core/marketplace/index.js';

// Connection status for all marketplaces
app.get('/api/seller/status', (_req, res) => {
  try {
    const svc = getMarketplaceService();
    res.json(svc.getConnectionStatus());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Connect Amazon SP-API
app.post('/api/seller/connect/amazon', async (req, res) => {
  try {
    const { clientId, clientSecret, refreshToken, region } = req.body;
    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(400).json({ error: 'Missing required fields: clientId, clientSecret, refreshToken' });
    }
    const svc = getMarketplaceService();
    const result = await svc.connectAmazon(clientId, clientSecret, refreshToken, region || 'na');
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Connection failed' });
  }
});

// Connect Walmart API
app.post('/api/seller/connect/walmart', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'Missing required fields: clientId, clientSecret' });
    }
    const svc = getMarketplaceService();
    const result = await svc.connectWalmart(clientId, clientSecret);
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Connection failed' });
  }
});

// Configure eBay app (step 1: save app credentials)
app.post('/api/seller/connect/ebay/configure', (req, res) => {
  try {
    const { clientId, clientSecret, redirectUri, environment } = req.body;
    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(400).json({ error: 'Missing required fields: clientId, clientSecret, redirectUri' });
    }
    const svc = getMarketplaceService();
    svc.configureEbayApp(clientId, clientSecret, redirectUri, environment || 'production');
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Configuration failed' });
  }
});

// Get eBay authorization URL (step 2: redirect user to eBay)
app.get('/api/seller/connect/ebay/auth-url', (_req, res) => {
  try {
    const svc = getMarketplaceService();
    const state = require('crypto').randomUUID();
    const url = svc.getEbayAuthUrl(state);
    res.json({ url, state });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate auth URL' });
  }
});

// Complete eBay OAuth (step 3: exchange auth code for tokens)
app.post('/api/seller/connect/ebay/callback', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }
    const svc = getMarketplaceService();
    const result = await svc.connectEbayWithCode(code);
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'OAuth callback failed' });
  }
});

// Disconnect a marketplace
app.post('/api/seller/disconnect/:marketplace', (req, res) => {
  try {
    const marketplace = req.params['marketplace'] as 'amazon' | 'walmart' | 'ebay';
    if (!['amazon', 'walmart', 'ebay'].includes(marketplace)) {
      return res.status(400).json({ error: 'Invalid marketplace. Must be: amazon, walmart, or ebay' });
    }
    const svc = getMarketplaceService();
    svc.disconnect(marketplace);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Disconnect failed' });
  }
});

// Unified orders across all connected marketplaces
app.get('/api/seller/orders', async (req, res) => {
  try {
    const svc = getMarketplaceService();
    const since = req.query['since'] as string | undefined;
    const orders = await svc.getAllOrders(since);
    res.json({ orders, count: orders.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch orders' });
  }
});

// Unified inventory across all connected marketplaces
app.get('/api/seller/inventory', async (_req, res) => {
  try {
    const svc = getMarketplaceService();
    const inventory = await svc.getAllInventory();
    res.json({ inventory, count: inventory.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch inventory' });
  }
});

// FBA shipments (Amazon only)
app.get('/api/seller/fba/shipments', async (_req, res) => {
  try {
    const svc = getMarketplaceService();
    const shipments = await svc.getFBAShipments();
    res.json({ shipments, count: shipments.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch shipments' });
  }
});

// Account health alerts across all connected marketplaces
app.get('/api/seller/health', async (_req, res) => {
  try {
    const svc = getMarketplaceService();
    const alerts = await svc.getAccountHealthAlerts();
    res.json({ alerts, count: alerts.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch health data' });
  }
});

// Account health diagnostic — summarize all health issues and suggest actions
app.get('/api/seller/health/diagnostic', async (_req, res) => {
  try {
    const svc = getMarketplaceService();
    const alerts = await svc.getAccountHealthAlerts();
    const critical = alerts.filter(a => a.severity === 'critical');
    const warnings = alerts.filter(a => a.severity === 'warning');

    // Build diagnostic summary
    const issues: Array<{ marketplace: string; severity: string; title: string; action: string }> = [];
    for (const a of alerts) {
      let action = 'Review in Seller Central';
      if (a.type?.includes('policy') || a.type?.includes('violation')) action = 'Write a Plan of Action (POA) and submit appeal';
      else if (a.type?.includes('ip') || a.type?.includes('complaint')) action = 'Respond with proof of authenticity / authorization';
      else if (a.type?.includes('listing') || a.type?.includes('asin')) action = 'Review listing compliance and update if needed';
      else if (a.type?.includes('performance') || a.type?.includes('metric')) action = 'Check Order Defect Rate, Late Shipment Rate, and Cancellation Rate';
      else if (a.actionRequired) action = a.description || 'Immediate action required';
      issues.push({ marketplace: a.marketplace, severity: a.severity, title: a.title, action });
    }

    res.json({
      status: critical.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : 'healthy',
      criticalCount: critical.length,
      warningCount: warnings.length,
      infoCount: alerts.length - critical.length - warnings.length,
      issues,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to run diagnostic' });
  }
});

// Appeal drafting — generate an appeal letter for a specific issue type
app.post('/api/seller/appeal/draft', async (req, res) => {
  const { marketplace, issueType, issueDescription, asin } = req.body;
  if (!marketplace || !issueType) {
    return res.status(400).json({ error: 'Missing marketplace or issueType' });
  }

  // Load the relevant seller expert skill for context
  const skillName = marketplace === 'amazon' ? 'amazon-seller-expert' : marketplace === 'walmart' ? 'walmart-seller-expert' : null;
  let skillContext = '';
  if (skillName) {
    try {
      const fs = await import('fs');
      const skillPath = path.join(process.cwd(), 'skills', 'marketplace', skillName, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        skillContext = fs.readFileSync(skillPath, 'utf-8').slice(0, 4000);
      }
    } catch {}
  }

  // Generate the appeal using the agent
  const swarm = getInjectedSwarmState();
  const nova = swarm?.agents?.get('nova-1');
  if (!nova) {
    // Fallback: return a template
    const template = generateAppealTemplate(marketplace, issueType, issueDescription, asin);
    return res.json({ draft: template, source: 'template' });
  }

  // Use Nova to draft the appeal
  try {
    const prompt = `You are an expert ${marketplace} seller consultant. Draft a professional Plan of Action (POA) appeal letter for the following issue.

Issue type: ${issueType}
Description: ${issueDescription || 'Not provided'}
${asin ? `ASIN: ${asin}` : ''}
Marketplace: ${marketplace}

${skillContext ? `\nRelevant policy knowledge:\n${skillContext}\n` : ''}

Write a complete appeal letter with these sections:
1. **Root Cause** — What caused the issue
2. **Corrective Actions** — What was done to fix the immediate problem
3. **Preventive Measures** — What steps are being taken to prevent recurrence

Keep it professional, specific, and concise. Use first person. Do NOT include placeholder brackets — write it as if ready to submit.`;

    const llm = (nova as any).llm;
    if (llm?.complete) {
      const response = await llm.complete({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1500,
      });
      return res.json({ draft: response.content || response.text || '', source: 'ai' });
    }
  } catch (err) {
    console.warn('[Appeal] AI drafting failed, falling back to template:', err);
  }

  const template = generateAppealTemplate(marketplace, issueType, issueDescription, asin);
  res.json({ draft: template, source: 'template' });
});

function generateAppealTemplate(marketplace: string, issueType: string, description?: string, asin?: string): string {
  return `Dear ${marketplace.charAt(0).toUpperCase() + marketplace.slice(1)} Seller Performance Team,

I am writing regarding the ${issueType} issue${asin ? ` affecting ASIN ${asin}` : ''} on my account.
${description ? `\nIssue details: ${description}\n` : ''}
## Root Cause

After conducting a thorough investigation, I identified the following root cause:
[Describe the specific cause of the issue]

## Corrective Actions Taken

I have immediately taken the following steps to resolve this issue:
1. [First corrective action]
2. [Second corrective action]
3. [Third corrective action]

## Preventive Measures

To prevent this issue from recurring, I have implemented the following measures:
1. [First preventive measure]
2. [Second preventive measure]
3. [Third preventive measure]

I take my selling privileges seriously and am committed to maintaining the highest standards. I respectfully request that you review my account and reinstate [the listing / my selling privileges].

Thank you for your time and consideration.

Sincerely,
[Your Name]
[Your Seller ID]`;
}

// Daily briefing — aggregated snapshot across all marketplaces
app.get('/api/seller/briefing', async (_req, res) => {
  try {
    const svc = getMarketplaceService();
    const briefing = await svc.getDailyBriefing();
    res.json(briefing);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate briefing' });
  }
});

// ─── Email Module Routes ──────────────────────────────────────────────────────
// Lazy-loaded: the first request to /api/email/* triggers the import, then the
// router handles all subsequent requests. This avoids async issues with Express
// route ordering while still loading the email module on demand.
import type { Router } from 'express';
let _emailRouter: Router | null = null;
let _emailRouterLoading: Promise<void> | null = null;

app.use('/api/email', (req, res, next) => {
  if (_emailRouter) return _emailRouter(req, res, next);
  if (!_emailRouterLoading) {
    // Construct path dynamically so tsc doesn't resolve into the email module's types
    const emailRoutesPath = ['..', 'modules', 'email', 'routes.js'].join('/');
    _emailRouterLoading = (import(emailRoutesPath) as Promise<any>)
      .then((mod: any) => {
        _emailRouter = mod.createEmailRouter();
        console.log('[dashboard] Email module routes loaded');
      })
      .catch(e => {
        console.warn('[dashboard] Email module routes failed:', (e as Error).message);
        _emailRouterLoading = null; // allow retry
      });
  }
  _emailRouterLoading.then(() => {
    if (_emailRouter) _emailRouter(req, res, next);
    else res.status(503).json({ error: 'Email module not available' });
  });
});

// ─── Finance Module Routes ────────────────────────────────────────────────────
// Lazy-loaded like the email module. Provides SimpleFIN integration for
// spending capacity tracking.
let _financeRouter: Router | null = null;
let _financeRouterLoading: Promise<void> | null = null;

app.use('/api/finance', (req, res, next) => {
  if (_financeRouter) return _financeRouter(req, res, next);
  if (!_financeRouterLoading) {
    const financeRoutesPath = ['..', 'modules', 'finance', 'routes.js'].join('/');
    _financeRouterLoading = (import(financeRoutesPath) as Promise<any>)
      .then((mod: any) => {
        const swarm = getInjectedSwarmState();
        const dataDir = (swarm as any)?.workDir
          ? path.join((swarm as any).workDir, 'data')
          : path.join(process.cwd(), 'data');
        _financeRouter = mod.createFinanceRouter(dataDir);
        console.log('[dashboard] Finance module routes loaded');
      })
      .catch(e => {
        console.warn('[dashboard] Finance module routes failed:', (e as Error).message);
        _financeRouterLoading = null;
      });
  }
  _financeRouterLoading!.then(() => {
    if (_financeRouter) _financeRouter(req, res, next);
    else res.status(503).json({ error: 'Finance module not available' });
  });
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// ─── WebSocket ───────────────────────────────────────────────────────────────

const server = createServer(app);

/**
 * Verify WebSocket upgrade requests using the same auth logic as requireAuth.
 * When DASHBOARD_PASSWORD is set, the client must provide the password via
 * Authorization: Bearer <password> header or ?token=<password> query parameter.
 */
function verifyWsClient(
  info: { origin: string; secure: boolean; req: IncomingMessage },
  callback: (res: boolean, code?: number, message?: string) => void,
): void {
  if (!DASH_PASSWORD) {
    // No password configured — allow all connections (same as HTTP requireAuth)
    callback(true);
    return;
  }
  const authHeader = info.req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  if (token === DASH_PASSWORD) {
    callback(true);
    return;
  }
  // Check ?token= query parameter from the upgrade URL
  try {
    const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
    const queryToken = url.searchParams.get('token');
    if (queryToken === DASH_PASSWORD) {
      callback(true);
      return;
    }
  } catch {
    // Malformed URL — reject
  }
  callback(false, 401, 'Unauthorized');
}

const wss = new WebSocketServer({ server, path: '/ws', verifyClient: verifyWsClient });

const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);

  // Send initial state
  ws.send(JSON.stringify({ type: 'swarm:metrics', payload: computeMetrics() }));
  for (const agent of agents.values()) {
    ws.send(JSON.stringify({ type: 'agent:update', payload: agent }));
  }
  // Send full swarm graph state for the visualization
  ws.send(JSON.stringify({ type: 'swarm:graph', payload: swarmGraph.getState() }));

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));

  // Handle incoming messages (streaming task requests)
  ws.on('message', async (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'task:submit') {
      // Classify trust level for WebSocket task submissions
      const wsSource = classifyWsConnection();
      const wsTrustLevel = trustGate.classifySource(wsSource);
      const sanitizedDescription = trustGate.sanitizeInput(msg.description || '', wsTrustLevel);
      const conversationId = msg.conversationId || undefined;
      const history: Array<{ role: string; content: string }> = msg.history || [];

      if (msg.agentId) {
        // User explicitly chose an agent — bypass Nova
        await handleStreamingTask(ws, sanitizedDescription, msg.agentId, msg.taskId, conversationId, undefined, history);
      } else {
        // Everything goes through Nova
        await coordinateRequest(ws, sanitizedDescription, msg.taskId, conversationId, history);
      }
    }

    if (msg.type === 'task:followup') {
      // User sent additional context while agent is working
      const taskId = msg.taskId;
      const text = msg.text || '';
      if (taskId && text) {
        // Queue for post-stream processing
        if (!taskFollowups.has(taskId)) {
          taskFollowups.set(taskId, []);
        }
        taskFollowups.get(taskId)!.push(text);

        // Also queue followup to any active sub-tasks (e.g. scout-1, builder-1)
        // so user corrections reach delegated agents, not just Nova
        for (const [existingTaskId] of taskToAgent) {
          if (existingTaskId.startsWith(`${taskId}-`)) {
            if (!taskFollowups.has(existingTaskId)) {
              taskFollowups.set(existingTaskId, []);
            }
            taskFollowups.get(existingTaskId)!.push(text);
          }
        }

        // ── If we're waiting for a question answer, resolve it with the followup ──
        // This prevents deadlock when the user types a response instead of
        // clicking the question card (or if the card failed to render).
        const questionResolver = taskQuestionResolvers.get(taskId);
        const abortController = taskAbortControllers.get(taskId);
        if (questionResolver) {
          console.log(`[Dashboard] Resolving pending question for task ${taskId} with followup: "${text.substring(0, 80)}..."`);
          taskQuestionResolvers.delete(taskId);
          questionResolver(text);
          // Don't abort — the question loop will continue with this answer
        } else if (abortController) {
          // ── Abort Nova's active stream so the followup gets processed immediately ──
          // Nova runs as a subprocess with no stdin — we can't inject mid-stream.
          // Instead, we abort the current stream and coordinateRequest's followup
          // handler will restart with the user's message in a new turn.
          console.log(`[Dashboard] Aborting Nova stream for task ${taskId} to process followup: "${text.substring(0, 80)}..."`);
          abortController.abort();
        }

        // Also try immediate delivery for BaseAgent-based agents (non-Nova)
        // Include the original task description so the agent has full context
        const runningAgentId = taskToAgent.get(taskId);
        const swarm = getInjectedSwarmState();
        if (runningAgentId && runningAgentId !== 'nova-1' && swarm?.agents) {
          const runningAgent = swarm.agents.get(runningAgentId);
          const baseAgent = (runningAgent as any)?.baseAgent ?? runningAgent;
          if (baseAgent && typeof baseAgent.receiveMessage === 'function') {
            // Retrieve the original task description from the agent's current task if available
            const currentTask = (runningAgent as any)?.currentTask || '';
            const contextualText = currentTask
              ? `[Context: You are working on "${currentTask}"]\n\nUser follow-up: ${text}`
              : text;
            baseAgent.receiveMessage({
              from: 'user',
              to: runningAgentId,
              type: 'query' as const,
              payload: { text: contextualText, query: text, objective: currentTask || text, taskId },
              timestamp: Date.now(),
              correlationId: `followup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            });
            console.log(`[Dashboard] Follow-up delivered to ${runningAgentId} inbox for task ${taskId}`);
          }
        }

        // Acknowledge receipt — tell user their message is being processed
        if (ws.readyState === WebSocket.OPEN) {
          const humanText = text.replace(/\[Attached image:[^\]]*\]/g, '').replace(/IMPORTANT:.*$/s, '').trim();
          const hasImages = /\[Attached image:/.test(text);
          const ackLabel = humanText
            ? (humanText.length > 60 ? humanText.substring(0, 60) + '...' : humanText)
            : hasImages ? 'image(s) attached' : '...';
          const ackText = questionResolver
            ? `\n\n*Got your answer — continuing...*\n\n`
            : abortController
              ? `\n\n*Interrupting — "${ackLabel}" — Nova is re-reading with your input now.*\n\n`
              : `\n\n*Queued — "${ackLabel}" — will be processed after the current step.*\n\n`;
          ws.send(JSON.stringify({
            type: 'task:token', taskId, text: ackText,
            tokenType: 'text', agentId: 'nova-1',
          }));
        }

        ws.send(JSON.stringify({ type: 'task:followup:ack', taskId, text }));
      }
    }

    if (msg.type === 'task:answer') {
      const taskId = msg.taskId;
      const answer = typeof msg.text === 'string' ? msg.text.trim() : '';
      if (taskId && answer) {
        const resolve = taskQuestionResolvers.get(taskId);
        if (resolve) {
          taskQuestionResolvers.delete(taskId);
          resolve(answer);
        }
      }
    }

    if (msg.type === 'skills:list') {
      // Return all available skills with metadata (no instructions — just for the picker UI)
      const skillReg = (getInjectedSwarmState() as any)?.skillRegistry;
      const skills = skillReg ? skillReg.list().map((s: any) => ({
        name: s.metadata.name,
        description: s.metadata.description,
        agent: s.metadata.agent,
        tags: s.metadata.tags || [],
        version: s.metadata.version,
        triggers: s.metadata.triggers,
      })) : [];

      // Also scan for external skill packs in ~/.hivemind/skills/ and ~/.claude/skills/
      const externalSkillRoots = [
        path.join(process.env['HOME'] || '', '.hivemind', 'skills'),
        path.join(process.env['HOME'] || '', '.claude', 'skills'),
      ];
      const externalPacks: Array<{ name: string; path: string; skillCount: number }> = [];
      try {
        const fsSync = await import('fs');
        for (const homeSkillsDir of externalSkillRoots) {
          if (fsSync.existsSync(homeSkillsDir)) {
            for (const packDir of fsSync.readdirSync(homeSkillsDir)) {
              const packPath = path.join(homeSkillsDir, packDir);
              if (fsSync.statSync(packPath).isDirectory()) {
                // Look for SKILL.md files recursively
                const findSkills = (dir: string): string[] => {
                  const results: string[] = [];
                  for (const entry of fsSync.readdirSync(dir)) {
                    const full = path.join(dir, entry);
                    if (fsSync.statSync(full).isDirectory()) {
                      results.push(...findSkills(full));
                    } else if (entry === 'SKILL.md' || (entry.endsWith('.md') && entry !== 'README.md')) {
                      results.push(full);
                    }
                  }
                  return results;
                };
                externalPacks.push({
                  name: packDir,
                  path: packPath,
                  skillCount: findSkills(packPath).length,
                });
              }
            }
          }
        }
      } catch { /* non-critical */ }

      ws.send(JSON.stringify({
        type: 'skills:list',
        skills,
        externalPacks,
      }));
    }
  });

  // Heartbeat
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30_000);
  ws.on('close', () => clearInterval(interval));
});

function broadcast(message: WSMessage) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// ─── Internal Event Bus ──────────────────────────────────────────────────────

bus.on('agent:update', (agent: AgentInfo) => {
  agents.set(agent.id, agent);
  broadcast({ type: 'agent:update', payload: agent });
});

bus.on('task:event', (event: TaskEvent) => {
  taskEvents.push(event);
  if (taskEvents.length > MAX_TASK_EVENTS) {
    taskEvents.splice(0, taskEvents.length - MAX_TASK_EVENTS);
  }
  broadcast({ type: 'task:event', payload: event });
});

// Periodic metrics broadcast
setInterval(() => {
  broadcast({ type: 'swarm:metrics', payload: computeMetrics() });
}, 2_000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeMetrics(): SwarmMetrics {
  const all = Array.from(agents.values());
  return {
    totalAgents: all.length,
    activeAgents: all.filter((a) => a.status === 'active').length,
    activeTasks: all.filter((a) => a.currentTask).length,
    completedTasks: all.reduce((sum, a) => sum + a.tasksCompleted, 0),
    failedTasks: taskEvents.filter((e) => e.status === 'failed').length,
    totalMemoryMB: all.reduce((sum, a) => sum + a.memoryUsageMB, 0),
    uptimeSeconds: Math.max(...all.map((a) => a.uptime), 0),
    messagesPerSecond: 0, // computed by the metrics collector
  };
}

// ─── Output Sanitizer ────────────────────────────────────────────────────────

/**
 * Strip raw JSON event lines that leaked through provider parsing.
 * Extracts readable text from known event formats (Codex, Claude) as a safety net.
 */
function sanitizeAgentOutput(raw: string): string {
  // If it doesn't look like JSON events, return as-is
  if (!raw.includes('{"type":')) return raw;

  // Extract JSON objects using brace-depth tracking (handles embedded newlines in strings)
  const objects = extractJsonObjectsSanitizer(raw);
  if (objects.length === 0) return raw;

  const textParts: string[] = [];
  const actionParts: string[] = [];

  for (const event of objects) {
    // Codex: item.completed with agent_message
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item?.text) {
      textParts.push(event.item.text);
    }
    // Codex: item.completed with message type and content array
    if (event.type === 'item.completed' && event.item?.type === 'message' && event.item?.content) {
      const blocks = Array.isArray(event.item.content) ? event.item.content : [];
      const text = blocks
        .filter((b: any) => b.type === 'output_text' || b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
      if (text) textParts.push(text);
    }
    // Codex: item.completed with command_execution (show as action summary)
    if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
      const cmd = event.item.command || 'command';
      const shortCmd = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
      actionParts.push(`Ran: \`${shortCmd}\``);
    }
    // Codex: message.completed
    if (event.type === 'message.completed' && event.message?.content) {
      const blocks = Array.isArray(event.message.content) ? event.message.content : [];
      const text = blocks
        .filter((b: any) => b.type === 'output_text' || b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
      if (text) textParts.push(text);
    }
    // Codex: response.completed
    if (event.type === 'response.completed' && event.response?.output) {
      const outputs = Array.isArray(event.response.output) ? event.response.output : [];
      for (const item of outputs) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          const text = item.content
            .filter((b: any) => b.type === 'output_text' || b.type === 'text')
            .map((b: any) => b.text)
            .join('\n');
          if (text) textParts.push(text);
        }
      }
    }
    // Claude: assistant message with content blocks
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) textParts.push(block.text);
      }
    }
    // Claude: content_block_delta
    if (event.type === 'content_block_delta' && event.delta?.text) {
      textParts.push(event.delta.text);
    }
    // Claude: result
    if (event.type === 'result' && typeof event.result === 'string') {
      textParts.push(event.result);
    }
  }

  // If we found JSON events but couldn't extract any text, it's likely raw JSONL
  // that leaked through — don't return the raw JSON
  let result = '';
  if (actionParts.length > 0) {
    result += '**Actions taken:**\n' + actionParts.map(a => `- ${a}`).join('\n') + '\n\n';
  }
  if (textParts.length > 0) {
    result += textParts.join('\n\n');
  }

  return result || '(completed with no text output)';
}

/** Extract top-level JSON objects from concatenated/JSONL output */
function extractJsonObjectsSanitizer(raw: string): any[] {
  const results: any[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try { results.push(JSON.parse(raw.slice(start, i + 1))); } catch { /* skip */ }
        start = -1;
      }
    }
  }
  return results;
}

function getWorkDir(): string {
  return (getInjectedSwarmState() as any)?.workDir || process.cwd();
}

function createBuilderNoOpFeedback(
  originalTask: string,
  builderOutput: string,
): string {
  const outputSnippet = builderOutput.trim().slice(0, 1200) || '(no response text)';
  return `[REVISE] Builder did not modify any files in the workspace, so there is no actual code change to review.

Original task:
${originalTask}

What went wrong:
- The last Builder turn was a no-op.
- A planning or narration message is not a valid deliverable for a code task.

Required fix:
1. Read the relevant files first.
2. Apply the requested code changes in the workspace.
3. Verify the result by checking the changed files or running the relevant command.
4. Report the actual files changed.

Last Builder response:
${outputSnippet}`;
}

async function executeTrackedTask(
  ws: WebSocket,
  description: string,
  agentId: string,
  id: string,
  conversationId?: string,
  parentTaskId?: string,
  history?: Array<{ role: string; content: string }>,
): Promise<TaskExecutionResult> {
  if (agentId !== 'builder-1') {
    return {
      content: await handleStreamingTask(ws, description, agentId, id, conversationId, parentTaskId, history),
    };
  }

  const before = await snapshotWorkspace(getWorkDir());
  const content = await handleStreamingTask(ws, description, agentId, id, conversationId, parentTaskId, history);
  const after = await snapshotWorkspace(getWorkDir());

  return {
    content,
    workspaceSummary: diffWorkspaceSnapshots(before, after),
  };
}

// ─── Nova Coordinator ────────────────────────────────────────────────────────

/** Parse [DELEGATE:agent-id], [FIRE:agent-id], [HIRE:role] markers from Nova's output. */
function parseNovaMarkers(text: string) {
  const delegations: Array<{ agentId: string; description: string }> = [];
  const fires: Array<{ agentId: string; reason: string }> = [];
  const hires: Array<{ role: string; description: string }> = [];

  // Match [DELEGATE:agent-id] description (rest of line)
  const delegateRe = /\[DELEGATE:([^\]]+)\]\s*(.+)/g;
  let match;
  while ((match = delegateRe.exec(text)) !== null) {
    delegations.push({ agentId: match[1]!.trim(), description: match[2]!.trim() });
  }

  // Match [FIRE:agent-id] reason
  const fireRe = /\[FIRE:([^\]]+)\]\s*(.+)/g;
  while ((match = fireRe.exec(text)) !== null) {
    fires.push({ agentId: match[1]!.trim(), reason: match[2]!.trim() });
  }

  // Match [HIRE:role] description
  const hireRe = /\[HIRE:([^\]]+)\]\s*(.+)/g;
  while ((match = hireRe.exec(text)) !== null) {
    hires.push({ role: match[1]!.trim(), description: match[2]!.trim() });
  }

  // Strip markers from text for clean user display
  const cleanText = text
    .replace(/\[DELEGATE:[^\]]+\]\s*.+/g, '')
    .replace(/\[FIRE:[^\]]+\]\s*.+/g, '')
    .replace(/\[HIRE:[^\]]+\]\s*.+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { delegations, fires, hires, cleanText };
}

/** Nova coordinates: responds first, then delegates, then synthesizes. */
async function coordinateRequest(ws: WebSocket, description: string, taskId?: string, conversationId?: string, history?: Array<{ role: string; content: string }>) {
  const id = taskId || `task-${Date.now().toString(36)}`;
  const swarm = getInjectedSwarmState();

  if (!swarm) {
    ws.send(JSON.stringify({ type: 'task:error', taskId: id, error: 'Swarm not ready' }));
    return;
  }

  const nova = swarm.agents.get('nova-1');
  if (!nova) {
    // Fallback: if Nova isn't available, use direct routing
    await handleStreamingTask(ws, description, undefined, id, conversationId);
    return;
  }

  // Session key: isolate Nova's session per conversation
  const novaSessionKey = conversationId ? `nova-1:${conversationId}` : 'nova-1';

  // Inject project knowledge + metrics + memories + seller data into Nova's prompt
  const metricsTracker = (swarm as any).metricsTracker;
  const metricsContext = metricsTracker?.formatForPrompt?.() || '';
  const [memoryContext, projectKnowledge, sellerContext] = await Promise.all([
    loadMemoryContext(description),
    loadProjectKnowledge(description),
    loadSellerContext(),
  ]);

  // Nova also gets KNOWLEDGE_SYSTEM.md so she knows how to maintain docs
  let knowledgeRules = '';
  try {
    const workDir = (swarm as any).workDir || process.cwd();
    const fs = await import('fs');
    const knowledgePath = path.join(workDir, '.claude', 'KNOWLEDGE_SYSTEM.md');
    if (fs.existsSync(knowledgePath)) {
      knowledgeRules = `\n\n## Knowledge Maintenance Rules\n${fs.readFileSync(knowledgePath, 'utf-8').slice(0, 2000)}`;
    }
  } catch { /* non-critical */ }

  // Check if user is referencing a pending action plan from a prior response
  const pendingPlan = loadPendingActionPlan(description, conversationId);
  const actionPlanContext = pendingPlan
    ? `\n\n## Pending Action Plan (from your previous response)\nThe user is asking you to EXECUTE these actions — do NOT re-audit or re-analyze. Go straight to execution.\n\n${pendingPlan}`
    : '';

  const novaSystemPrompt = (nova as any).systemPrompt
    + (projectKnowledge || '')
    + (knowledgeRules || '')
    + (metricsContext ? `\n\n${metricsContext}` : '')
    + (memoryContext ? `\n\n## Prior Context from Memory\n${memoryContext}` : '')
    + (sellerContext || '')
    + actionPlanContext;

  ws.send(JSON.stringify({ type: 'task:start', taskId: id, agentId: 'nova-1' }));

  // ── Emit to bus so SwarmGraphTracker sees Nova's coordination task ──
  const novaDashAgent = swarm.dashboardAgents?.get('nova-1');
  const novaEventId = `evt-${Date.now().toString(36)}-nova`;
  console.log(`[Swarm] Nova coordination started: ${novaEventId}, dashAgent=${!!novaDashAgent}`);
  bus.emit('task:event', {
    id: novaEventId,
    agentId: 'nova-1',
    agentName: 'Nova',
    agentType: 'coordinator',
    action: 'coordinate',
    detail: description.slice(0, 100),
    timestamp: Date.now(),
    status: 'started',
  });
  if (novaDashAgent) {
    novaDashAgent.status = 'active';
    bus.emit('agent:update', novaDashAgent);
  }

  // Track which agent is running this task so follow-ups can be delivered mid-task
  taskToAgent.set(id, 'nova-1');
  taskMapTimestamps.set(id, Date.now());

  // Create an abort controller so user followups can interrupt Nova's stream
  const novaAbort = new AbortController();
  taskAbortControllers.set(id, novaAbort);

  try {
    const llm = (nova as any).llm;
    let streamingProvider = llm?.getProvider?.('claude-code');
    if (!streamingProvider?.completeStreaming) {
      streamingProvider = llm?.getDefaultProvider?.();
    }

    if (!streamingProvider?.completeStreaming) {
      // No streaming — fall back to direct task
      taskAbortControllers.delete(id);
      await handleStreamingTask(ws, description, 'nova-1', id, conversationId);
      return;
    }

    // Phase 1: Nova responds to user (streaming)
    // Build messages with conversation history so Nova has full context
    const chatMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: novaSystemPrompt },
    ];
    // Inject recent conversation history (prior exchanges) so Nova knows what was discussed
    if (history && history.length > 0) {
      for (const msg of history) {
        chatMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
      }
    }
    chatMessages.push({ role: 'user', content: description });

    const firstNovaTurn = await streamAssistantTurn({
      ws,
      taskId: id,
      agentId: 'nova-1',
      provider: streamingProvider,
      request: {
        messages: chatMessages,
        agentId: novaSessionKey,
        signal: novaAbort.signal,
      },
    });
    let novaFullResponse = await resolveInteractiveQuestions({
      ws,
      taskId: id,
      agentId: 'nova-1',
      provider: streamingProvider,
      sessionKey: novaSessionKey,
      systemPrompt: novaSystemPrompt,
      baseMessages: chatMessages.slice(1),
      initialContent: firstNovaTurn.cleanContent,
      initialQuestions: firstNovaTurn.questions,
      waitingText: '\n\n---\n*Waiting for your answer...*\n\n',
      resumedText: '\n\n---\n*Reading your answer and re-evaluating...*\n\n',
    });

    // ── Process any follow-ups that arrived while Nova was streaming ──
    // When a followup arrives, the stream is aborted (killed) so we get here fast.
    // We then start a new turn with the user's message so Nova sees it immediately.
    const pendingFollowups = taskFollowups.get(id);
    if (pendingFollowups && pendingFollowups.length > 0) {
      const followupText = pendingFollowups.join('\n\n');
      taskFollowups.delete(id);

      ws.send(JSON.stringify({
        type: 'task:token', taskId: id,
        text: '\n\n---\n*Reading your message and re-evaluating...*\n\n',
        tokenType: 'text', agentId: 'nova-1',
      }));

      // Fresh abort controller for the followup turn
      const followupAbort = new AbortController();
      taskAbortControllers.set(id, followupAbort);

      // Tell Nova to re-evaluate delegation in light of the user's followup
      const followupWithHint = `${followupText}\n\n(IMPORTANT: If your previous response missed any [DELEGATE] markers, include them now. The user's input may change what needs to be delegated.)`;

      // Build followup messages with full conversation history so Nova retains context
      const followupMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: novaSystemPrompt },
      ];
      if (history && history.length > 0) {
        for (const msg of history) {
          followupMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
        }
      }
      followupMessages.push(
        { role: 'user', content: description },
        { role: 'assistant', content: novaFullResponse },
        { role: 'user', content: followupWithHint },
      );

      const followupTurn = await streamAssistantTurn({
        ws,
        taskId: id,
        agentId: 'nova-1',
        provider: streamingProvider,
        request: {
          messages: followupMessages,
          agentId: novaSessionKey,
          signal: followupAbort.signal,
        },
      });
      const followupContent = await resolveInteractiveQuestions({
        ws,
        taskId: id,
        agentId: 'nova-1',
        provider: streamingProvider,
        sessionKey: novaSessionKey,
        systemPrompt: novaSystemPrompt,
        baseMessages: followupMessages.slice(1),
        initialContent: followupTurn.cleanContent,
        initialQuestions: followupTurn.questions,
        waitingText: '\n\n---\n*Waiting for your answer...*\n\n',
        resumedText: '\n\n---\n*Reading your answer and re-evaluating...*\n\n',
      });
      // Merge markers from BOTH responses — don't lose delegations from the original
      if (followupContent) {
        novaFullResponse = novaFullResponse + '\n' + followupContent;
      }
    }

    // Clean up abort controller
    taskAbortControllers.delete(id);

    // Auto-persist any action plans so follow-ups like "do all 3" have full context
    extractAndSavePendingActions(novaFullResponse, conversationId);

    // Parse Nova's response for delegation/management markers
    const { delegations, fires, hires, cleanText } = parseNovaMarkers(novaFullResponse);

    // Phase 2: Handle fires (with user confirmation via chat)
    for (const fire of fires) {
      ws.send(JSON.stringify({
        type: 'nova:firing',
        taskId: id,
        agentId: fire.agentId,
        reason: fire.reason,
      }));
      // Actual firing would require user confirmation — for now, log it
      console.log(`[Nova] Recommends firing ${fire.agentId}: ${fire.reason}`);
    }

    // Phase 3: Handle hires
    for (const hire of hires) {
      ws.send(JSON.stringify({
        type: 'nova:hiring',
        taskId: id,
        role: hire.role,
        description: hire.description,
      }));
      console.log(`[Nova] Recommends hiring ${hire.role}: ${hire.description}`);
    }

    // Phase 4: Execute delegations in parallel
    if (delegations.length > 0) {
      const agentNames = delegations.map(d => {
        const agent = swarm.agents.get(d.agentId);
        return agent ? (agent as any).identity?.name || d.agentId : d.agentId;
      });
      ws.send(JSON.stringify({
        type: 'nova:delegating',
        taskId: id,
        agents: delegations.map(d => ({ agentId: d.agentId, description: d.description })),
      }));
      console.log(`[Nova] Delegating to: ${agentNames.join(', ')}`);

      // Track delegation metrics + emit delegation events to bus for swarm graph
      for (const d of delegations) {
        metricsTracker?.recordDelegation?.(d.agentId);
        bus.emit('task:event', {
          id: `del-${Date.now().toString(36)}-${d.agentId}`,
          agentId: 'nova-1',
          targetAgentId: d.agentId,
          agentName: 'Nova',
          agentType: 'coordinator',
          action: 'delegate',
          detail: `Delegating to ${d.agentId}: ${d.description.slice(0, 60)}`,
          timestamp: Date.now(),
          status: 'delegated',
        });
      }

      // Run all delegated tasks in parallel — with live progress banners
      const startTime = Date.now();
      const results = await Promise.allSettled(
        delegations.map(async (d) => {
          const subTaskId = `${id}-${d.agentId}`;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'delegation:progress', taskId: id, agentId: d.agentId,
              description: d.description.slice(0, 100), phase: 'working',
            }));
          }
          // Include Nova's full analysis + original user request as context,
          // not just the brief delegation description line.
          const delegationPrompt = [
            `## Task from Nova`,
            d.description,
            ``,
            `## Original User Request`,
            description,
            ``,
            `## Nova's Analysis`,
            cleanText.slice(0, 4000),
          ].join('\n');
          const content = await handleStreamingTask(ws, delegationPrompt, d.agentId, subTaskId, conversationId, id);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'delegation:progress', taskId: id, agentId: d.agentId, phase: 'complete',
            }));
          }
          return { agentId: d.agentId, content, success: true };
        })
      );

      // Collect results and track metrics
      const agentResults: Array<{ agentId: string; name: string; content: string; success: boolean }> = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const delegation = delegations[i]!;
        const elapsed = Date.now() - startTime;

        if (result.status === 'fulfilled') {
          metricsTracker?.recordSuccess?.(delegation.agentId, elapsed);
          const agent = swarm.agents.get(delegation.agentId);
          agentResults.push({
            agentId: delegation.agentId,
            name: agent ? (agent as any).identity?.name || delegation.agentId : delegation.agentId,
            content: result.value.content,
            success: true,
          });
        } else {
          metricsTracker?.recordFailure?.(delegation.agentId);
          agentResults.push({
            agentId: delegation.agentId,
            name: delegation.agentId,
            content: `Error: ${result.reason}`,
            success: false,
          });
        }
      }

      // ── Post-mortem: detect failures and empty results, diagnose, recover ──
      const failedResults = agentResults.filter(r => !r.success || r.content.trim().length < 30);
      if (failedResults.length > 0) {
        ws.send(JSON.stringify({ type: 'nova:postmortem', taskId: id, failedAgents: failedResults.map(r => r.agentId) }));
        console.log(`[Nova] Post-mortem: ${failedResults.length} agent(s) failed or returned empty — ${failedResults.map(r => r.agentId).join(', ')}`);

        // Ask Nova to diagnose failures and decide recovery strategy
        const postmortemPrompt = [
          `## Post-Mortem Analysis Required`,
          ``,
          `The following agents failed or returned empty/insufficient results:`,
          ...failedResults.map(r => `- **${r.name}** (${r.agentId}): ${r.success ? 'returned empty/insufficient content' : r.content}`),
          ``,
          `Original user request: ${description}`,
          ``,
          `Original delegations:`,
          ...delegations.map(d => `- ${d.agentId}: ${d.description}`),
          ``,
          `Diagnose what went wrong and decide a recovery strategy. Respond with ONE of:`,
          `- [RETRY:agent-id] revised task description — re-delegate with a clearer/different task`,
          `- [SELF-HANDLE] — you will handle the failed task yourself in the synthesis phase`,
          `- [SKIP] — the failure is non-critical, proceed without it`,
          ``,
          `You may use multiple actions. Be specific about what went wrong and how to fix it.`,
        ].join('\n');

        let postmortemContent = '';
        await streamingProvider.completeStreaming(
          {
            messages: [
              { role: 'system', content: novaSystemPrompt },
              { role: 'user', content: postmortemPrompt },
            ],
            agentId: novaSessionKey,
          },
          (data: { text: string; type: string }) => {
            postmortemContent += data.text;
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'task:token', taskId: id, text: data.text, tokenType: data.type, agentId: 'nova-1' }));
            }
          }
        );

        // Parse recovery actions
        const retryRe = /\[RETRY:([^\]]+)\]\s*(.+)/g;
        const selfHandle = postmortemContent.includes('[SELF-HANDLE]');
        let retryMatch;
        const retries: Array<{ agentId: string; description: string }> = [];
        while ((retryMatch = retryRe.exec(postmortemContent)) !== null) {
          retries.push({ agentId: retryMatch[1]!.trim(), description: retryMatch[2]!.trim() });
        }

        // Execute retries
        if (retries.length > 0) {
          console.log(`[Nova] Post-mortem recovery: retrying ${retries.map(r => r.agentId).join(', ')}`);
          ws.send(JSON.stringify({
            type: 'nova:delegating', taskId: id,
            agents: retries.map(r => ({ agentId: r.agentId, description: `[RETRY] ${r.description}` })),
          }));

          const retryResults = await Promise.allSettled(
            retries.map(async (r) => {
              const subTaskId = `${id}-retry-${r.agentId}`;
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'delegation:progress', taskId: id, agentId: r.agentId,
                  description: `[RETRY] ${r.description.slice(0, 80)}`, phase: 'working',
                }));
              }
              const retryPrompt = [
                `## Retry — Previous Attempt Failed`,
                `Your previous attempt at this task failed or returned empty results.`,
                ``,
                `## Revised Task`,
                r.description,
                ``,
                `## Original User Request`,
                description,
              ].join('\n');
              const content = await handleStreamingTask(ws, retryPrompt, r.agentId, subTaskId, conversationId, id);
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'delegation:progress', taskId: id, agentId: r.agentId, phase: 'complete',
                }));
              }
              return { agentId: r.agentId, content, success: true };
            })
          );

          // Replace failed results with retry results
          for (const retryResult of retryResults) {
            if (retryResult.status === 'fulfilled' && retryResult.value.content.trim().length > 30) {
              const idx = agentResults.findIndex(r => r.agentId === retryResult.value.agentId);
              if (idx >= 0) {
                const agent = swarm.agents.get(retryResult.value.agentId);
                agentResults[idx] = {
                  agentId: retryResult.value.agentId,
                  name: agent ? (agent as any).identity?.name || retryResult.value.agentId : retryResult.value.agentId,
                  content: retryResult.value.content,
                  success: true,
                };
              }
            }
          }
        }

        // If Nova decided to self-handle, she'll incorporate the failed tasks in synthesis
        if (selfHandle) {
          // Add a marker so the synthesis prompt knows Nova is covering for failed agents
          const failedTasks = failedResults.map(r => {
            const d = delegations.find(del => del.agentId === r.agentId);
            return d ? d.description : '';
          }).filter(Boolean);
          agentResults.push({
            agentId: 'nova-postmortem',
            name: 'Nova (self-recovery)',
            content: `Nova is handling these tasks directly after agent failure:\n${failedTasks.map(t => `- ${t}`).join('\n')}`,
            success: true,
          });
        }
      }

      // ── Adversarial review loop: Claude (Nova) ↔ Codex (Builder) ──
      // If Builder produced code, Nova reviews it critically. They iterate
      // up to 3 rounds until Nova approves or the cap is reached.
      const builderIdx = agentResults.findIndex(r => r.agentId === 'builder-1' && r.success);
      if (builderIdx >= 0) {
        const builderResult = agentResults[builderIdx]!;
        const originalTask = delegations.find(d => d.agentId === 'builder-1')?.description || '';

        const reviewResult = await runReviewLoop(
          ws, id, conversationId || '', builderResult.content, originalTask,
          streamingProvider, novaSessionKey, novaSystemPrompt,
        );

        // Replace Builder's result with the final reviewed version
        agentResults[builderIdx] = {
          ...builderResult,
          content: reviewResult.finalCode,
        };

        // Add review context for synthesis
        if (reviewResult.history.length > 0) {
          agentResults.push({
            agentId: 'review-loop',
            name: 'Code Review',
            content: `Code went through ${reviewResult.rounds} review round(s). ${reviewResult.approved ? 'Nova approved the final version.' : 'Max rounds reached — using latest revision.'}`,
            success: true,
          });
        }
      }

      // Phase 5: Feed results back to Nova for synthesis
      if (agentResults.some(r => r.content.length > 0)) {
        ws.send(JSON.stringify({ type: 'nova:synthesizing', taskId: id }));

        const hasSelfRecovery = agentResults.some(r => r.agentId === 'nova-postmortem');
        const synthesisPrompt = `Your team has completed their tasks. Here are the results:\n\n` +
          agentResults.map(r =>
            `### ${r.name} (${r.agentId}):\n${r.content.slice(0, 5000)}\n`
          ).join('\n') +
          `\n\nSynthesize these results into a clear, unified response for the user. Be concise. Highlight the key outcomes and any issues.` +
          (hasSelfRecovery
            ? `\n\nIMPORTANT: Some agents failed and you decided to self-handle their tasks. You MUST now complete those tasks yourself as part of this response. Use your own knowledge and capabilities to deliver what the failed agents could not. Do not just acknowledge the failure — actually do the work.`
            : '');

        let synthesisContent = '';
        await streamingProvider.completeStreaming(
          {
            messages: [
              { role: 'system', content: novaSystemPrompt },
              { role: 'user', content: synthesisPrompt },
            ],
            agentId: novaSessionKey,
          },
          (data: { text: string; type: string }) => {
            if (ws.readyState === WebSocket.OPEN) {
              synthesisContent += data.text;
              ws.send(JSON.stringify({ type: 'task:token', taskId: id, text: data.text, tokenType: data.type, agentId: 'nova-1' }));
            }
          }
        );

        ws.send(JSON.stringify({ type: 'task:complete', taskId: id, agentId: 'nova-1', content: synthesisContent || cleanText }));
      } else {
        ws.send(JSON.stringify({ type: 'task:complete', taskId: id, agentId: 'nova-1', content: cleanText }));
      }
    } else {
      // No delegations — Nova handled it directly
      ws.send(JSON.stringify({ type: 'task:complete', taskId: id, agentId: 'nova-1', content: sanitizeAgentOutput(novaFullResponse) }));
    }

    // Send context usage for Nova
    if (streamingProvider.sessions) {
      const usagePct = streamingProvider.sessions.getContextUsagePercent(novaSessionKey);
      const session = streamingProvider.sessions.getSession(novaSessionKey);
      ws.send(JSON.stringify({
        type: 'context:usage',
        agentId: 'nova-1',
        percent: usagePct,
        taskCount: session.taskCount,
        tokenUsage: session.tokenUsage,
      }));
    }

    // ── Emit Nova completion to bus for SwarmGraphTracker ──
    console.log(`[Swarm] Nova coordination completed: ${novaEventId}`);
    bus.emit('task:event', {
      id: `${novaEventId}-done`,
      agentId: 'nova-1',
      agentName: 'Nova',
      agentType: 'coordinator',
      action: 'complete',
      detail: `Completed: ${description.slice(0, 60)}`,
      timestamp: Date.now(),
      status: 'completed',
    });
    if (novaDashAgent) {
      novaDashAgent.status = 'idle';
      novaDashAgent.tasksCompleted = (novaDashAgent.tasksCompleted || 0) + 1;
      bus.emit('agent:update', novaDashAgent);
    }

    taskFollowups.delete(id); // Clean up queued follow-ups
    taskToAgent.delete(id); // Clean up agent tracking
    taskMapTimestamps.delete(id); // Clean up timestamp tracking
    taskAbortControllers.delete(id); // Clean up abort controller

    // Save to memory (background — don't block response)
    const finalOutput = novaFullResponse || cleanText || '';
    saveTaskMemory(description, 'nova-1', finalOutput, conversationId).catch((err) => console.warn('[Memory] Failed to save task memory:', err.message));
  } catch (err) {
    // ── Emit Nova failure to bus for SwarmGraphTracker ──
    bus.emit('task:event', {
      id: `${novaEventId}-err`,
      agentId: 'nova-1',
      agentName: 'Nova',
      agentType: 'coordinator',
      action: 'error',
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 100),
      timestamp: Date.now(),
      status: 'failed',
    });
    if (novaDashAgent) {
      novaDashAgent.status = 'idle';
      bus.emit('agent:update', novaDashAgent);
    }

    taskFollowups.delete(id); // Clean up queued follow-ups
    taskToAgent.delete(id); // Clean up agent tracking
    taskMapTimestamps.delete(id); // Clean up timestamp tracking
    taskAbortControllers.delete(id); // Clean up abort controller
    const msg = err instanceof Error ? err.message : String(err);
    ws.send(JSON.stringify({ type: 'task:error', taskId: id, error: msg }));
  }
}

// ─── Streaming Task Handler ──────────────────────────────────────────────────

async function handleStreamingTask(ws: WebSocket, description: string, agentId?: string, taskId?: string, conversationId?: string, parentTaskId?: string, history?: Array<{ role: string; content: string }>): Promise<string> {
  const id = taskId || `task-${Date.now().toString(36)}`;

  const swarm = getInjectedSwarmState();
  if (!swarm) {
    ws.send(JSON.stringify({ type: 'task:error', taskId: id, error: 'Swarm not ready' }));
    return '';
  }

  // Auto-select agent if not specified (fallback when bypassing Nova)
  if (!agentId) {
    agentId = 'nova-1';
  }

  const agent = swarm.agents.get(agentId);
  if (!agent) {
    ws.send(JSON.stringify({ type: 'task:error', taskId: id, error: `Agent "${agentId}" not found` }));
    return '';
  }

  // Session key: use conversationId to isolate sessions per conversation
  // This prevents context from one chat bleeding into another
  const sessionKey = conversationId ? `${agentId}:${conversationId}` : agentId;

  // Resolve dashboard agent + event ID before try/catch so they're accessible in both blocks
  const dashAgent = swarm.dashboardAgents?.get(agentId!);
  const taskEventId = `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

  // Try streaming if the agent's LLM provider supports it
  try {
    ws.send(JSON.stringify({ type: 'task:start', taskId: id, agentId }));

    // ── Emit to bus so SwarmGraphTracker sees this task ──
    console.log(`[Swarm] Task started: ${taskEventId} → agent ${agentId}, dashAgent=${!!dashAgent}`);
    bus.emit('task:event', {
      id: taskEventId,
      agentId,
      agentName: dashAgent?.name ?? agentId,
      agentType: dashAgent?.type ?? 'worker',
      action: 'execute',
      detail: description.slice(0, 100),
      timestamp: Date.now(),
      status: 'started',
    });
    if (dashAgent) {
      dashAgent.status = 'active';
      console.log(`[Swarm] Agent ${agentId} → active (broadcasting)`);
      bus.emit('agent:update', dashAgent);
    }

    // Track which agent is running this task so follow-ups can be delivered mid-task
    taskToAgent.set(id, agentId);
    taskMapTimestamps.set(id, Date.now());

    const llm = (agent as any).llm;
    const baseSystemPrompt = (agent as any).systemPrompt;

    // Inject project knowledge + relevant memories + seller data into agent's system prompt
    const [projectKnowledge, memContext, agentSellerCtx] = await Promise.all([
      loadProjectKnowledge(description),
      loadMemoryContext(description),
      loadSellerContext(),
    ]);
    const systemPrompt = baseSystemPrompt
      + (projectKnowledge || '')
      + (memContext ? `\n\n## Prior Context from Memory\n${memContext}` : '')
      + (agentSellerCtx || '');

    // Find the best provider: prefer claude-code or codex (streaming + tools), then default
    const availableProviders = llm?.listProviders?.() ?? [];
    let streamingProvider = llm?.getProvider?.('claude-code') ?? llm?.getProvider?.('codex');
    console.log(`[Dashboard] Agent ${agentId} (session: ${sessionKey}): providers=[${availableProviders}], streaming=${streamingProvider?.name ?? 'none'}, hasStreaming=${!!streamingProvider?.completeStreaming}`);
    if (!streamingProvider?.completeStreaming) {
      streamingProvider = llm?.getDefaultProvider?.();
      console.log(`[Dashboard] Falling back to default provider: ${streamingProvider?.name}, hasStreaming=${!!streamingProvider?.completeStreaming}`);
    }

    let finalContent = '';
    let permissions: any;

    if (streamingProvider?.completeStreaming) {
      // Build messages with optional conversation history
      const taskMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt || '' },
      ];
      if (history && history.length > 0 && !parentTaskId) {
        for (const msg of history) {
          taskMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
        }
      }
      taskMessages.push({ role: 'user', content: description });

      // Determine permissions based on agent role
      // Without permissions, providers can't use tools — agents become text-only.
      const agentRole = agent?.type ?? (agent as any)?.identity?.role ?? '';
      const needsWriteAccess = ['builder-1', 'sentinel-1', 'nova-1'].includes(agentId!) ||
        ['worker', 'engineering', 'coordinator'].includes(agentRole);
      const isResearchAgent = ['scout-1', 'oracle-1'].includes(agentId!) ||
        ['research', 'scout', 'oracle', 'specialist'].includes(agentRole);
      if (needsWriteAccess) {
        permissions = { allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'], blockedCommands: [] as RegExp[], allowedPaths: [] as string[], maxTokens: 200_000 };
      } else if (isResearchAgent) {
        permissions = { allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch'], blockedCommands: [] as RegExp[], allowedPaths: [] as string[], maxTokens: 200_000 };
      } else {
        // Fallback: at minimum give read-only tools so the agent isn't text-only
        permissions = { allowedTools: ['Read', 'Glob', 'Grep'], blockedCommands: [] as RegExp[], allowedPaths: [] as string[], maxTokens: 100_000 };
      }

      // Streaming path — Claude Code provider with incremental tokens
      const firstAgentTurn = await streamAssistantTurn({
        ws,
        taskId: id,
        agentId,
        parentTaskId,
        provider: streamingProvider,
        request: {
          messages: taskMessages,
          agentId: sessionKey,
          permissions,
        },
      });
      finalContent = await resolveInteractiveQuestions({
        ws,
        taskId: id,
        agentId,
        provider: streamingProvider,
        sessionKey,
        systemPrompt: systemPrompt || '',
        baseMessages: taskMessages.slice(1),
        initialContent: firstAgentTurn.cleanContent,
        initialQuestions: firstAgentTurn.questions,
        permissions,
      });

      // Send context usage update after streaming completes
      if (streamingProvider.sessions) {
        const usagePct = streamingProvider.sessions.getContextUsagePercent(sessionKey);
        const session = streamingProvider.sessions.getSession(sessionKey);
        ws.send(JSON.stringify({
          type: 'context:usage',
          agentId,
          percent: usagePct,
          taskCount: session.taskCount,
          tokenUsage: session.tokenUsage,
        }));
      }
    } else {
      // Fallback: non-streaming execution
      console.log(`[Dashboard] Agent ${agentId}: NO streaming provider found, using non-streaming agent.execute()`);
      const result = await agent.execute(description);
      finalContent = typeof result.output === 'string' ? result.output : JSON.stringify(result);

      // Send context usage estimate for non-streaming agents too
      // (rough estimate based on task count since we don't have exact token data)
      const taskHistory = (agent as any).taskHistory ?? [];
      const estimatedPct = Math.min(95, taskHistory.length * 8);
      if (estimatedPct > 0) {
        ws.send(JSON.stringify({
          type: 'context:usage',
          agentId,
          percent: estimatedPct,
          taskCount: taskHistory.length,
        }));
      }
    }

    // Safety net: strip raw JSON that leaked through provider parsing
    finalContent = sanitizeAgentOutput(finalContent);

    // Process any follow-up messages that came in while the agent was working
    const followups = taskFollowups.get(id);
    if (followups && followups.length > 0 && streamingProvider?.completeStreaming) {
      const followupText = followups.join('\n\n');
      taskFollowups.delete(id);

      // Notify UI that we're processing follow-ups
      ws.send(JSON.stringify({ type: 'task:token', taskId: id, text: '\n\n---\n*Processing your follow-up...*\n\n', tokenType: 'text' }));

      // Send follow-ups as continuation in the same session
      const followupMessages = [
        { role: 'user' as const, content: description },
        { role: 'assistant' as const, content: finalContent },
        { role: 'user' as const, content: followupText },
      ];
      const followupTurn = await streamAssistantTurn({
        ws,
        taskId: id,
        agentId,
        parentTaskId,
        provider: streamingProvider,
        request: {
          messages: [{ role: 'system', content: systemPrompt || '' }, ...followupMessages],
          agentId: sessionKey,
          permissions,
        },
      });
      const followupContent = await resolveInteractiveQuestions({
        ws,
        taskId: id,
        agentId,
        provider: streamingProvider,
        sessionKey,
        systemPrompt: systemPrompt || '',
        baseMessages: followupMessages,
        initialContent: followupTurn.cleanContent,
        initialQuestions: followupTurn.questions,
        permissions,
      });
      if (followupContent) {
        finalContent += '\n\n---\n\n' + sanitizeAgentOutput(followupContent);
      }
    }
    taskFollowups.delete(id); // Clean up
    taskToAgent.delete(id);   // Clean up agent tracking
    taskQuestionResolvers.delete(id); // Clean up pending question waiters
    taskMapTimestamps.delete(id); // Clean up timestamp tracking

    // Save to memory (background — don't block response)
    // Save all tasks to memory — sub-delegations too, so Nova can recall what her team did
    saveTaskMemory(description, agentId!, finalContent, conversationId).catch((err) => console.warn('[Memory] Failed to save task memory:', err.message));

    // ── Emit task completion to bus so SwarmGraphTracker sees it ──
    bus.emit('task:event', {
      id: `${taskEventId}-done`,
      agentId,
      agentName: dashAgent?.name ?? agentId,
      agentType: dashAgent?.type ?? 'worker',
      action: 'complete',
      detail: `Completed: ${description.slice(0, 60)}`,
      timestamp: Date.now(),
      status: 'completed',
    });
    if (dashAgent) {
      dashAgent.status = 'idle';
      dashAgent.tasksCompleted = (dashAgent.tasksCompleted || 0) + 1;
      dashAgent.uptime = Math.floor(process.uptime());
      bus.emit('agent:update', dashAgent);
    }

    ws.send(JSON.stringify({ type: 'task:complete', taskId: id, agentId, content: finalContent }));
    return finalContent;
  } catch (err) {
    taskFollowups.delete(id);
    taskToAgent.delete(id);
    taskQuestionResolvers.delete(id);
    taskMapTimestamps.delete(id);
    taskAbortControllers.delete(id);
    const msg = err instanceof Error ? err.message : String(err);

    // ── Emit task failure to bus so SwarmGraphTracker sees it ──
    bus.emit('task:event', {
      id: `${taskEventId}-err`,
      agentId,
      agentName: dashAgent?.name ?? agentId,
      agentType: dashAgent?.type ?? 'worker',
      action: 'error',
      detail: msg.slice(0, 100),
      timestamp: Date.now(),
      status: 'failed',
    });
    if (dashAgent) {
      dashAgent.status = 'idle';
      bus.emit('agent:update', dashAgent);
    }

    ws.send(JSON.stringify({ type: 'task:error', taskId: id, error: msg }));
    return '';
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env["HIVEMIND_DASHBOARD_PORT"]) || 4000;

const HOST = process.env["HIVEMIND_DASHBOARD_HOST"] || '127.0.0.1';

export function startDashboard(): { server: ReturnType<typeof createServer>; app: ReturnType<typeof express>; bus: typeof bus; wss: typeof wss } {
  server.listen(PORT, HOST, () => {
    console.log(`[HIVEMIND] Dashboard running at http://localhost:${PORT}`);
  });
  return { server, app, bus, wss };
}

// ─── Swarm State Injection ────────────────────────────────────────────────────

// ── Adversarial Review Loop ─────────────────────────────────────────────────

/** Race a promise against a timeout. Rejects with an Error if the timeout fires first. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

/**
 * Claude (Nova) ↔ Codex (Builder) iterative code review.
 * Nova reviews Builder's code critically. If issues are found, feedback goes
 * back to Builder for revision. Repeats up to MAX_ROUNDS.
 *
 * Timeouts prevent the loop from hanging indefinitely — the #1 cause of
 * "agents stuck for 8 hours" reports.
 */
async function runReviewLoop(
  ws: WebSocket,
  taskId: string,
  conversationId: string,
  initialCode: string,
  originalTask: string,
  novaProvider: any,
  novaSessionKey: string,
  novaSystemPrompt: string,
): Promise<{ finalCode: string; rounds: number; approved: boolean; history: Array<{ round: number; phase: string; content: string }> }> {
  const MAX_ROUNDS = 3;
  const PER_STEP_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes per review or revision step
  const TOTAL_TIMEOUT_MS = 10 * 60 * 1000;    // 10 minutes for the entire review loop
  const loopStart = Date.now();
  let currentCode = initialCode;
  const history: Array<{ round: number; phase: string; content: string }> = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // Check overall timeout
    if (Date.now() - loopStart > TOTAL_TIMEOUT_MS) {
      console.warn(`[Review] Total review timeout reached after ${Math.round((Date.now() - loopStart) / 1000)}s — using latest code`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'task:token', taskId, text: '\n\n*Review loop timed out — using the latest version.*\n\n', tokenType: 'text', agentId: 'nova-1' }));
        ws.send(JSON.stringify({ type: 'review:complete', taskId, rounds: round - 1, approved: false }));
      }
      return { finalCode: currentCode, rounds: round - 1, approved: false, history };
    }

    // Tell UI: Nova is reviewing (visible to user so they know what's happening)
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'review:round', taskId, round, maxRounds: MAX_ROUNDS,
        phase: 'reviewing', agent: 'nova-1',
      }));
      ws.send(JSON.stringify({
        type: 'task:token', taskId,
        text: `\n\n---\n*Code review round ${round}/${MAX_ROUNDS} — Nova is reviewing Builder's code...*\n\n`,
        tokenType: 'text', agentId: 'nova-1',
      }));
    }

    // Nova reviews Builder's code (with timeout)
    const reviewPrompt = round === 1
      ? `Review this code from Builder Prime (Codex). Be critical but constructive.\n\nOriginal task: ${originalTask}\n\nCode to review:\n${currentCode.slice(0, 8000)}\n\nEvaluate:\n1. Does it correctly solve the task?\n2. Are there bugs, edge cases, or security issues?\n3. Is the approach clean and maintainable?\n\nIf the code is good, respond with [APPROVED] and a brief note why.\nIf it needs changes, respond with [REVISE] followed by specific, actionable feedback.`
      : `Review this REVISED code from Builder Prime (round ${round}). They addressed your previous feedback.\n\nOriginal task: ${originalTask}\n\nRevised code:\n${currentCode.slice(0, 8000)}\n\nHas Builder adequately addressed the issues? If yes, respond with [APPROVED]. If not, respond with [REVISE] and remaining issues.`;

    let reviewContent = '';
    try {
      await withTimeout(
        novaProvider.completeStreaming(
          {
            messages: [
              { role: 'system', content: novaSystemPrompt },
              { role: 'user', content: reviewPrompt },
            ],
            agentId: novaSessionKey,
          },
          (data: { text: string; type: string }) => {
            reviewContent += data.text;
          },
        ),
        PER_STEP_TIMEOUT_MS,
        `Review round ${round}`,
      );
    } catch (err) {
      console.warn(`[Review] Round ${round} review timed out — auto-approving`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'task:token', taskId, text: `\n\n*Review round ${round} timed out — auto-approving current code.*\n\n`, tokenType: 'text', agentId: 'nova-1' }));
        ws.send(JSON.stringify({ type: 'review:complete', taskId, rounds: round, approved: false }));
      }
      return { finalCode: currentCode, rounds: round, approved: false, history };
    }

    history.push({ round, phase: 'review', content: reviewContent.slice(0, 500) });

    // Check verdict
    if (reviewContent.includes('[APPROVED]')) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'task:token', taskId, text: `\n\n*Code approved after ${round} round(s) of review.*\n\n`, tokenType: 'text', agentId: 'nova-1' }));
        ws.send(JSON.stringify({ type: 'review:complete', taskId, rounds: round, approved: true }));
      }
      return { finalCode: currentCode, rounds: round, approved: true, history };
    }

    // Not approved — send feedback to Builder for revision
    if (round < MAX_ROUNDS) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'review:round', taskId, round, maxRounds: MAX_ROUNDS,
          phase: 'revising', agent: 'builder-1',
        }));
        ws.send(JSON.stringify({
          type: 'task:token', taskId,
          text: `\n\n*Nova requested changes — Builder is revising (round ${round + 1})...*\n\n`,
          tokenType: 'text', agentId: 'nova-1',
        }));
      }

      const revisionPrompt = `Nova (Claude) reviewed your code and requested changes:\n\n${reviewContent}\n\nOriginal task: ${originalTask}\n\nYour previous code is already applied. Address every point of feedback and revise the code.`;
      const subTaskId = `${taskId}-review-r${round}`;
      try {
        currentCode = await withTimeout(
          handleStreamingTask(ws, revisionPrompt, 'builder-1', subTaskId, conversationId, undefined),
          PER_STEP_TIMEOUT_MS,
          `Revision round ${round}`,
        );
      } catch (err) {
        console.warn(`[Review] Round ${round} revision timed out — using previous code`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'task:token', taskId, text: `\n\n*Builder revision timed out — using previous version.*\n\n`, tokenType: 'text', agentId: 'nova-1' }));
          ws.send(JSON.stringify({ type: 'review:complete', taskId, rounds: round, approved: false }));
        }
        return { finalCode: currentCode, rounds: round, approved: false, history };
      }

      history.push({ round, phase: 'revision', content: currentCode.slice(0, 500) });
    }
  }

  // Max rounds reached
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'task:token', taskId, text: `\n\n*Max review rounds (${MAX_ROUNDS}) reached — using latest version.*\n\n`, tokenType: 'text', agentId: 'nova-1' }));
    ws.send(JSON.stringify({ type: 'review:complete', taskId, rounds: MAX_ROUNDS, approved: false }));
  }
  return { finalCode: currentCode, rounds: MAX_ROUNDS, approved: false, history };
}

let _injectedSwarmState: any = null;

/** Called by upCommand to inject the live swarm state directly. */
export function setSwarmState(state: any) {
  _injectedSwarmState = state;
}

/** Used by the /api/tasks handler. */
export function getInjectedSwarmState() {
  return _injectedSwarmState;
}

export { app, server, bus, agents, broadcast, swarmGraph };
export type { AgentInfo, SwarmMetrics, TaskEvent, WSMessage, SwarmGraphState, SwarmNode, SwarmEdge };
