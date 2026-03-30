import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LLMProvider, CompletionOptions, CompletionResponse, StreamChunk, EmbeddingResponse } from './llm.js';
import { getMessageText } from './llm.js';
import { SessionManager, extractSessionId } from './session-manager.js';
import type { AgentPermissions } from './trust.js';
import { SAFE_DEFAULT_TOOL_LIST, TrustLevel } from './trust.js';

/**
 * Claude Code CLI provider — full tool use, streaming, persistent sessions.
 *
 * Each agent gets a persistent session via --resume so conversation context
 * carries across tasks. This eliminates cold-start time and gives agents
 * memory of their previous work.
 */
export class ClaudeCodeProvider extends EventEmitter implements LLMProvider {
  readonly name = 'claude-code';
  readonly supportedModels = ['claude-code', 'sonnet', 'opus', 'haiku'];

  private readonly claudePath: string;
  private readonly timeoutMs: number;
  private readonly workDir: string;
  private readonly model: string;
  readonly sessions: SessionManager;

  /** Active streaming processes keyed by agentId — allows mid-stream abort */
  private activeProcs = new Map<string, ChildProcess>();

  constructor(config: { claudePath?: string; timeoutMs?: number; workDir?: string; model?: string } = {}) {
    super();
    this.claudePath = config.claudePath ?? findClaudeBinary();
    this.timeoutMs = config.timeoutMs ?? 0; // 0 = no timeout (let agents work as long as needed)
    this.workDir = config.workDir ?? process.cwd();
    this.model = config.model ?? 'opus';  // Default to Opus (Claude Opus 4.6)
    this.sessions = new SessionManager({ maxTasksPerSession: 20 });
  }

  async complete(options: CompletionOptions & { permissions?: AgentPermissions; trustLevel?: TrustLevel }): Promise<CompletionResponse> {
    const systemMsg = options.messages.find(m => m.role === 'system');
    const userMessages = options.messages
      .filter(m => m.role !== 'system')
      .map(m => getMessageText(m))
      .join('\n\n');

    const agentId = options.requestId || 'default';
    const systemText = systemMsg ? getMessageText(systemMsg) : undefined;
    const trustLevel = options.trustLevel ?? TrustLevel.OWNER;
    const result = await this.execClaude(userMessages, systemText, agentId, options.permissions, trustLevel);

    return {
      content: result.text,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: 'claude-code',
    };
  }

  /**
   * Execute with streaming + persistent session support.
   * Handles auto-summarization when context is running low.
   */
  async completeStreaming(
    options: CompletionOptions & { agentId?: string; permissions?: AgentPermissions; trustLevel?: TrustLevel; signal?: AbortSignal },
    onToken: (data: { text: string; type: 'text' | 'action' | 'done' | 'status' }) => void
  ): Promise<CompletionResponse> {
    const systemMsg = options.messages.find(m => m.role === 'system');
    const userMessages = options.messages
      .filter(m => m.role !== 'system')
      .map(m => getMessageText(m))
      .join('\n\n');

    const agentId = options.agentId || options.requestId || 'default';
    const systemText = systemMsg ? getMessageText(systemMsg) : undefined;

    // Check if session needs summarization before this task
    if (this.sessions.needsSummarization(agentId)) {
      onToken({ text: 'Compacting context...', type: 'status' });
      await this.summarizeAndReset(agentId, systemText);
      onToken({ text: 'Context compacted. Continuing...', type: 'status' });
    }

    // Inject carryover summary if starting a fresh session after summarization
    const carryover = this.sessions.consumeCarryoverSummary(agentId);
    let effectiveSystemPrompt = systemText;
    if (carryover) {
      effectiveSystemPrompt = (effectiveSystemPrompt || '') +
        '\n\n## Session Context (carried over from previous session)\n' + carryover;
    }

    const trustLevel = options.trustLevel ?? TrustLevel.OWNER;
    const result = await this.execClaudeStreaming(userMessages, effectiveSystemPrompt, agentId, onToken, options.permissions, trustLevel, options.signal);

    // Emit context usage for UI
    const usage = this.sessions.getContextUsagePercent(agentId);
    this.emit('context:usage', { agentId, percent: usage });

    return {
      content: result.text,
      finishReason: 'stop',
      usage: { promptTokens: result.tokenUsage?.input ?? 0, completionTokens: result.tokenUsage?.output ?? 0, totalTokens: (result.tokenUsage?.input ?? 0) + (result.tokenUsage?.output ?? 0) },
      model: 'claude-code',
    };
  }

