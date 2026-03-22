import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";

export interface LLMProviderConfig {
  provider: "openai" | "anthropic" | "ollama" | "custom";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}

export interface SwarmConfig {
  maxConcurrentAgents: number;
  taskTimeout: number;
  healthCheckInterval: number;
  retryPolicy: { maxRetries: number; backoffMs: number };
}

export interface StorageConfig {
  type: "sqlite";
  connectionString: string;
  poolSize: number;
}

export interface NotificationConfig {
  slack?: { webhookUrl: string; channel: string };
  discord?: { webhookUrl: string };
  telegram?: { botToken: string; chatId: string };
  email?: { smtp: string; from: string; to: string[] };
}

export interface HivemindConfig {
  name: string;
  version: string;
  environment: "development" | "staging" | "production";
  logLevel: "debug" | "info" | "warn" | "error";
  llm: LLMProviderConfig;
  swarm: SwarmConfig;
  storage: StorageConfig;
  notifications: NotificationConfig;
  plugins: string[];
  skills: string[];
}

const DEFAULT_CONFIG: HivemindConfig = {
  name: "hivemind",
  version: "0.1.0",
  environment: "development",
  logLevel: "info",
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    temperature: 0.7,
  },
  swarm: {
    maxConcurrentAgents: 8,
    taskTimeout: 300_000,
    healthCheckInterval: 30_000,
    retryPolicy: { maxRetries: 3, backoffMs: 1000 },
  },
  storage: {
    type: "sqlite",
    connectionString: "./data/hivemind.db",
    poolSize: 5,
  },
  notifications: {},
  plugins: [],
  skills: [],
};

export class ConfigManager {
  private config: HivemindConfig;
  private readonly configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? resolve(process.cwd(), "hivemind.yaml");
    this.config = structuredClone(DEFAULT_CONFIG);
  }

  /** Load configuration from file, env vars, and CLI args (ascending priority). */
  async load(cliArgs?: Partial<HivemindConfig>): Promise<HivemindConfig> {
    const fileConfig = this.loadFromFile();
    const envConfig = this.loadFromEnv();

    this.config = this.deepMerge(
      DEFAULT_CONFIG as unknown as Record<string, unknown>,
      fileConfig as Record<string, unknown>,
      envConfig as Record<string, unknown>,
      (cliArgs ?? {}) as Record<string, unknown>,
    ) as unknown as HivemindConfig;

    this.validate(this.config);
    return this.config;
  }

  get<K extends keyof HivemindConfig>(key: K): HivemindConfig[K] {
    return this.config[key];
  }

  getAll(): Readonly<HivemindConfig> {
    return Object.freeze({ ...this.config });
  }

  private loadFromFile(): Partial<HivemindConfig> {
    if (!existsSync(this.configPath)) return {};
    try {
      const raw = readFileSync(this.configPath, "utf-8");
      return (parseYaml(raw) ?? {}) as Partial<HivemindConfig>;
    } catch {
      console.warn(`[config] Failed to read ${this.configPath}, using defaults`);
      return {};
    }
  }

  private loadFromEnv(): Partial<HivemindConfig> {
    const env = process.env;
    const partial: Record<string, unknown> = {};

    if (env["HIVEMIND_ENV"]) partial["environment"] = env["HIVEMIND_ENV"];
    if (env["HIVEMIND_LOG_LEVEL"]) partial["logLevel"] = env["HIVEMIND_LOG_LEVEL"];
    if (env["HIVEMIND_LLM_PROVIDER"] || env["HIVEMIND_LLM_MODEL"] || env["HIVEMIND_LLM_API_KEY"]) {
      partial["llm"] = {
        ...(env["HIVEMIND_LLM_PROVIDER"] && { provider: env["HIVEMIND_LLM_PROVIDER"] }),
        ...(env["HIVEMIND_LLM_MODEL"] && { model: env["HIVEMIND_LLM_MODEL"] }),
        ...(env["HIVEMIND_LLM_API_KEY"] && { apiKey: env["HIVEMIND_LLM_API_KEY"] }),
      };
    }
    if (env["HIVEMIND_MAX_AGENTS"]) {
      partial["swarm"] = { maxConcurrentAgents: parseInt(env["HIVEMIND_MAX_AGENTS"], 10) };
    }
    return partial as Partial<HivemindConfig>;
  }

  private validate(config: HivemindConfig): void {
    const errors: string[] = [];

    if (config.swarm.maxConcurrentAgents < 1 || config.swarm.maxConcurrentAgents > 64) {
      errors.push("swarm.maxConcurrentAgents must be between 1 and 64");
    }
    if (config.swarm.taskTimeout < 1000) {
      errors.push("swarm.taskTimeout must be at least 1000ms");
    }
    if (config.llm.temperature < 0 || config.llm.temperature > 2) {
      errors.push("llm.temperature must be between 0 and 2");
    }
    if (!["development", "staging", "production"].includes(config.environment)) {
      errors.push(`Invalid environment: ${config.environment}`);
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n  - ${errors.join("\n  - ")}`);
    }
  }

  private deepMerge(...objects: Record<string, unknown>[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const obj of objects) {
      for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object") {
          result[key] = this.deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
        } else if (value !== undefined) {
          result[key] = value;
        }
      }
    }
    return result;
  }
}
