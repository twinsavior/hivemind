#!/usr/bin/env node
/**
 * HIVEMIND MCP Server Entry Point
 *
 * Boots the HivemindMcpServer on stdio so external MCP hosts
 * (Claude Desktop, VS Code, etc.) can invoke HIVEMIND agents as tools.
 *
 * Usage:
 *   node dist/core/mcp-server-entry.js
 *
 * Add to Claude Desktop config (~/.claude/mcp_servers.json):
 *   {
 *     "mcpServers": {
 *       "hivemind": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/hivemind/dist/core/mcp-server-entry.js"],
 *         "env": { "NODE_ENV": "production" }
 *       }
 *     }
 *   }
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { HivemindMcpServer } from './mcp-server.js';

// ── Load environment variables ──────────────────────────────────────────────

const homeDir = process.env['HOME'] ?? `/Users/${process.env['USER'] ?? 'user'}`;

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('source')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(homeDir, '.config', 'shared-env', 'ai.env'));
loadEnvFile(path.join(homeDir, '.hivemind', '.env'));
loadEnvFile(path.resolve('.env'));

// ── Map MCP tool names to HIVEMIND agent roles ──────────────────────────────

const TOOL_TO_AGENT: Record<string, { id: string; role: string }> = {
  hivemind_scout:   { id: 'scout-1',   role: 'research' },
  hivemind_builder: { id: 'builder-1', role: 'engineering' },
  hivemind_sentinel:{ id: 'sentinel-1', role: 'security' },
  hivemind_oracle:  { id: 'oracle-1',  role: 'analysis' },
  hivemind_courier: { id: 'courier-1', role: 'communication' },
  hivemind_swarm:   { id: 'nova-1',    role: 'swarm' },
};

// ── Boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Lazy-import heavy deps so startup stays fast if something is missing
  const { LLMAdapter } = await import('./llm.js');
  const { LLMAgent } = await import('../agents/llm-agent.js');

  // ── Detect providers ────────────────────────────────────────────────────
  const providers: string[] = [];
  const llmConfig: Record<string, any> = {};
  let defaultProvider = '';

  if (process.env['ANTHROPIC_API_KEY']) {
    llmConfig['anthropic'] = { apiKey: process.env['ANTHROPIC_API_KEY'] };
    defaultProvider = 'anthropic';
    providers.push('anthropic');
  }
  if (process.env['OPENAI_API_KEY']) {
    llmConfig['openai'] = { apiKey: process.env['OPENAI_API_KEY'] };
    if (!defaultProvider) defaultProvider = 'openai';
    providers.push('openai');
  }
  if (process.env['GOOGLE_API_KEY']) {
    llmConfig['google'] = { apiKey: process.env['GOOGLE_API_KEY'] };
    if (!defaultProvider) defaultProvider = 'google';
    providers.push('google');
  }

  // Try Claude Code CLI
  if (!providers.includes('anthropic')) {
    try {
      const { verifyClaudeCode } = await import('./claude-code-provider.js');
      const check = await verifyClaudeCode();
      if (check.ok) {
        providers.push('claude-code');
        if (!defaultProvider) defaultProvider = 'claude-code';
      }
    } catch { /* not available */ }
  }

  if (!defaultProvider) {
    process.stderr.write('[hivemind-mcp] No LLM provider found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or install Claude Code CLI.\n');
    process.exit(1);
  }

  const llm = new LLMAdapter({
    providers: llmConfig,
    defaultProvider,
    fallbackChain: [defaultProvider],
  });

  // Register Claude Code as custom provider if available
  if (providers.includes('claude-code')) {
    try {
      const { ClaudeCodeProvider } = await import('./claude-code-provider.js');
      llm.registerProvider('claude-code', new ClaudeCodeProvider());
    } catch { /* skip */ }
  }

  // ── Create agents ───────────────────────────────────────────────────────
  const PREAMBLE = 'You are an AI agent in the HIVEMIND swarm. Execute tasks faithfully. You have full tool access.';

  const agentDefs: Array<{ id: string; name: string; role: string; prompt: string }> = [
    { id: 'nova-1',     name: 'Nova',            role: 'coordinator',  prompt: `${PREAMBLE}\n\nYou are Nova, a coordination agent. Analyze tasks, break them down, and synthesize results.` },
    { id: 'scout-1',    name: 'Scout Alpha',     role: 'scout',        prompt: `${PREAMBLE}\n\nYou are Scout Alpha, a research agent. Find information, analyze sources, and produce reports.` },
    { id: 'builder-1',  name: 'Builder Prime',   role: 'builder',      prompt: `${PREAMBLE}\n\nYou are Builder Prime, a code generation agent. Write clean, tested, production-ready code.` },
    { id: 'sentinel-1', name: 'Sentinel Watch',  role: 'sentinel',     prompt: `${PREAMBLE}\n\nYou are Sentinel Watch, a security analysis agent. Detect vulnerabilities and review code.` },
    { id: 'oracle-1',   name: 'Oracle Insight',  role: 'oracle',       prompt: `${PREAMBLE}\n\nYou are Oracle Insight, an analysis agent. Analyze trends and provide data-driven recommendations.` },
    { id: 'courier-1',  name: 'Courier Express', role: 'courier',      prompt: `${PREAMBLE}\n\nYou are Courier Express, a communication agent. Draft messages, summaries, and reports.` },
  ];

  const agents = new Map<string, InstanceType<typeof LLMAgent>>();
  for (const def of agentDefs) {
    const agent = new LLMAgent({
      identity: { id: def.id, name: def.name, role: def.role, version: '1.0.0' },
      llm,
      systemPrompt: def.prompt,
    });
    agents.set(def.id, agent);
  }

  // Optional: attach memory store
  try {
    const { MemoryStore } = await import('../memory/store.js');
    const dataDir = path.resolve('data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const store = new MemoryStore({ dbPath: path.join(dataDir, 'hivemind.db'), embeddingDimension: 384 });
    await store.initialize();
    for (const [, agent] of agents) {
      agent.attachMemoryStore(store);
    }
  } catch {
    process.stderr.write('[hivemind-mcp] Memory store unavailable — running without persistence.\n');
  }

  // ── Create MCP server ──────────────────────────────────────────────────
  const server = new HivemindMcpServer({ name: 'hivemind', version: '1.0.0' });

  // Register all agents
  for (const def of agentDefs) {
    const roleMap: Record<string, string> = {
      coordinator: 'swarm',
      scout: 'research',
      builder: 'engineering',
      sentinel: 'security',
      oracle: 'analysis',
      courier: 'communication',
    };
    server.registerAgent(def.id, roleMap[def.role] ?? def.role, []);
  }

  // Wire tool call handler — routes MCP tool calls to HIVEMIND agents
  server.setToolCallHandler(async (toolName, args) => {
    const mapping = TOOL_TO_AGENT[toolName];
    if (!mapping) {
      return { content: `Unknown tool: ${toolName}`, isError: true };
    }

    const agent = agents.get(mapping.id);
    if (!agent) {
      return { content: `Agent ${mapping.id} not available`, isError: true };
    }

    const task = args['task'] as string;
    const context = args['context'] as string | undefined;
    const fullTask = context ? `${task}\n\nContext: ${context}` : task;

    try {
      // Try streaming first (Claude Code / Codex)
      const agentLlm = (agent as any).llm;
      let provider = agentLlm?.getProvider?.('claude-code') ?? agentLlm?.getDefaultProvider?.();

      if (provider?.completeStreaming) {
        const systemPrompt = (agent as any).systemPrompt ?? '';
        const result = await provider.completeStreaming(
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: fullTask },
            ],
            agentId: mapping.id,
          },
          () => { /* MCP is request/response, no streaming callback needed */ },
        );
        return { content: typeof result === 'string' ? result : JSON.stringify(result) };
      }

      // Fallback: use the agent's execute method (cognitive loop)
      const result = await agent.execute(fullTask, new AbortController().signal);
      const output = result?.['output'] ?? result?.['result'] ?? JSON.stringify(result);
      return { content: typeof output === 'string' ? output : JSON.stringify(output) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Agent ${mapping.id} failed: ${message}`, isError: true };
    }
  });

  // ── Start listening on stdio ───────────────────────────────────────────
  process.stderr.write(`[hivemind-mcp] Server started — ${providers.join(', ')} provider(s) active, ${agents.size} agents ready\n`);

  await server.start();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`[hivemind-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