  /**
   * Summarize the current session and reset for a fresh start.
   * The summary is injected into the next session's system prompt.
   */
  private async summarizeAndReset(agentId: string, systemPrompt?: string): Promise<void> {
    const session = this.sessions.getSession(agentId);
    session.summarizing = true;

    try {
      const result = await this.execClaude(
        'Summarize our entire conversation so far in a concise but comprehensive way. Include: key decisions made, files modified, current state of work, and any pending items. Keep it under 500 words. This summary will be used to continue the work in a fresh session.',
        systemPrompt,
        agentId,
      );

      // Store summary and reset session
      this.sessions.setCarryoverSummary(agentId, result.text);
      this.sessions.resetSession(agentId);
      console.log(`[Claude] Agent ${agentId}: session summarized and reset`);
    } catch (err) {
      // If summarization fails, just reset without summary
      console.error(`[Claude] Agent ${agentId}: summarization failed, resetting without summary`, err);
      this.sessions.resetSession(agentId);
    }
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const response = await this.complete(options);
    yield { content: response.content, finishReason: 'stop' };
  }

  async embed(_texts: string[], _model?: string): Promise<EmbeddingResponse> {
    throw new Error('Claude Code CLI does not support embeddings.');
  }

  async healthCheck(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.claudePath, ['--version'], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: cleanEnv(),
      });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /** Non-streaming execution with session support and auto-retry on stale sessions */
  private execClaude(prompt: string, systemPrompt: string | undefined, agentId: string, permissions?: AgentPermissions, trustLevel: TrustLevel = TrustLevel.OWNER, _isRetry = false): Promise<{ text: string; raw: string }> {
    return new Promise((resolve, reject) => {
      const resumeId = this.sessions.getResumeId(agentId);
      const args = buildArgs(prompt, systemPrompt, 'stream-json', resumeId, this.model, permissions, trustLevel);

      const proc = spawn(this.claudePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.workDir,
        env: cleanEnv(),
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          // Capture session ID for future resume
          const sessionId = extractSessionId(stdout);
          if (sessionId) {
            this.sessions.updateSession(agentId, sessionId);
          }
          resolve({ text: extractResponse(stdout), raw: stdout });
        } else {
          const isSessionError = stderr.includes('session') || stderr.includes('resume') || stderr.includes('error_during_execution')
            || stdout.includes('"error"') || stdout.includes('invalid_session');
          if (isSessionError) {
            this.sessions.resetSession(agentId);
            // Auto-retry once without --resume if this was a stale session failure
            if (!_isRetry && resumeId) {
              console.log(`[Claude] Agent ${agentId}: stale session detected, auto-retrying without --resume`);
              resolve(this.execClaude(prompt, systemPrompt, agentId, permissions, trustLevel, true));
              return;
            }
          }
          reject(new Error(`Claude Code failed (exit ${code}): ${stderr.trim() || stdout.slice(0, 500)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start Claude Code CLI: ${err.message}`));
      });
    });
  }

  /** Streaming execution with session support and auto-retry on stale sessions */
  private execClaudeStreaming(
    prompt: string,
    systemPrompt: string | undefined,
    agentId: string,
    onToken: (data: { text: string; type: 'text' | 'action' | 'done' | 'status' }) => void,
    permissions?: AgentPermissions,
    trustLevel: TrustLevel = TrustLevel.OWNER,
    signal?: AbortSignal,
    _isRetry = false,
  ): Promise<{ text: string; raw: string; tokenUsage?: { input: number; output: number; cached: number } | null; aborted?: boolean }> {
    return new Promise((resolve, reject) => {
      const resumeId = this.sessions.getResumeId(agentId);
      const args = buildArgs(prompt, systemPrompt, 'stream-json', resumeId, this.model, permissions, trustLevel);

      console.log(`[Claude] Agent ${agentId}: ${resumeId ? `resuming session ${resumeId.slice(0, 8)}...` : 'new session'} [trust=${trustLevel}]`);

      const proc = spawn(this.claudePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.workDir,
        env: cleanEnv(),
      });

      // Track active process so it can be aborted from outside
      this.activeProcs.set(agentId, proc);
      let wasAborted = false;

      // Handle abort signal — kill process and resolve with partial text
      const onAbort = () => {
        if (!wasAborted) {
          wasAborted = true;
          console.log(`[Claude] Agent ${agentId}: stream aborted (user followup)`);
          proc.kill('SIGTERM');
        }
      };
      if (signal) {
        if (signal.aborted) { onAbort(); }
        else { signal.addEventListener('abort', onAbort, { once: true }); }
      }

      let buffer = '';
      let rawOutput = '';
      let fullText = '';
      const actions: string[] = [];
      let stderr = '';
      let capturedSessionId: string | null = null;
      let capturedUsage: { input: number; output: number; cached: number } | null = null;

      proc.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        rawOutput += chunk;
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: any;
          try { msg = JSON.parse(line); } catch { continue; }

          // Capture session ID from any message that has it
          if (msg.session_id) {
            capturedSessionId = msg.session_id;
          }

          // Capture token usage from ANY message type that includes it
          // Claude Code CLI can report usage in 'result', 'message_delta', 'assistant', etc.
          const usageSource = msg.usage || msg.message?.usage;
          if (usageSource) {
            const newInput = usageSource.input_tokens ?? usageSource.prompt_tokens ?? 0;
            const newOutput = usageSource.output_tokens ?? usageSource.completion_tokens ?? 0;
            const newCached = usageSource.cache_read_input_tokens ?? usageSource.cached_input_tokens ?? 0;
            // Take the HIGHEST values seen (usage is cumulative per conversation turn)
            if (!capturedUsage || (newInput + newOutput) > (capturedUsage.input + capturedUsage.output)) {
              capturedUsage = { input: newInput, output: newOutput, cached: newCached };
            }
          }

          // Stream text content
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                fullText += block.text;
                onToken({ text: block.text, type: 'text' });
              }
              if (block.type === 'tool_use') {
                const action = describeToolUse(block);
                if (action) {
                  actions.push(action);
                  onToken({ text: action, type: 'action' });
                }
              }
            }
          }

          if (msg.type === 'content_block_delta' && msg.delta?.text) {
            fullText += msg.delta.text;
            onToken({ text: msg.delta.text, type: 'text' });
          }

          if (msg.type === 'content_block_start' && msg.content_block?.type === 'text' && msg.content_block?.text) {
            fullText += msg.content_block.text;
            onToken({ text: msg.content_block.text, type: 'text' });
          }

          if (msg.type === 'result') {
            if (typeof msg.result === 'string' && !fullText) {
              fullText = msg.result;
              onToken({ text: msg.result, type: 'text' });
            }
            if (msg.session_id) {
              capturedSessionId = msg.session_id;
            }
            // Usage already captured by the global handler above
          }
        }
      });

      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        // Clean up active process tracking and abort listener
        this.activeProcs.delete(agentId);
        if (signal) { signal.removeEventListener('abort', onAbort); }

        // Process remaining buffer
        if (buffer.trim()) {
          try {
            const msg = JSON.parse(buffer);
            if (msg.session_id) capturedSessionId = msg.session_id;
            if (msg.type === 'result' && typeof msg.result === 'string' && !fullText) {
              fullText = msg.result;
            }
          } catch { /* ignore */ }
        }

        // Save session and token usage for next task
        if (capturedSessionId) {
          this.sessions.updateSession(agentId, capturedSessionId);
        }
        if (capturedUsage) {
          this.sessions.updateTokenUsage(agentId, capturedUsage);
        }
        const session = this.sessions.getSession(agentId);
        const usagePct = this.sessions.getContextUsagePercent(agentId);
        console.log(`[Claude] Agent ${agentId}: task #${session.taskCount}, context ${usagePct}%${capturedSessionId ? `, session ${capturedSessionId.slice(0, 8)}...` : ''}`);

        onToken({ text: '', type: 'done' });

        // If aborted, resolve with partial text (not an error)
        if (wasAborted) {
          let response = '';
          if (actions.length > 0) {
            response += '**Actions taken:**\n' + actions.map(a => `- ${a}`).join('\n') + '\n\n';
          }
          response += fullText;
          resolve({ text: response.trim(), raw: rawOutput, tokenUsage: capturedUsage, aborted: true });
          return;
        }

        if (code === 0) {
          let response = '';
          if (actions.length > 0) {
            response += '**Actions taken:**\n' + actions.map(a => `- ${a}`).join('\n') + '\n\n';
          }
          response += fullText;
          resolve({ text: response.trim() || '(completed with no text output)', raw: rawOutput, tokenUsage: capturedUsage });
        } else {
          // If session resume failed, reset and auto-retry without --resume.
          // Check stderr for actual session/resume errors (NOT stdout — stdout always has "session_id" in init JSON).
          // Only match actual session/resume errors — NOT generic API errors in stdout
          const isSessionError = stderr.includes('session') || stderr.includes('resume') || stderr.includes('error_during_execution')
            || rawOutput.includes('invalid_session') || rawOutput.includes('session_expired');
          if (isSessionError) {
            this.sessions.resetSession(agentId);
            // Auto-retry once without --resume if this was a stale session failure
            if (!_isRetry && resumeId) {
              console.log(`[Claude] Agent ${agentId}: stale session detected, auto-retrying without --resume`);
              onToken({ text: 'Session expired, retrying...', type: 'status' });
              resolve(this.execClaudeStreaming(prompt, systemPrompt, agentId, onToken, permissions, trustLevel, signal, true));
              return;
            }
          }
          // Show the actual error, not the init JSON — find the last error/result line
          const lines = rawOutput.trim().split('\n');
          let errorDetail = '';
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const msg = JSON.parse(lines[i] as string);
              if (msg.type === 'result' || msg.is_error || msg.error || (msg.type === 'system' && msg.subtype === 'error')) {
                errorDetail = (lines[i] as string).slice(0, 800);
                break;
              }
            } catch { /* not JSON, skip */ }
          }
          if (!errorDetail) errorDetail = (lines[lines.length - 1] ?? '').slice(0, 800) || rawOutput.slice(-800);
          reject(new Error(`Claude Code failed (exit ${code}): ${stderr.trim() || errorDetail}`));
        }
      });

      proc.on('error', (err) => {
        this.activeProcs.delete(agentId);
        reject(new Error(`Failed to start Claude Code CLI: ${err.message}`));
      });
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect MCP servers available in the user's Claude Code config.
 * This allows HIVEMIND agents to access the same MCP tools (Firecrawl, etc.)
 * that the user has configured.
 */
