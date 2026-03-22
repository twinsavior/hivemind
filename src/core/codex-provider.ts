import { spawn } from 'child_process';
import type { LLMProvider, CompletionOptions, CompletionResponse, StreamChunk, EmbeddingResponse } from './llm.js';
import { getMessageText } from './llm.js';
import type { AgentPermissions } from './trust.js';
import { SAFE_DEFAULT_TOOL_LIST } from './trust.js';

/**
 * OpenAI Codex CLI provider.
 *
 * Uses `codex exec` to run prompts through your ChatGPT Pro/Plus subscription.
 * No API key needed — authenticates via "Sign in with ChatGPT" in the Codex CLI.
 *
 * Requirements:
 *   npm install -g @openai/codex
 *   codex auth login
 */
export class CodexProvider implements LLMProvider {
  readonly name = 'codex';
  readonly supportedModels = ['codex', 'o4-mini', 'o3', 'gpt-4.1', 'gpt-5.4'];

  private readonly codexPath: string;
  private readonly timeoutMs: number;
  private readonly model: string;
  workDir: string;

  constructor(config: { codexPath?: string; timeoutMs?: number; model?: string; workDir?: string } = {}) {
    this.codexPath = config.codexPath ?? 'codex';
    this.timeoutMs = config.timeoutMs ?? 300_000; // 5 min default
    this.model = config.model ?? ''; // Empty = let Codex use its default (currently GPT-5.4)
    this.workDir = config.workDir ?? process.cwd();
  }

  async complete(options: CompletionOptions & { permissions?: AgentPermissions }): Promise<CompletionResponse> {
    // Build prompt from messages
    const prompt = options.messages
      .filter(m => m.role !== 'system')
      .map(m => getMessageText(m))
      .join('\n\n');

    const systemMsg = options.messages.find(m => m.role === 'system');
    const fullPrompt = systemMsg
      ? `${getMessageText(systemMsg)}\n\n${prompt}`
      : prompt;

    const result = await this.execCodex(fullPrompt, options.model, options.permissions);

    return {
      content: result,
      finishReason: 'stop',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      model: options.model ?? this.model,
    };
  }

