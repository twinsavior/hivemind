#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
const { version, description } = pkg;

import {
  initCommand,
  upCommand,
  downCommand,
  statusCommand,
  skillAddCommand,
  skillListCommand,
  agentSpawnCommand,
  agentListCommand,
  configCommand,
  taskCommand,
  packAddCommand,
  packUpdateCommand,
  packListCommand,
  packRemoveCommand,
} from "./commands.js";

import {
  skillSearchCommand,
  skillInstallCommand,
  skillPublishCommand,
  skillListExtendedCommand,
  skillUpdateCommand,
  skillUninstallCommand,
  skillInfoCommand,
} from "./skill-commands.js";

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";

// ── ASCII banner ──────────────────────────────────────────────────────────────

const BANNER = `
${CYAN}${BOLD}  ██╗  ██╗██╗██╗   ██╗███████╗███╗   ███╗██╗███╗   ██╗██████╗${RESET}
${CYAN}  ██║  ██║██║██║   ██║██╔════╝████╗ ████║██║████╗  ██║██╔══██╗${RESET}
${CYAN}  ███████║██║██║   ██║█████╗  ██╔████╔██║██║██╔██╗ ██║██║  ██║${RESET}
${CYAN}  ██╔══██║██║╚██╗ ██╔╝██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██║  ██║${RESET}
${CYAN}  ██║  ██║██║ ╚████╔╝ ███████╗██║ ╚═╝ ██║██║██║ ╚████║██████╔╝${RESET}
${CYAN}  ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝${RESET}
${DIM}  The open-source autonomous agent swarm${RESET}
`;

// ── Logging utilities ─────────────────────────────────────────────────────────

export function log(message: string): void {
  console.log(message);
}

export function info(message: string): void {
  console.log(`${CYAN}ℹ${RESET} ${message}`);
}

export function success(message: string): void {
  console.log(`${GREEN}✔${RESET} ${message}`);
}

export function warn(message: string): void {
  console.log(`${YELLOW}⚠${RESET} ${message}`);
}

export function error(message: string): void {
  console.error(`${RED}✖${RESET} ${message}`);
}

export function spinner(message: string): {
  succeed: (msg?: string) => void;
  fail: (msg?: string) => void;
  update: (msg: string) => void;
} {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let currentMsg = message;
  const interval = setInterval(() => {
    process.stdout.write(`\r${CYAN}${frames[i++ % frames.length]}${RESET} ${currentMsg}`);
  }, 80);

  return {
    succeed(msg?: string) {
      clearInterval(interval);
      process.stdout.write(`\r${GREEN}✔${RESET} ${msg ?? currentMsg}\n`);
    },
    fail(msg?: string) {
      clearInterval(interval);
      process.stdout.write(`\r${RED}✖${RESET} ${msg ?? currentMsg}\n`);
    },
    update(msg: string) {
      currentMsg = msg;
    },
  };
}

export function table(
  headers: string[],
  rows: string[][],
): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const sep = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const formatRow = (row: string[]) =>
    row.map((cell, i) => ` ${cell.padEnd(widths[i]!)} `).join("│");

  console.log(`${DIM}${sep}${RESET}`);
  console.log(`${BOLD}${formatRow(headers)}${RESET}`);
  console.log(`${DIM}${sep}${RESET}`);
  rows.forEach((row) => console.log(formatRow(row)));
  console.log(`${DIM}${sep}${RESET}`);
}

// ── Program definition ───────────────────────────────────────────────────────

