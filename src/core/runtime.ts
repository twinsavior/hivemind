import { EventEmitter } from "events";
import { resolve } from "path";
import { existsSync } from "fs";
import { ConfigManager, type HivemindConfig, type LLMProviderConfig } from "./config.js";
import { Orchestrator } from "./orchestrator.js";

export interface Plugin {
  name: string;
  version: string;
  init(runtime: HivemindRuntime): Promise<void>;
  destroy?(): Promise<void>;
}

export interface Skill {
  name: string;
  description: string;
  parameters: Record<string, { type: string; required: boolean }>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export interface LLMProvider {
  name: string;
  complete(prompt: string, options?: Partial<LLMProviderConfig>): Promise<string>;
  chat(messages: Array<{ role: string; content: string }>, options?: Partial<LLMProviderConfig>): Promise<string>;
  embed?(text: string): Promise<number[]>;
}

export type RuntimeStatus = "initializing" | "ready" | "running" | "shutting_down" | "stopped";

/** Top-level runtime that boots the HIVEMIND system. */
export class HivemindRuntime extends EventEmitter {
  readonly configManager: ConfigManager;
  readonly orchestrator: Orchestrator;

  private status: RuntimeStatus = "initializing";
  private plugins: Map<string, Plugin> = new Map();
  private skills: Map<string, Skill> = new Map();
  private llmProviders: Map<string, LLMProvider> = new Map();
  private shutdownHooks: Array<() => Promise<void>> = [];
  private config!: HivemindConfig;
  private signalHandlers: Array<{ signal: string; handler: () => void }> = [];

  constructor(configPath?: string) {
    super();
    this.configManager = new ConfigManager(configPath);
    this.orchestrator = new Orchestrator();
  }