/** Cached result of MCP config detection (computed once, never changes at runtime). */
let cachedMcpConfig: string | null | undefined;

function detectMcpConfig(): string | null {
  if (cachedMcpConfig !== undefined) return cachedMcpConfig;

  try {
    const home = process.env['HOME'] ?? '/Users/' + (process.env['USER'] ?? 'user');
    const allServers: Record<string, any> = {};

    // The CLI does NOT auto-load ~/.claude/mcp_servers.json in -p (print) mode.
    // We must explicitly pass all MCP servers via --mcp-config.
    // NOTE: Do NOT use --strict-mcp-config — it is incompatible with --resume.
    const sources = [
      path.join(home, '.claude', 'mcp_servers.json'),
      path.join(process.cwd(), '.mcp.json'),
    ];

    for (const configPath of sources) {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.mcpServers) {
          for (const [name, server] of Object.entries(config.mcpServers as Record<string, any>)) {
            // Only include stdio-based servers (skip sdk, http, sse — not usable via --mcp-config)
            if (!server.type || server.type === 'stdio') {
              allServers[name] = server;
            }
          }
        }
      }
    }

    cachedMcpConfig = Object.keys(allServers).length > 0
      ? JSON.stringify({ mcpServers: allServers })
      : null;
  } catch {
    // Silently ignore — MCP is optional
    cachedMcpConfig = null;
  }
  return cachedMcpConfig;
}

