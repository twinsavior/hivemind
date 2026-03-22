import { EventEmitter } from 'node:events';
import * as readline from 'node:readline';

// ── Types ────────────────────────────────────────────────────────────────────

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerOptions {
  name?: string;
  version?: string;
  port?: number;
}

/** JSON-RPC 2.0 request envelope. */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 success response. */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Standard JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/** Registration record for a HIVEMIND agent exposed as an MCP tool. */
interface AgentToolRegistration {
  agentId: string;
  role: string;
  capabilities: string[];
  toolName: string;
  description: string;
}

/** The standard input schema shared by all HIVEMIND agent tools. */
const AGENT_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    task: {
      type: 'string',
      description: 'The task or request to send to this agent',
    },
    context: {
      type: 'string',
      description: 'Optional additional context for the task',
    },
  },
  required: ['task'],
  additionalProperties: false,
};

/** Default tool definitions for each HIVEMIND agent role. */
const DEFAULT_TOOLS: ReadonlyArray<{
  toolName: string;
  role: string;
  description: string;
}> = [
  {
    toolName: 'hivemind_scout',
    role: 'research',
    description: 'Research, search the web, analyze documents, gather context',
  },
  {
    toolName: 'hivemind_builder',
    role: 'engineering',
    description: 'Write code, fix bugs, refactor, create files',
  },
  {
    toolName: 'hivemind_sentinel',
    role: 'security',
    description: 'Security audit, code review, vulnerability scan, performance analysis',
  },
  {
    toolName: 'hivemind_oracle',
    role: 'analysis',
    description: 'Data analysis, predictions, strategic recommendations, trend analysis',
  },
  {
    toolName: 'hivemind_courier',
    role: 'communication',
    description: 'Draft messages, summaries, reports, notifications',
  },
  {
    toolName: 'hivemind_swarm',
    role: 'swarm',
    description: 'Coordinate multiple agents on a complex task',
  },
];

// ── Tool call handler type ───────────────────────────────────────────────────

/**
 * User-supplied handler that routes an MCP tool call to a HIVEMIND agent.
 * The MCP server itself does NOT instantiate agents — the caller wires that up.
 * This keeps the server decoupled from agent lifecycle / orchestration.
 */
export type ToolCallHandler = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ content: string; isError?: boolean }>;

// ── Server ───────────────────────────────────────────────────────────────────

/**
 * HIVEMIND MCP Server — exposes HIVEMIND agents as MCP tools.
 *
 * Implements the Model Context Protocol over JSON-RPC 2.0 on stdio so that
 * external hosts (Claude Desktop, VS Code, etc.) can invoke HIVEMIND agents
 * as tool calls.
 *
 * Usage:
 * ```ts
 * const server = new HivemindMcpServer({ name: 'hivemind' });
 * server.registerAgent('scout-1', 'research', ['web-search', 'document-analysis']);
 * server.setToolCallHandler(async (toolName, args) => {
 *   // route to orchestrator / agent
 *   return { content: 'result' };
 * });
 * await server.start();
 * ```
 */
export class HivemindMcpServer extends EventEmitter {
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly registrations: Map<string, AgentToolRegistration> = new Map();
  private toolCallHandler: ToolCallHandler | null = null;
  private rl: readline.Interface | null = null;
  private running = false;
  private initialized = false;

  /** Readable/writable streams — defaults to process stdio, overridable for tests. */
  private input: NodeJS.ReadableStream;
  private output: NodeJS.WritableStream;

