import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { HivemindMcpServer, generateMcpConfig } from '../../src/core/mcp-server.js';

/** Helper: send a JSON-RPC request and collect the response. */
async function sendRequest(
  input: PassThrough,
  output: PassThrough,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (!line) return;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        output.removeListener('data', onData);
        resolve(parsed);
      } catch {
        // not valid JSON yet, keep waiting
      }
    };
    output.on('data', onData);
    input.push(JSON.stringify(request) + '\n');
  });
}

describe('HivemindMcpServer', () => {
  let server: HivemindMcpServer;
  let input: PassThrough;
  let output: PassThrough;

  beforeEach(() => {
    server = new HivemindMcpServer({ name: 'test-hivemind', version: '0.0.1' });
    input = new PassThrough();
    output = new PassThrough();
    server.setTransport(input, output);
  });

  afterEach(async () => {
    await server.stop();
    input.destroy();
    output.destroy();
  });

  // ── Construction & registration ──────────────────────────────────────────

  describe('construction and registration', () => {
    it('has default tools pre-registered', () => {
      const tools = server.getToolDefinitions();
      const names = tools.map((t) => t.name);
      expect(names).toContain('hivemind_scout');
      expect(names).toContain('hivemind_builder');
      expect(names).toContain('hivemind_sentinel');
      expect(names).toContain('hivemind_oracle');
      expect(names).toContain('hivemind_courier');
      expect(names).toContain('hivemind_swarm');
    });

    it('returns well-formed tool definitions', () => {
      const tools = server.getToolDefinitions();
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toHaveProperty('type', 'object');
        expect(tool.inputSchema).toHaveProperty('required');
        expect((tool.inputSchema as Record<string, unknown>)['required']).toContain('task');
      }
    });

    it('registerAgent updates an existing tool registration', () => {
      server.registerAgent('scout-42', 'research', ['web-search', 'document-analysis']);
      const tools = server.getToolDefinitions();
      const scout = tools.find((t) => t.name === 'hivemind_scout');
      expect(scout).toBeDefined();
      expect(scout!.description).toBe('Research, search the web, analyze documents, gather context');
    });

    it('registerAgent with unknown role creates a custom tool', () => {
      server.registerAgent('custom-1', 'planner', ['plan', 'schedule']);
      const tools = server.getToolDefinitions();
      const custom = tools.find((t) => t.name === 'hivemind_planner');
      expect(custom).toBeDefined();
      expect(custom!.description).toBe('HIVEMIND planner agent');
    });
  });

  // ── handleToolCall ───────────────────────────────────────────────────────

  describe('handleToolCall', () => {
    it('returns error for unknown tool', async () => {
      const result = await server.handleToolCall('nonexistent', { task: 'hello' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Unknown tool');
    });

    it('returns error when task argument is missing', async () => {
      const result = await server.handleToolCall('hivemind_scout', {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required argument');
    });

    it('returns error when no handler is configured', async () => {
      const result = await server.handleToolCall('hivemind_scout', { task: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('No tool call handler configured');
    });

    it('routes to handler and returns result', async () => {
      server.setToolCallHandler(async (toolName, args) => {
        return { content: `Handled ${toolName}: ${args['task']}` };
      });

      const result = await server.handleToolCall('hivemind_scout', { task: 'find bugs' });
      expect(result.isError).toBeUndefined();
      expect(result.content).toBe('Handled hivemind_scout: find bugs');
    });

    it('catches handler errors and returns isError', async () => {
      server.setToolCallHandler(async () => {
        throw new Error('Agent crashed');
      });

      const result = await server.handleToolCall('hivemind_builder', { task: 'build' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Agent crashed');
    });

    it('emits tool:called event on success', async () => {
      const spy = vi.fn();
      server.on('tool:called', spy);
      server.setToolCallHandler(async () => ({ content: 'ok' }));

      await server.handleToolCall('hivemind_scout', { task: 'test' });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'hivemind_scout', success: true }),
      );
    });

    it('emits tool:error event on handler throw', async () => {
      const spy = vi.fn();
      server.on('tool:error', spy);
      server.setToolCallHandler(async () => { throw new Error('boom'); });

      await server.handleToolCall('hivemind_oracle', { task: 'test' });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'hivemind_oracle', error: 'boom' }),
      );
    });
  });

  // ── JSON-RPC protocol over stdio ─────────────────────────────────────────

  describe('JSON-RPC protocol', () => {
    it('handles initialize request', async () => {
      await server.start();

      const response = await sendRequest(input, output, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test-client', version: '1.0' },
        },
      });

      expect(response['jsonrpc']).toBe('2.0');
      expect(response['id']).toBe(1);
      const result = response['result'] as Record<string, unknown>;
      expect(result['protocolVersion']).toBe('2024-11-05');
      expect(result['capabilities']).toHaveProperty('tools');
      const serverInfo = result['serverInfo'] as Record<string, string>;
      expect(serverInfo['name']).toBe('test-hivemind');
      expect(serverInfo['version']).toBe('0.0.1');
    });

    it('handles tools/list request', async () => {
      await server.start();

      const response = await sendRequest(input, output, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });

      expect(response['id']).toBe(2);
      const result = response['result'] as Record<string, unknown>;
      const tools = result['tools'] as Array<Record<string, unknown>>;
      expect(tools.length).toBeGreaterThanOrEqual(6);
      const names = tools.map((t) => t['name'] as string);
      expect(names).toContain('hivemind_scout');
      expect(names).toContain('hivemind_builder');
    });

    it('handles tools/call request', async () => {
      server.setToolCallHandler(async (_toolName, args) => {
        return { content: `Result for: ${args['task']}` };
      });

      await server.start();

      const response = await sendRequest(input, output, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'hivemind_scout',
          arguments: { task: 'find security issues' },
        },
      });

      expect(response['id']).toBe(3);
      const result = response['result'] as Record<string, unknown>;
      const content = result['content'] as Array<Record<string, string>>;
      expect(content[0]!['type']).toBe('text');
      expect(content[0]!['text']).toBe('Result for: find security issues');
      expect(result['isError']).toBe(false);
    });

    it('returns error for tools/call with missing tool name', async () => {
      await server.start();

      const response = await sendRequest(input, output, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { arguments: { task: 'test' } },
      });

      expect(response['id']).toBe(4);
      expect(response['error']).toBeDefined();
      const error = response['error'] as Record<string, unknown>;
      expect(error['code']).toBe(-32600);
    });

    it('returns method not found for unknown methods', async () => {
      await server.start();

      const response = await sendRequest(input, output, {
        jsonrpc: '2.0',
        id: 5,
        method: 'unknown/method',
      });

      expect(response['id']).toBe(5);
      const error = response['error'] as Record<string, unknown>;
      expect(error['code']).toBe(-32601);
      expect(error['message']).toContain('Unknown method');
    });

    it('handles ping', async () => {
      await server.start();

      const response = await sendRequest(input, output, {
        jsonrpc: '2.0',
        id: 6,
        method: 'ping',
      });

      expect(response['id']).toBe(6);
      expect(response['result']).toEqual({});
    });

    it('returns parse error for invalid JSON', async () => {
      await server.start();

      const response = await new Promise<Record<string, unknown>>((resolve) => {
        const onData = (chunk: Buffer) => {
          const line = chunk.toString().trim();
          if (!line) return;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            output.removeListener('data', onData);
            resolve(parsed);
          } catch { /* keep waiting */ }
        };
        output.on('data', onData);
        input.push('not valid json\n');
      });

      expect(response['id']).toBeNull();
      const error = response['error'] as Record<string, unknown>;
      expect(error['code']).toBe(-32700);
    });

    it('returns invalid request for non-2.0 jsonrpc', async () => {
      await server.start();

      const response = await sendRequest(input, output, {
        jsonrpc: '1.0',
        id: 7,
        method: 'initialize',
      });

      expect(response['id']).toBe(7);
      const error = response['error'] as Record<string, unknown>;
      expect(error['code']).toBe(-32600);
    });
  });

  // ── Notifications ────────────────────────────────────────────────────────

  describe('notifications', () => {
    it('handles notifications/initialized without response', async () => {
      const spy = vi.fn();
      server.on('client:initialized', spy);

      await server.start();

      // Notifications have no id — the server should not send a response
      input.push(JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }) + '\n');

      // Give the event loop time to process
      await new Promise((r) => setTimeout(r, 50));

      expect(spy).toHaveBeenCalled();
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start and stop toggle running state', async () => {
      expect(server.isRunning()).toBe(false);
      await server.start();
      expect(server.isRunning()).toBe(true);
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('start is idempotent', async () => {
      await server.start();
      await server.start(); // should not throw
      expect(server.isRunning()).toBe(true);
    });

    it('stop is idempotent', async () => {
      await server.start();
      await server.stop();
      await server.stop(); // should not throw
      expect(server.isRunning()).toBe(false);
    });

    it('emits started and stopped events', async () => {
      const startSpy = vi.fn();
      const stopSpy = vi.fn();
      server.on('started', startSpy);
      server.on('stopped', stopSpy);

      await server.start();
      expect(startSpy).toHaveBeenCalledOnce();

      await server.stop();
      expect(stopSpy).toHaveBeenCalledOnce();
    });
  });

  // ── generateMcpConfig ────────────────────────────────────────────────────

  describe('generateMcpConfig', () => {
    it('produces a valid MCP config object', () => {
      const config = generateMcpConfig('/opt/hivemind');
      expect(config).toHaveProperty('mcpServers');
      const servers = config['mcpServers'] as Record<string, Record<string, unknown>>;
      expect(servers['hivemind']).toBeDefined();
      expect(servers['hivemind']!['command']).toBe('node');
      const args = servers['hivemind']!['args'] as string[];
      expect(args[0]).toContain('/opt/hivemind/dist/core/mcp-server-entry.js');
    });

    it('uses the provided server path', () => {
      const config = generateMcpConfig('/home/user/my-hivemind');
      const servers = config['mcpServers'] as Record<string, Record<string, unknown>>;
      const args = servers['hivemind']!['args'] as string[];
      expect(args[0]).toContain('/home/user/my-hivemind');
    });
  });
});
