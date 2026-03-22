/**
 * HIVEMIND Skills System — Type Definitions
 *
 * Defines the shape of skills, their metadata, execution context,
 * and the contracts between the skill loader, registry, and orchestrator.
 */

// ---------------------------------------------------------------------------
// Agent taxonomy
// ---------------------------------------------------------------------------

export type AgentRole =
  | "scout" // research & information gathering
  | "builder" // code generation & engineering
  | "communicator" // notifications, messaging, reporting
  | "monitor" // observability, health checks, alerting
  | "analyst" // data analysis, prediction, trend detection
  | "coordinator"; // orchestration, delegation, multi-agent coordination

// ---------------------------------------------------------------------------
// Skill metadata (parsed from YAML frontmatter)
// ---------------------------------------------------------------------------

export interface SkillMetadata {
  /** Unique kebab-case identifier */
  name: string;
  /** Semver version string */
  version: string;
  /** Which agent archetype executes this skill */
  agent: AgentRole;
  /** Human-readable summary */
  description: string;
  /** Natural-language triggers that activate this skill */
  triggers: string[];
  /** Other skill names this skill depends on */
  dependencies?: string[];
  /** Required environment variables or secrets */
  requiredSecrets?: string[];
  /** Maximum execution time in seconds (default 300) */
  timeout?: number;
  /** Tags for discovery */
  tags?: string[];
  /** Author identifier */
  author?: string;
}

// ---------------------------------------------------------------------------
// Parsed skill definition
// ---------------------------------------------------------------------------

export interface SkillDefinition {
  metadata: SkillMetadata;
  /** Raw Markdown body (instructions for the agent) */
  instructions: string;
  /** Absolute path to the source .md file */
  sourcePath: string;
  /** SHA-256 hash of the file for change detection */
  contentHash: string;
  /** Timestamp of last load / reload */
  loadedAt: Date;
}

// ---------------------------------------------------------------------------
// Execution context passed into a running skill
// ---------------------------------------------------------------------------

export interface SkillExecutionContext {
  /** The resolved skill definition */
  skill: SkillDefinition;
  /** Unique run identifier */
  runId: string;
  /** Key-value parameters extracted from the user prompt */
  parameters: Record<string, unknown>;
  /** Resolved secret values (name -> value) */
  secrets: Record<string, string>;
  /** Memory interface for the executing agent */
  memory: {
    read: (key: string) => Promise<unknown>;
    write: (key: string, value: unknown) => Promise<void>;
    search: (query: string, limit?: number) => Promise<unknown[]>;
  };
  /** Emit structured progress events */
  emit: (event: SkillEvent) => void;
  /** Abort signal — cancelled when timeout or user interrupt fires */
  signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Skill lifecycle events
// ---------------------------------------------------------------------------

export type SkillEventKind =
  | "progress"
  | "log"
  | "artifact"
  | "error"
  | "complete";

export interface SkillEvent {
  kind: SkillEventKind;
  timestamp: Date;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Skill execution result
// ---------------------------------------------------------------------------

export interface SkillResult {
  success: boolean;
  /** Primary output of the skill */
  output: unknown;
  /** Artifacts produced (file paths, URLs, etc.) */
  artifacts: string[];
  /** Structured logs emitted during execution */
  events: SkillEvent[];
  /** Wall-clock duration in milliseconds */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Registry query helpers
// ---------------------------------------------------------------------------

export interface SkillQuery {
  name?: string;
  agent?: AgentRole;
  tags?: string[];
  /** Free-text search over name + description + triggers */
  search?: string;
}

export interface SkillSource {
  kind: "local" | "remote";
  /** Base directory (local) or base URL (remote marketplace) */
  location: string;
}
