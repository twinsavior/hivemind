/**
 * HIVEMIND — Distributed AI Agent Swarm Framework
 *
 * Main entry point. Exports all public APIs for building,
 * orchestrating, and monitoring agent swarms.
 */

// ─── Core ────────────────────────────────────────────────────────────────────

export { Orchestrator } from './core/orchestrator.js';
export type { Task, TaskPriority, TaskStatus, SwarmDeployment } from './core/orchestrator.js';
export { HivemindRuntime } from './core/runtime.js';
export type { Plugin, Skill, LLMProvider, RuntimeStatus } from './core/runtime.js';
export { TaskJournal } from './core/task-journal.js';
export type { PersistedTask } from './core/task-journal.js';
export {
  GuardrailEngine,
  piiDetectionGuardrail,
  costLimitGuardrail,
  contentSafetyGuardrail,
  loopDetectionGuardrail,
  fileAccessGuardrail,
  secretLeakGuardrail,
  createDefaultGuardrails,
  clearLoopHistory,
} from './core/guardrails.js';
export type {
  GuardrailTiming,
  GuardrailSeverity,
  GuardrailResult,
  Guardrail,
  GuardrailInput,
} from './core/guardrails.js';

// ─── Memory ──────────────────────────────────────────────────────────────────

export { MemoryStore } from './memory/store.js';
export type { EmbeddingProvider } from './memory/store.js';
export { MemoryLevel } from './memory/types.js';
export type {
  MemoryEntry,
  MemoryWriteOptions,
  MemoryUpdateOptions,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryStoreConfig,
} from './memory/types.js';
export { MemoryObserver } from './memory/observer.js';
export type { ObservationConfig } from './memory/observer.js';

// ─── Skills ──────────────────────────────────────────────────────────────────

export { SkillRegistry } from './skills/registry.js';
export { SkillLoader } from './skills/loader.js';
export { SkillExecutor } from './skills/skill-executor.js';
export { Workflow, WorkflowBuilder, WorkflowAbortError } from './skills/workflow.js';
export type {
  WorkflowStep,
  WorkflowStepType,
  WorkflowStepResult,
  WorkflowResult,
} from './skills/workflow.js';
export type {
  SkillDefinition,
  SkillMetadata,
  SkillResult,
  AgentRole,
} from './skills/types.js';

// ─── Dashboard ───────────────────────────────────────────────────────────────

export { startDashboard } from './dashboard/server.js';
export type { AgentInfo, SwarmMetrics, TaskEvent, WSMessage } from './dashboard/server.js';

// ─── MCP Server ──────────────────────────────────────────────────────────────

export { HivemindMcpServer, generateMcpConfig } from './core/mcp-server.js';
export type { McpToolDefinition, McpServerOptions, ToolCallHandler } from './core/mcp-server.js';

// ─── Version ─────────────────────────────────────────────────────────────────

export const VERSION = '0.1.0';