function createProgram(): Command {
  const program = new Command();

  program
    .name("hivemind")
    .version(version)
    .description(description)
    .hook("preAction", () => {
      log(BANNER);
    });

  // ── Top-level commands ────────────────────────────────────────────────────

  program
    .command("init")
    .description("Initialize a new HIVEMIND project in the current directory")
    .option("-y, --yes", "Skip interactive prompts and use defaults")
    .option("-t, --template <name>", "Use a starter template", "default")
    .action(initCommand);

  program
    .command("up")
    .description("Start the HIVEMIND swarm")
    .option("-d, --detach", "Run in background (detached mode)")
    .option("-c, --config <path>", "Path to config file", "hivemind.yaml")
    .option("--no-dashboard", "Disable the web dashboard")
    .action(upCommand);

  program
    .command("down")
    .description("Stop the HIVEMIND swarm")
    .option("--force", "Force stop all agents immediately")
    .action(downCommand);

  program
    .command("status")
    .description("Show the current status of the swarm")
    .option("--json", "Output as JSON")
    .action(statusCommand);

  program
    .command("task")
    .description("Submit a task to the swarm")
    .argument("<description>", "Task description in natural language")
    .option("-a, --agent <id>", "Assign to a specific agent (scout-1, builder-1, sentinel-1, oracle-1, courier-1)")
    .option("--json", "Output result as JSON")
    .action(taskCommand);

  program
    .command("config")
    .description("View or edit configuration")
    .option("--get <key>", "Get a configuration value")
    .option("--set <key=value>", "Set a configuration value")
    .option("--list", "List all configuration values")
    .action(configCommand);

  // ── Skill sub-commands ────────────────────────────────────────────────────

  const skill = program
    .command("skill")
    .description("Manage agent skills");

  skill
    .command("add")
    .description("Add a skill to the swarm (legacy — use 'install' for marketplace)")
    .argument("<name>", "Skill name or package identifier")
    .option("--from <source>", "Install from registry, git URL, or local path")
    .action(skillAddCommand);

  skill
    .command("search")
    .description("Search the skill marketplace")
    .argument("<query>", "Search query")
    .option("--agent <agent>", "Filter by agent type (scout, builder, communicator, monitor, analyst)")
    .option("--tags <tags>", "Filter by tags (comma-separated)")
    .option("--limit <n>", "Max results to show", "20")
    .action(skillSearchCommand);

  skill
    .command("install")
    .description("Install a skill from the marketplace")
    .argument("<name>", "Skill name")
    .option("--version <version>", "Specific version to install")
    .option("--from <source>", "Install from git URL or local path instead")
    .action(skillInstallCommand);

  skill
    .command("publish")
    .description("Publish a local skill to the marketplace")
    .argument("<path>", "Path to the skill directory")
    .action(skillPublishCommand);

  skill
    .command("list")
    .description("List installed skills")
    .option("--remote", "Show skills available in the marketplace")
    .option("--available", "Alias for --remote")
    .action(skillListExtendedCommand);

  skill
    .command("update")
    .description("Update installed marketplace skills")
    .argument("[name]", "Skill name (updates all if omitted)")
    .action(skillUpdateCommand);

  skill
    .command("uninstall")
    .description("Uninstall a skill")
    .argument("<name>", "Skill name to remove")
    .action(skillUninstallCommand);

  skill
    .command("info")
    .description("Show detailed information about a skill")
    .argument("<name>", "Skill name")
    .action(skillInfoCommand);

  // ── Agent sub-commands ────────────────────────────────────────────────────

  const agent = program
    .command("agent")
    .description("Manage agents in the swarm");

  agent
    .command("spawn")
    .description("Spawn a new agent at runtime")
    .argument("<role>", "Agent role to spawn")
    .option("-n, --name <name>", "Custom name for the agent")
    .option("--model <model>", "Override the default LLM model")
    .action(agentSpawnCommand);

  agent
    .command("list")
    .description("List all active agents")
    .option("--all", "Include stopped agents")
    .action(agentListCommand);

  // ── Skills (pack manager) sub-commands ──────────────────────────────────

  const skills = program
    .command("skills")
    .description("Manage external skill packs from git repositories");

  skills
    .command("add")
    .description("Install a skill pack from a git repository")
    .argument("<git-url>", "Git URL of the skill pack (e.g. https://github.com/garrytan/gstack)")
    .option("-n, --name <name>", "Custom name for the pack (defaults to repo name)")
    .action(packAddCommand);

  skills
    .command("update")
    .description("Update one or all installed skill packs")
    .argument("[pack-name]", "Pack to update (updates all if omitted)")
    .action(packUpdateCommand);

  skills
    .command("list")
    .description("List all installed skill packs")
    .action(packListCommand);

  skills
    .command("remove")
    .description("Remove an installed skill pack")
    .argument("<pack-name>", "Name of the pack to remove")
    .action(packRemoveCommand);

  return program;
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