function buildArgs(prompt: string, systemPrompt: string | undefined, format: string, resumeSessionId?: string | null, model?: string, permissions?: AgentPermissions, trustLevel: TrustLevel = TrustLevel.OWNER): string[] {
  const args = [
    '-p', prompt,
    '--output-format', format,
    '--verbose',
    '--max-turns', '50',       // Allow more turns for complex multi-step tasks
  ];

  // SECURITY: Only grant full tool access (--dangerously-skip-permissions) for
  // OWNER and TRUSTED trust levels. UNTRUSTED sources (connectors, unauthenticated)
  // get a restricted read-only tool allowlist and never get --dangerously-skip-permissions.
  const isTrusted = trustLevel === TrustLevel.OWNER || trustLevel === TrustLevel.TRUSTED;

  if (isTrusted) {
    args.push('--dangerously-skip-permissions');
    // Further restrict tools if permissions specify a whitelist
    if (permissions?.allowedTools?.length) {
      args.push('--allowedTools', permissions.allowedTools.join(','));
    }
  } else {
    // UNTRUSTED: use the explicit allowlist (safe defaults if none provided).
    // Without --dangerously-skip-permissions, the CLI will only allow these tools.
    const allowedTools = permissions?.allowedTools?.length
      ? permissions.allowedTools
      : SAFE_DEFAULT_TOOL_LIST;
    args.push('--allowedTools', allowedTools.join(','));
  }
  if (model) {
    args.push('--model', model);
  }
  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }
  // The CLI does NOT auto-load MCP servers in -p mode — we must pass them explicitly.
  // NOTE: Never use --strict-mcp-config here — it breaks --resume.
  const mcpConfig = detectMcpConfig();
  if (mcpConfig) {
    args.push('--mcp-config', mcpConfig);
  }
  return args;
}