  constructor(options?: McpServerOptions) {
    super();
    this.serverName = options?.name ?? 'hivemind';
    this.serverVersion = options?.version ?? '1.0.0';
    this.input = process.stdin;
    this.output = process.stdout;

    // Pre-register the default tools so getToolDefinitions() works immediately
    for (const def of DEFAULT_TOOLS) {
      this.registrations.set(def.toolName, {
        agentId: '',
        role: def.role,
        capabilities: [],
        toolName: def.toolName,
        description: def.description,
      });
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register an agent's capabilities as an MCP tool.
   * Maps the agent's role to the corresponding hivemind_* tool name.
   */
  registerAgent(agentId: string, role: string, capabilities: string[]): void {
    // Find the default tool for this role
    const defaultTool = DEFAULT_TOOLS.find((t) => t.role === role);
    const toolName = defaultTool?.toolName ?? `hivemind_${role}`;
    const description = defaultTool?.description ?? `HIVEMIND ${role} agent`;

    this.registrations.set(toolName, {
      agentId,
      role,
      capabilities,
      toolName,
      description,
    });

    this.emit('agent:registered', { agentId, toolName });
  }

  /** Return all registered tool definitions in MCP format. */
  getToolDefinitions(): McpToolDefinition[] {
    const tools: McpToolDefinition[] = [];
    for (const reg of this.registrations.values()) {
      tools.push({
        name: reg.toolName,
        description: reg.description,
        inputSchema: { ...AGENT_INPUT_SCHEMA },
      });
    }
    return tools;
  }

  /**
   * Set the handler that will be called when an MCP client invokes a tool.
   * The handler receives the tool name and arguments, and must return
   * a result string (or an error).
   */
  setToolCallHandler(handler: ToolCallHandler): void {
    this.toolCallHandler = handler;
  }

  /**
   * Handle an MCP tool call.
   * Routes to the registered tool call handler and returns the result.
   */
  async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }> {
    const reg = this.registrations.get(toolName);
    if (!reg) {
      return { content: `Unknown tool: ${toolName}`, isError: true };
    }

    // Validate required 'task' argument
    if (!args['task'] || typeof args['task'] !== 'string') {
      return { content: 'Missing required argument: task (string)', isError: true };
    }

    if (!this.toolCallHandler) {
      return {
        content: 'No tool call handler configured. Call setToolCallHandler() before handling tool calls.',
        isError: true,
      };
    }

    try {
      const result = await this.toolCallHandler(toolName, args);
      this.emit('tool:called', { toolName, args, success: !result.isError });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('tool:error', { toolName, args, error: message });
      return { content: `Tool execution failed: ${message}`, isError: true };
    }
  }

  /**
   * Start the MCP server on stdio (JSON-RPC 2.0 over newline-delimited JSON).
   * This is the transport that Claude Desktop and similar hosts expect.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.rl = readline.createInterface({
      input: this.input,
      terminal: false,
    });

    this.rl.on('line', (line: string) => {
      this.handleLine(line).catch((err) => {
        this.emit('error', err);
      });
    });

    this.rl.on('close', () => {
      this.running = false;
      this.emit('close');
    });

    this.emit('started');
  }

  /** Stop the MCP server. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.rl?.close();
    this.rl = null;
    this.emit('stopped');
  }

  /** Whether the server is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Override the I/O streams (used for testing without touching process.stdin/stdout).
   * Must be called before start().
   */
  setTransport(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): void {
    this.input = input;
    this.output = output;
  }

  // ── JSON-RPC message handling ──────────────────────────────────────────────

  /** Process a single line of input as a JSON-RPC message. */
  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      this.sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: PARSE_ERROR, message: 'Parse error: invalid JSON' },
      });
      return;
    }

    if (!request.method || request.jsonrpc !== '2.0') {
      this.sendResponse({
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: { code: INVALID_REQUEST, message: 'Invalid JSON-RPC 2.0 request' },
      });
      return;
    }

    // Route to method handler
    const response = await this.dispatch(request);
    if (response) {
      this.sendResponse(response);
    }
  }

  /** Dispatch a JSON-RPC request to the appropriate handler. */
  private async dispatch(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;

    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(id, request.params);

      case 'notifications/initialized':
        // Acknowledgement from client — no response needed (it's a notification)
        this.initialized = true;
        this.emit('client:initialized');
        return null;

      case 'tools/list':
        return this.handleToolsList(id);

      case 'tools/call':
        return this.handleToolsCall(id, request.params);

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      default:
        // If it has an id, it expects a response — return method not found.
        // If no id, it's a notification — silently ignore unknown notifications.
        if (id !== null && id !== undefined) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: METHOD_NOT_FOUND, message: `Unknown method: ${request.method}` },
          };
        }
        return null;
    }
  }

  /** Handle MCP `initialize` request — return server info and capabilities. */
  private handleInitialize(
    id: string | number | null,
    _params?: Record<string, unknown>,
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: this.serverName,
          version: this.serverVersion,
        },
      },
    };
  }

  /** Handle MCP `tools/list` request — return all registered tool definitions. */
  private handleToolsList(id: string | number | null): JsonRpcResponse {
    const tools = this.getToolDefinitions().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    return {
      jsonrpc: '2.0',
      id,
      result: { tools },
    };
  }

  /** Handle MCP `tools/call` request — route to the appropriate agent. */
  private async handleToolsCall(
    id: string | number | null,
    params?: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const toolName = params?.['name'] as string | undefined;
    const args = (params?.['arguments'] as Record<string, unknown>) ?? {};

    if (!toolName) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: INVALID_REQUEST, message: 'Missing "name" in tools/call params' },
      };
    }

    try {
      const result = await this.handleToolCall(toolName, args);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: result.content }],
          isError: result.isError ?? false,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: INTERNAL_ERROR, message },
      };
    }
  }

  /** Write a JSON-RPC response to the output stream. */
  private sendResponse(response: JsonRpcResponse): void {
    const json = JSON.stringify(response);
    this.output.write(json + '\n');
  }
}

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Generate the MCP configuration JSON that users can add to their
 * Claude Desktop config (~/.claude/mcp_servers.json or claude_desktop_config.json).
 *
 * @param serverPath — absolute path to the HIVEMIND project directory
 * @returns MCP config object ready to merge into the user's config
 *
 * Usage:
 * ```ts
 * const config = generateMcpConfig('/path/to/hivemind');
 * // Add to ~/.claude/mcp_servers.json under "mcpServers"
 * ```
 */
export function generateMcpConfig(serverPath: string): Record<string, unknown> {
  return {
    mcpServers: {
      hivemind: {
        command: 'node',
        args: [
          `${serverPath}/dist/core/mcp-server-entry.js`,
        ],
        env: {
          NODE_ENV: 'production',
        },
      },
    },
  };
}