  /**
   * Streaming execution — parses JSONL events from `codex exec --json` in real-time
   * so tokens appear in the UI as they're generated instead of all at once.
   */
  async completeStreaming(
    options: CompletionOptions & { agentId?: string; permissions?: AgentPermissions },
    onToken: (data: { text: string; type: 'text' | 'action' | 'done' | 'status' }) => void
  ): Promise<CompletionResponse> {
    const prompt = options.messages
      .filter(m => m.role !== 'system')
      .map(m => getMessageText(m))
      .join('\n\n');

    const systemMsg = options.messages.find(m => m.role === 'system');
    const fullPrompt = systemMsg
      ? `${getMessageText(systemMsg)}\n\n${prompt}`
      : prompt;

    const result = await this.execCodexStreaming(fullPrompt, options.model, options.permissions, onToken);

    return {
      content: result,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: options.model ?? this.model,
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const response = await this.complete(options);
    yield { content: response.content, finishReason: 'stop' };
  }

  async embed(_texts: string[], _model?: string): Promise<EmbeddingResponse> {
    throw new Error('Codex CLI does not support embeddings. Use OpenAI API or Ollama instead.');
  }

  async healthCheck(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.codexPath, ['--version'], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  private execCodexStreaming(
    prompt: string,
    model?: string,
    permissions?: AgentPermissions,
    onToken?: (data: { text: string; type: 'text' | 'action' | 'done' | 'status' }) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const hasWriteTools = permissions?.allowedTools?.some(t =>
        ['Edit', 'Write', 'Bash'].includes(t)
      ) ?? false;

      const args = [
        'exec', prompt,
        '--json', '--ephemeral', '--skip-git-repo-check',
      ];
      // Use --full-auto for write-capable agents, otherwise default (approval required)
      if (hasWriteTools) {
        args.push('--full-auto');
      }
      const resolvedModel = model || this.model;
      if (resolvedModel) args.push('-m', resolvedModel);

      const proc = spawn(this.codexPath, args, {
        timeout: this.timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.workDir,
        env: { ...process.env },
      });

      let buffer = '';
      let fullText = '';
      let stderr = '';
      const actions: string[] = [];

      proc.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: any;
          try { event = JSON.parse(line); } catch { continue; }

          // Stream text deltas
          if (event.type === 'message.delta' && event.delta?.content) {
            const text = typeof event.delta.content === 'string' ? event.delta.content : '';
            if (text) {
              fullText += text;
              onToken?.({ text, type: 'text' });
            }
          }

          // Completed message — extract final text
          if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item?.text) {
            // If we haven't streamed anything yet, emit the full text
            if (!fullText) {
              fullText = event.item.text;
              onToken?.({ text: event.item.text, type: 'text' });
            }
          }

          // Tool use events → action tokens
          if (event.type === 'item.completed' && event.item?.type === 'function_call') {
            const name = event.item.name || 'tool';
            const action = `${name}: ${(event.item.arguments || '').slice(0, 80)}`;
            actions.push(action);
            onToken?.({ text: action, type: 'action' });
          }

          // Content blocks with text
          if (event.type === 'item.completed' && event.item?.type === 'message' && event.item?.content) {
            const textBlocks = Array.isArray(event.item.content)
              ? event.item.content
                  .filter((b: any) => b.type === 'output_text' || b.type === 'text')
                  .map((b: any) => b.text)
                  .join('\n')
              : '';
            if (textBlocks && !fullText) {
              fullText = textBlocks;
              onToken?.({ text: textBlocks, type: 'text' });
            }
          }

          // response.completed — final fallback
          if (event.type === 'response.completed' && event.response?.output) {
            const outputs = Array.isArray(event.response.output) ? event.response.output : [];
            for (const item of outputs) {
              if (item.type === 'message' && Array.isArray(item.content)) {
                const text = item.content
                  .filter((b: any) => b.type === 'output_text' || b.type === 'text')
                  .map((b: any) => b.text)
                  .join('\n');
                if (text && !fullText) {
                  fullText = text;
                  onToken?.({ text, type: 'text' });
                }
              }
            }
          }
        }
      });

      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        onToken?.({ text: '', type: 'done' });
        if (code === 0) {
          // Build response like Claude Code does
          let response = '';
          if (actions.length > 0) {
            response += '**Actions taken:**\n' + actions.map(a => `- ${a}`).join('\n') + '\n\n';
          }
          response += fullText;
          resolve(response.trim() || '(completed with no text output)');
        } else {
          reject(new Error(`Codex exec failed (exit ${code}): ${stderr.trim()}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start Codex CLI: ${err.message}`));
      });
    });
  }

  private execCodex(prompt: string, model?: string, permissions?: AgentPermissions): Promise<string> {
    return new Promise((resolve, reject) => {
      // Determine approval mode based on permissions.
      // If permissions are provided and they include write tools (Edit/Write/Bash),
      // use --full-auto mode; otherwise default (requires approval).
      const hasWriteTools = permissions?.allowedTools?.some(t =>
        ['Edit', 'Write', 'Bash'].includes(t)
      ) ?? false;

      const args = [
        'exec',
        prompt,
        '--json',                  // JSONL event stream on stdout
        '--ephemeral',             // don't persist session files
        '--skip-git-repo-check',   // we're running outside a git repo context
      ];
      if (hasWriteTools) {
        args.push('--full-auto');
      }

      // Pass model if configured
      const resolvedModel = model || this.model;
      if (resolvedModel) {
        args.push('-m', resolvedModel);
      }

      const proc = spawn(this.codexPath, args, {
        timeout: this.timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.workDir,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Parse JSONL output to extract the agent's final message
          const content = this.parseJsonlOutput(stdout);
          resolve(content || '(no output)');
        } else {
          reject(new Error(`Codex exec failed (exit ${code}): ${stderr.trim() || stdout.trim()}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start Codex CLI: ${err.message}`));
      });
    });
  }

  /**
   * Parse JSONL event stream from `codex exec --json`.
   * Events include: session.started, turn.started, message.delta, message.completed, etc.
   * We extract the last message.completed content, falling back to concatenated deltas.
   */
  private parseJsonlOutput(raw: string): string {
    const objects = extractJsonObjects(raw);
    let lastMessage = '';
    let deltaContent = '';

    for (const event of objects) {
      // item.completed with agent_message — current Codex CLI format
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item?.text) {
        lastMessage = event.item.text;
      }

      // item.completed with message type and content array
      if (event.type === 'item.completed' && event.item?.type === 'message' && event.item?.content) {
        const textBlocks = Array.isArray(event.item.content)
          ? event.item.content
              .filter((b: any) => b.type === 'output_text' || b.type === 'text')
              .map((b: any) => b.text)
              .join('\n')
          : '';
        if (textBlocks) lastMessage = textBlocks;
      }

      // Look for completed message events (older format)
      if (event.type === 'message.completed' && event.message?.content) {
        const textBlocks = Array.isArray(event.message.content)
          ? event.message.content
              .filter((b: any) => b.type === 'output_text' || b.type === 'text')
              .map((b: any) => b.text)
              .join('\n')
          : String(event.message.content);
        if (textBlocks) lastMessage = textBlocks;
      }

      // Also collect deltas as fallback
      if (event.type === 'message.delta' && event.delta?.content) {
        deltaContent += typeof event.delta.content === 'string'
          ? event.delta.content
          : '';
      }

      // response.completed may also contain the final output
      if (event.type === 'response.completed' && event.response?.output) {
        const outputs = Array.isArray(event.response.output) ? event.response.output : [];
        for (const item of outputs) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            const text = item.content
              .filter((b: any) => b.type === 'output_text' || b.type === 'text')
              .map((b: any) => b.text)
              .join('\n');
            if (text) lastMessage = text;
          }
        }
      }
    }

    return lastMessage || deltaContent || raw.trim();
  }
}

/**
 * Extract top-level JSON objects from a string that may contain
 * concatenated JSON without newline separators, or JSON with embedded
 * newlines inside string values. Uses brace-depth tracking with
 * proper string/escape handling.
 */
function extractJsonObjects(raw: string): any[] {
  const results: any[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          results.push(JSON.parse(raw.slice(start, i + 1)));
        } catch {
          // skip malformed object
        }
        start = -1;
      }
    }
  }

  return results;
}

/**
 * Check if Codex CLI is installed and authenticated.
 */
export async function verifyCodex(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('codex', ['--version'], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: 'Codex CLI not found or not authenticated' });
      }
    });

    proc.on('error', () => {
      resolve({ ok: false, error: 'Codex CLI not installed. Run: npm install -g @openai/codex' });
    });
  });
}