  /** Boot the runtime: load config, plugins, skills, then start the orchestrator. */
  async start(cliArgs?: Partial<HivemindConfig>): Promise<void> {
    try {
      this.config = await this.configManager.load(cliArgs);
      this.log("info", `Starting HIVEMIND v${this.config.version} [${this.config.environment}]`);

      // Enforce runtime config on orchestrator (#2: wire config to runtime)
      this.orchestrator.applyConfig({
        maxConcurrentAgents: this.config.swarm.maxConcurrentAgents,
        taskTimeout: this.config.swarm.taskTimeout,
        healthCheckInterval: this.config.swarm.healthCheckInterval,
        retryPolicy: this.config.swarm.retryPolicy,
      });

      await this.loadPlugins(this.config.plugins);
      await this.loadSkills(this.config.skills);
      await this.initLLMProvider(this.config.llm);

      this.registerSignalHandlers();
      this.orchestrator.start();

      this.status = "running";
      this.emit("runtime:started", { timestamp: Date.now() });
      this.log("info", "HIVEMIND is operational");
    } catch (err) {
      this.status = "stopped";
      this.log("error", `Startup failed: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  /** Gracefully shut down all services, plugins, and the orchestrator. */
  async shutdown(reason = "manual"): Promise<void> {
    if (this.status === "shutting_down" || this.status === "stopped") return;
    this.status = "shutting_down";
    this.log("info", `Shutting down (reason: ${reason})...`);

    this.removeSignalHandlers();
    await this.orchestrator.stop();

    for (const hook of this.shutdownHooks.reverse()) {
      try {
        await hook();
      } catch (err) {
        this.log("warn", `Shutdown hook error: ${err}`);
      }
    }

    for (const [name, plugin] of this.plugins) {
      try {
        await plugin.destroy?.();
        this.log("debug", `Plugin "${name}" destroyed`);
      } catch (err) {
        this.log("warn", `Plugin "${name}" destroy error: ${err}`);
      }
    }

    this.plugins.clear();
    this.skills.clear();
    this.llmProviders.clear();

    this.status = "stopped";
    this.emit("runtime:stopped", { reason, timestamp: Date.now() });
    this.log("info", "HIVEMIND stopped");
  }

  /** Register a plugin at runtime. */
  async registerPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    await plugin.init(this);
    this.plugins.set(plugin.name, plugin);
    this.log("info", `Plugin loaded: ${plugin.name}@${plugin.version}`);
  }

  /** Register a skill that agents can invoke. */
  registerSkill(skill: Skill): void {
    this.skills.set(skill.name, skill);
    this.log("debug", `Skill registered: ${skill.name}`);
  }

  /** Register an LLM provider. */
  registerLLMProvider(provider: LLMProvider): void {
    this.llmProviders.set(provider.name, provider);
    this.log("debug", `LLM provider registered: ${provider.name}`);
  }

  /** Get the active LLM provider. */
  getLLMProvider(name?: string): LLMProvider | undefined {
    if (name) return this.llmProviders.get(name);
    return this.llmProviders.get(this.config.llm.provider);
  }

  /** Execute a skill by name. */
  async executeSkill(name: string, args: Record<string, unknown>): Promise<unknown> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);
    return skill.execute(args);
  }

  /** Register a hook to run during shutdown. */
  onShutdown(hook: () => Promise<void>): void {
    this.shutdownHooks.push(hook);
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  getConfig(): Readonly<HivemindConfig> {
    return this.configManager.getAll();
  }

  private async loadPlugins(pluginPaths: string[]): Promise<void> {
    for (const p of pluginPaths) {
      const absPath = resolve(process.cwd(), p);
      if (!existsSync(absPath)) {
        this.log("warn", `Plugin not found: ${absPath}`);
        continue;
      }
      try {
        const mod = await import(absPath);
        const plugin: Plugin = mod.default ?? mod;
        await this.registerPlugin(plugin);
      } catch (err) {
        this.log("error", `Failed to load plugin ${p}: ${err}`);
      }
    }
  }

  private async loadSkills(skillPaths: string[]): Promise<void> {
    for (const s of skillPaths) {
      const absPath = resolve(process.cwd(), s);
      if (!existsSync(absPath)) {
        this.log("warn", `Skill not found: ${absPath}`);
        continue;
      }
      try {
        const mod = await import(absPath);
        const skill: Skill = mod.default ?? mod;
        this.registerSkill(skill);
      } catch (err) {
        this.log("error", `Failed to load skill ${s}: ${err}`);
      }
    }
  }

  private async initLLMProvider(llmConfig: LLMProviderConfig): Promise<void> {
    // In production, each provider adapter is loaded here.
    // For now, register a stub that the user replaces with a real adapter.
    const stub: LLMProvider = {
      name: llmConfig.provider,
      async complete(prompt) {
        throw new Error(`LLM provider "${llmConfig.provider}" not configured. Install the adapter package.`);
      },
      async chat(messages) {
        throw new Error(`LLM provider "${llmConfig.provider}" not configured. Install the adapter package.`);
      },
    };
    this.registerLLMProvider(stub);
    this.log("debug", `LLM provider stub registered for "${llmConfig.provider}" — install adapter for real inference`);
  }

  private registerSignalHandlers(): void {
    // Store references so we can remove them on shutdown (library-friendly)
    const makeHandler = (signal: string) => {
      const handler = () => {
        this.log("info", `Received ${signal}`);
        this.shutdown(signal).catch((err) => {
          this.log("error", `Shutdown error: ${err}`);
        });
      };
      this.signalHandlers.push({ signal, handler });
      process.on(signal, handler);
    };
    makeHandler("SIGINT");
    makeHandler("SIGTERM");
  }

  private removeSignalHandlers(): void {
    for (const { signal, handler } of this.signalHandlers) {
      process.removeListener(signal, handler);
    }
    this.signalHandlers = [];
  }

  private log(level: string, message: string): void {
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [hivemind:${level.toUpperCase()}]`;
    if (level === "error") console.error(`${prefix} ${message}`);
    else if (level === "warn") console.warn(`${prefix} ${message}`);
    else if (level === "debug" && this.config?.logLevel !== "debug") return;
    else console.log(`${prefix} ${message}`);
  }
}