function describeToolUse(block: any): string | null {
  const tool = block.name || 'unknown';
  if (tool === 'Edit' || tool === 'Write') return `Edited: ${block.input?.file_path || 'file'}`;
  if (tool === 'Bash') return `Ran: ${(block.input?.command || '').slice(0, 80)}`;
  if (tool === 'Read') return `Read: ${block.input?.file_path || 'file'}`;
  if (tool === 'Glob' || tool === 'Grep') return `Searched: ${block.input?.pattern || 'files'}`;
  if (tool === 'WebSearch') return `Searched web: ${(block.input?.query || '').slice(0, 80)}`;
  if (tool === 'WebFetch') return `Fetched: ${(block.input?.url || '').slice(0, 80)}`;
  return null;
}

function extractResponse(raw: string): string {
  const lines = raw.trim().split('\n');
  const textParts: string[] = [];
  const actions: string[] = [];

  for (const line of lines) {
    let msg: any;
    try { msg = JSON.parse(line); } catch { continue; }

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) textParts.push(block.text);
        if (block.type === 'tool_use') {
          const action = describeToolUse(block);
          if (action) actions.push(action);
        }
      }
    }
    if (msg.type === 'result' && typeof msg.result === 'string') textParts.push(msg.result);
    if (msg.content_block?.type === 'text' && msg.content_block?.text) textParts.push(msg.content_block.text);
  }

  let response = '';
  if (actions.length > 0) response += '**Actions taken:**\n' + actions.map(a => `- ${a}`).join('\n') + '\n\n';
  if (textParts.length > 0) response += textParts.join('\n');
  return response.trim() || '(completed with no text output)';
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['CLAUDECODE'];
  delete env['CLAUDE_CODE_ENTRY_POINT'];
  delete env['CLAUDE_CODE_ENTRYPOINT'];
  delete env['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'];
  delete env['CLAUDE_AGENT_SDK_VERSION'];
  delete env['CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES'];
  delete env['CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL'];
  return env;
}

function findClaudeBinary(): string {
  // 1. Bundled with Electron app (zero-install for end users)
  const bundledPaths = [
    // Packaged Electron: process.resourcesPath/node_modules/@anthropic-ai/claude-code/cli.js
    process.env['HIVEMIND_RESOURCES_PATH']
      ? path.join(process.env['HIVEMIND_RESOURCES_PATH'], 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
      : '',
    // Local dev: node_modules/@anthropic-ai/claude-code/cli.js
    path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
  ].filter(Boolean);

  for (const p of bundledPaths) {
    if (fs.existsSync(p)) return p;
  }

  // 2. macOS Claude desktop app installation
  const appSupportDir = path.join(
    process.env['HOME'] ?? '/Users/' + (process.env['USER'] ?? 'user'),
    'Library/Application Support/Claude/claude-code'
  );

  if (fs.existsSync(appSupportDir)) {
    try {
      const versions = fs.readdirSync(appSupportDir)
        .filter(d => /^\d/.test(d))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (versions.length > 0) {
        const claudeBin = path.join(appSupportDir, versions[0]!, 'claude');
        if (fs.existsSync(claudeBin)) return claudeBin;
      }
    } catch { /* fall through */ }
  }

  // 3. Common nvm/fnm/homebrew/system paths (macOS GUI apps don't inherit shell PATH)
  const home = process.env['HOME'] ?? '/Users/' + (process.env['USER'] ?? 'user');
  const globalPaths = [
    path.join(home, '.nvm/versions/node'),   // nvm
    path.join(home, 'Library/Application Support/fnm/node-versions'), // fnm
  ];
  for (const nodeDir of globalPaths) {
    try {
      const versions = fs.readdirSync(nodeDir).sort().reverse();
      for (const v of versions) {
        const binDir = nodeDir.includes('fnm') ? path.join(nodeDir, v, 'installation', 'bin') : path.join(nodeDir, v, 'bin');
        const claudeBin = path.join(binDir, 'claude');
        if (fs.existsSync(claudeBin)) return claudeBin;
      }
    } catch { /* skip */ }
  }

  // 4. Standard system paths
  for (const p of ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude']) {
    if (fs.existsSync(p)) return p;
  }

  // 5. Bare command name (relies on PATH — may fail in GUI apps)
  return 'claude';
}

export async function verifyClaudeCode(): Promise<{ ok: boolean; error?: string; path?: string }> {
  const claudePath = findClaudeBinary();

  // Try direct spawn first
  const directResult = await new Promise<{ ok: boolean; error?: string; path?: string }>((resolve) => {
    const proc = spawn(claudePath, ['--version'], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv(),
    });
    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      resolve(code === 0 ? { ok: true, path: claudePath } : { ok: false, error: 'CLI not found or not authenticated' });
    });
    proc.on('error', () => resolve({ ok: false, error: 'CLI not installed' }));
  });

  if (directResult.ok) return directResult;

  // Fallback: try through login shell (picks up nvm/fnm PATH on macOS GUI apps)
  return new Promise((resolve) => {
    const shellBin = process.env['SHELL'] || '/bin/zsh';
    const proc = spawn(shellBin, ['-lc', 'claude --version'], {
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      resolve(code === 0 ? { ok: true, path: 'claude' } : { ok: false, error: 'CLI not found via login shell' });
    });
    proc.on('error', () => resolve({ ok: false, error: 'CLI not installed' }));
  });
}
