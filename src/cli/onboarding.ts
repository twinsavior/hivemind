import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline/promises";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

const PROFILE_VERSION = 1;

export const DEFAULT_AGENT_ORDER = [
  "nova-1",
  "scout-1",
  "builder-1",
  "sentinel-1",
  "oracle-1",
  "courier-1",
] as const;

export type AgentId = (typeof DEFAULT_AGENT_ORDER)[number];
export type UserRole = "founder" | "developer" | "designer" | "pm" | "student" | "hobbyist";
export type ProjectStage = "idea" | "mvp" | "beta" | "production";
export type WorkStyle = "hands-on" | "balanced" | "delegator";
export type PersonalityStyle = "direct" | "warm" | "technical" | "casual" | "no-nonsense";

export interface AgentProfile {
  id: AgentId;
  name: string;
  icon: string;
  roleLabel: string;
}

export interface HivemindProfile {
  version: number;
  createdAt: string;
  updatedAt: string;
  user: {
    name: string;
    role: UserRole;
    project: string;
    projectStage: ProjectStage;
    workStyle: WorkStyle;
  };
  cofounder: {
    name: string;
    personality: PersonalityStyle;
    personalityLabel: string;
    personalityPrompt: string;
    emoji: string;
  };
  agents: Record<AgentId, AgentProfile>;
}

export interface ProviderStatus {
  id: "claude-code" | "codex";
  label: string;
  installed: boolean;
  detail: string;
  installCommand: string;
  loginCommand: string;
}

export interface RunOnboardingOptions {
  cwd?: string;
  homeDir?: string;
  profilePath?: string;
  configPath?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "founder", label: "Founder / CEO" },
  { value: "developer", label: "Developer" },
  { value: "designer", label: "Designer" },
  { value: "pm", label: "Product Manager" },
  { value: "student", label: "Student / Learner" },
  { value: "hobbyist", label: "Hobbyist / Maker" },
];

const STAGE_OPTIONS: Array<{ value: ProjectStage; label: string }> = [
  { value: "idea", label: "Just an idea" },
  { value: "mvp", label: "Building the MVP" },
  { value: "beta", label: "In beta / testing" },
  { value: "production", label: "Live in production" },
];

const WORK_STYLE_OPTIONS: Array<{ value: WorkStyle; label: string; description: string }> = [
  {
    value: "hands-on",
    label: "Hands-on",
    description: "Review key details and stay closely involved.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Review big decisions and let the swarm handle the rest.",
  },
  {
    value: "delegator",
    label: "Delegator",
    description: "Prefer results over play-by-play.",
  },
];

const PERSONALITY_OPTIONS: Array<{ value: PersonalityStyle; label: string; prompt: string }> = [
  {
    value: "direct",
    label: "Direct & strategic",
    prompt: "Direct, strategic, and candid. Prioritize clear tradeoffs, momentum, and decisive judgment.",
  },
  {
    value: "warm",
    label: "Warm & encouraging",
    prompt: "Warm, collaborative, and encouraging. Keep guidance clear while staying supportive.",
  },
  {
    value: "technical",
    label: "Technical & precise",
    prompt: "Technical, precise, and rigorous. Explain decisions concretely and avoid hand-waving.",
  },
  {
    value: "casual",
    label: "Casual & fun",
    prompt: "Casual, approachable, and action-oriented. Keep the tone relaxed without losing competence.",
  },
  {
    value: "no-nonsense",
    label: "No-nonsense",
    prompt: "No-nonsense, concise, and execution-focused. Cut fluff and get to the point.",
  },
];

const COFOUNDER_SUGGESTIONS = ["Nova", "Aria", "Kai", "Atlas", "Sage", "Orion", "Vex", "Echo"] as const;
const EMOJI_SUGGESTIONS = ["🐝", "🧠", "⚡", "🔮", "🤖", "👁️", "🌀", "💀"] as const;

const DEFAULT_AGENTS: Record<AgentId, AgentProfile> = {
  "nova-1": { id: "nova-1", name: "Nova", icon: "🐝", roleLabel: "Co-Founder & CEO" },
  "scout-1": { id: "scout-1", name: "Scout Alpha", icon: "S", roleLabel: "Research & Analysis" },
  "builder-1": { id: "builder-1", name: "Builder Prime", icon: "B", roleLabel: "Code Generation" },
  "sentinel-1": { id: "sentinel-1", name: "Sentinel Watch", icon: "W", roleLabel: "Monitoring & Security" },
  "oracle-1": { id: "oracle-1", name: "Oracle Insight", icon: "O", roleLabel: "Strategy & Prediction" },
  "courier-1": { id: "courier-1", name: "Courier Express", icon: "C", roleLabel: "Communication" },
};

function nowIso(): string {
  return new Date().toISOString();
}

function cloneAgents(): Record<AgentId, AgentProfile> {
  return Object.fromEntries(
    DEFAULT_AGENT_ORDER.map((agentId) => [agentId, { ...DEFAULT_AGENTS[agentId] }]),
  ) as Record<AgentId, AgentProfile>;
}

function defaultUserName(): string {
  return process.env["USER"] || process.env["USERNAME"] || "Operator";
}

export function getHivemindHome(homeDir = os.homedir()): string {
  return path.join(homeDir, ".hivemind");
}

export function getProfilePath(homeDir = os.homedir()): string {
  return path.join(getHivemindHome(homeDir), "profile.json");
}

export function getDefaultProfile(userName = defaultUserName()): HivemindProfile {
  const personality = PERSONALITY_OPTIONS[0]!;
  const timestamp = nowIso();
  const agents = cloneAgents();

  return {
    version: PROFILE_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    user: {
      name: userName,
      role: "founder",
      project: "A product I want to ship with AI help.",
      projectStage: "idea",
      workStyle: "balanced",
    },
    cofounder: {
      name: "Nova",
      personality: personality.value,
      personalityLabel: personality.label,
      personalityPrompt: personality.prompt,
      emoji: "🐝",
    },
    agents,
  };
}

type LegacyProfileInput = Partial<HivemindProfile> & {
  user?: Partial<HivemindProfile["user"]> & {
    projectDescription?: string;
    techStack?: string;
    workStyle?: WorkStyle | "hybrid";
  };
  cofounder?: Partial<HivemindProfile["cofounder"]>;
  agents?: Partial<Record<AgentId, Partial<AgentProfile>>>;
};

export function normalizeProfile(input: LegacyProfileInput | null | undefined): HivemindProfile {
  const base = getDefaultProfile(
    typeof input?.user?.name === "string" && input.user.name.trim() ? input.user.name.trim() : defaultUserName(),
  );
  const personality =
    PERSONALITY_OPTIONS.find((option) => option.value === input?.cofounder?.personality) ?? PERSONALITY_OPTIONS[0]!;
  const workStyle = normalizeWorkStyle(input?.user?.workStyle);
  const agents = cloneAgents();

  for (const agentId of DEFAULT_AGENT_ORDER) {
    const rawAgent = input?.agents?.[agentId];
    if (!rawAgent) continue;
    agents[agentId] = {
      ...agents[agentId],
      name: stringOrDefault(rawAgent.name, agents[agentId].name),
      icon: stringOrDefault(rawAgent.icon, agents[agentId].icon).slice(0, 2) || agents[agentId].icon,
      roleLabel: stringOrDefault(rawAgent.roleLabel, agents[agentId].roleLabel),
    };
  }

  const cofounderName = stringOrDefault(input?.cofounder?.name, base.cofounder.name);
  const cofounderEmoji = stringOrDefault(input?.cofounder?.emoji, base.cofounder.emoji);
  agents["nova-1"] = {
    ...agents["nova-1"],
    name: cofounderName,
    icon: cofounderEmoji.slice(0, 2) || base.cofounder.emoji,
  };

  return {
    version: PROFILE_VERSION,
    createdAt: stringOrDefault(input?.createdAt, base.createdAt),
    updatedAt: nowIso(),
    user: {
      name: stringOrDefault(input?.user?.name, base.user.name),
      role: normalizeRole(input?.user?.role),
      project: stringOrDefault(input?.user?.project, input?.user?.projectDescription, base.user.project),
      projectStage: normalizeStage(input?.user?.projectStage),
      workStyle,
    },
    cofounder: {
      name: cofounderName,
      personality: personality.value,
      personalityLabel: personality.label,
      personalityPrompt: personality.prompt,
      emoji: cofounderEmoji.slice(0, 2) || base.cofounder.emoji,
    },
    agents,
  };
}

export function loadProfile(profilePath = getProfilePath()): HivemindProfile | null {
  if (!fs.existsSync(profilePath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(profilePath, "utf8")) as LegacyProfileInput;
    return normalizeProfile(raw);
  } catch {
    return null;
  }
}

export function loadProfileOrDefault(profilePath = getProfilePath()): HivemindProfile {
  return loadProfile(profilePath) ?? getDefaultProfile();
}

export function saveProfile(profile: HivemindProfile, profilePath = getProfilePath()): HivemindProfile {
  const existing = loadProfile(profilePath);
  const normalized = normalizeProfile({
    ...profile,
    createdAt: existing?.createdAt ?? profile.createdAt,
  });

  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function isFirstRun(profilePath = getProfilePath()): boolean {
  return !fs.existsSync(profilePath);
}

export function buildFirstTaskSuggestion(profile: HivemindProfile): string {
  const roleLabel = ROLE_OPTIONS.find((option) => option.value === profile.user.role)?.label ?? "Builder";
  const stageLabel = STAGE_OPTIONS.find((option) => option.value === profile.user.projectStage)?.label ?? profile.user.projectStage;
  return `Help me plan the next 3 highest-leverage moves for ${profile.user.project} (${stageLabel}) as a ${roleLabel}.`;
}

export function generatePersonalizedConfig(profile: HivemindProfile): string {
  const projectName = slugify(profile.user.project) || "hivemind-project";

  return `# HIVEMIND Configuration
# Generated from first-run onboarding

name: "${projectName}"
version: "1.0.0"

branding:
  operatorName: "${escapeYaml(profile.user.name)}"
  cofounderName: "${escapeYaml(profile.cofounder.name)}"
  cofounderEmoji: "${escapeYaml(profile.cofounder.emoji)}"
  personality: "${escapeYaml(profile.cofounder.personalityLabel)}"

operator:
  role: "${profile.user.role}"
  project: "${escapeYaml(profile.user.project)}"
  stage: "${profile.user.projectStage}"
  workStyle: "${profile.user.workStyle}"

llm:
  primary:
    provider: claude-code
    model: claude-code
    maxTokens: 4096
  code:
    provider: codex
    model: codex
    maxTokens: 4096
  fallback:
    provider: ollama
    model: llama3.2
    maxTokens: 4096

agents:
  coordinator:
    id: "${profile.agents["nova-1"].id}"
    name: "${escapeYaml(profile.agents["nova-1"].name)}"
    role: coordinator
  scout:
    id: "${profile.agents["scout-1"].id}"
    name: "${escapeYaml(profile.agents["scout-1"].name)}"
    role: research
  builder:
    id: "${profile.agents["builder-1"].id}"
    name: "${escapeYaml(profile.agents["builder-1"].name)}"
    role: engineering
  sentinel:
    id: "${profile.agents["sentinel-1"].id}"
    name: "${escapeYaml(profile.agents["sentinel-1"].name)}"
    role: security
  oracle:
    id: "${profile.agents["oracle-1"].id}"
    name: "${escapeYaml(profile.agents["oracle-1"].name)}"
    role: analysis
  courier:
    id: "${profile.agents["courier-1"].id}"
    name: "${escapeYaml(profile.agents["courier-1"].name)}"
    role: communication

dashboard:
  enabled: true
  port: 4000

storage:
  type: sqlite
  path: ./data/hivemind.db
`;
}

export function ensurePersonalizedConfig(profile: HivemindProfile, configPath: string): boolean {
  if (fs.existsSync(configPath)) return false;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, generatePersonalizedConfig(profile), "utf8");
  return true;
}

export async function detectProviderStatuses(): Promise<ProviderStatus[]> {
  const [claude, codex] = await Promise.all([
    detectCommandProvider("claude", "--version", {
      id: "claude-code",
      label: "Claude Code CLI",
      installCommand: "npm install -g @anthropic-ai/claude-code",
      loginCommand: "claude login",
    }),
    detectCommandProvider("codex", "--version", {
      id: "codex",
      label: "Codex CLI",
      installCommand: "npm install -g @openai/codex",
      loginCommand: "codex auth",
    }),
  ]);

  return [claude, codex];
}

export async function runOnboarding(options: RunOnboardingOptions = {}): Promise<HivemindProfile> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const profilePath = options.profilePath ?? getProfilePath(homeDir);
  const configPath = options.configPath ?? path.resolve(cwd, "hivemind.yaml");
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const rl = readline.createInterface({ input, output });
  const draft = getDefaultProfile(defaultUserName());

  try {
    write(output, `${CYAN}${BOLD}
██╗  ██╗██╗██╗   ██╗███████╗███╗   ███╗██╗███╗   ██╗██████╗
██║  ██║██║██║   ██║██╔════╝████╗ ████║██║████╗  ██║██╔══██╗
███████║██║██║   ██║█████╗  ██╔████╔██║██║██╔██╗ ██║██║  ██║
██╔══██║██║╚██╗ ██╔╝██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██║  ██║
██║  ██║██║ ╚████╔╝ ███████╗██║ ╚═╝ ██║██║██║ ╚████║██████╔╝
╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝${RESET}
${DIM}You're about to set up your own autonomous agent swarm.${RESET}
${DIM}First-run onboarding. This takes about 2 minutes.${RESET}
`);

    writeStep(output, 1, 4, "Identity");
    draft.user.name = await askRequiredText(rl, output, "What should the swarm call you?", draft.user.name);
    draft.user.role = await askMenu(rl, output, "What's your role?", ROLE_OPTIONS, draft.user.role);
    draft.user.project = await askRequiredText(rl, output, "What are you building?", draft.user.project);
    draft.user.projectStage = await askMenu(rl, output, "Where are you at with it?", STAGE_OPTIONS, draft.user.projectStage);
    draft.user.workStyle = await askMenu(rl, output, "How do you like to work?", WORK_STYLE_OPTIONS, draft.user.workStyle, true);

    writeStep(output, 2, 4, "Co-Founder");
    draft.cofounder.name = await askCofounderName(rl, output, draft.cofounder.name);
    const personality = await askMenu(rl, output, "How should they communicate?", PERSONALITY_OPTIONS, draft.cofounder.personality, true);
    const personalityMeta = PERSONALITY_OPTIONS.find((option) => option.value === personality) ?? PERSONALITY_OPTIONS[0]!;
    draft.cofounder.personality = personalityMeta.value;
    draft.cofounder.personalityLabel = personalityMeta.label;
    draft.cofounder.personalityPrompt = personalityMeta.prompt;
    draft.cofounder.emoji = await askEmoji(rl, output, draft.cofounder.emoji);
    draft.agents["nova-1"] = {
      ...draft.agents["nova-1"],
      name: draft.cofounder.name,
      icon: draft.cofounder.emoji,
    };

    writeStep(output, 3, 4, "CLI Setup");
    const statuses = await detectProviderStatuses();
    renderStatusBoard(output, statuses);

    writeStep(output, 4, 4, "Config");
    const savedProfile = saveProfile(draft, profilePath);
    const wroteConfig = ensurePersonalizedConfig(savedProfile, configPath);
    renderConfigSummary(output, profilePath, configPath, wroteConfig);
    writePersonalizedWelcome(output, savedProfile);

    return savedProfile;
  } finally {
    rl.close();
  }
}

async function detectCommandProvider(
  command: string,
  versionArg: string,
  meta: Omit<ProviderStatus, "installed" | "detail">,
): Promise<ProviderStatus> {
  try {
    const output = await runCommand(command, [versionArg], 4_000);
    return {
      ...meta,
      installed: true,
      detail: compactWhitespace(output) || "Installed",
    };
  } catch (error) {
    return {
      ...meta,
      installed: false,
      detail: error instanceof Error && error.message.includes("ENOENT") ? "Not installed" : "Not ready",
    };
  }
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out"));
    }, timeoutMs);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout || stderr);
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `Exit code ${code}`));
    });
  });
}

async function askRequiredText(
  rl: readline.Interface,
  output: NodeJS.WritableStream,
  label: string,
  defaultValue: string,
): Promise<string> {
  while (true) {
    const value = await askText(rl, label, defaultValue);
    if (value.trim()) return value.trim();
    write(output, `${YELLOW}This field is required.${RESET}`);
  }
}

async function askText(
  rl: readline.Interface,
  label: string,
  defaultValue = "",
): Promise<string> {
  const suffix = defaultValue ? ` ${DIM}[${defaultValue}]${RESET}` : "";
  const answer = (await rl.question(`${CYAN}?${RESET} ${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function askMenu<T extends string>(
  rl: readline.Interface,
  output: NodeJS.WritableStream,
  label: string,
  options: Array<{ value: T; label: string; description?: string }>,
  defaultValue: T,
  showDescriptions = false,
): Promise<T> {
  write(output, `${BOLD}${label}${RESET}`);
  options.forEach((option, index) => {
    const selected = option.value === defaultValue ? ` ${DIM}(default)${RESET}` : "";
    const description = showDescriptions && option.description ? ` ${DIM}- ${option.description}${RESET}` : "";
    write(output, `  ${index + 1}. ${option.label}${selected}${description}`);
  });

  while (true) {
    const answer = (await rl.question(`${CYAN}?${RESET} Choose 1-${options.length}: `)).trim();
    if (!answer) return defaultValue;

    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) {
      return options[index - 1]!.value;
    }

    write(output, `${YELLOW}Enter a number between 1 and ${options.length}.${RESET}`);
  }
}

async function askCofounderName(
  rl: readline.Interface,
  output: NodeJS.WritableStream,
  defaultValue: string,
): Promise<string> {
  write(output, `${BOLD}Name your AI co-founder${RESET}`);
  COFOUNDER_SUGGESTIONS.forEach((name, index) => {
    const selected = name === defaultValue ? ` ${DIM}(default)${RESET}` : "";
    write(output, `  ${index + 1}. ${name}${selected}`);
  });
  write(output, `  ${COFOUNDER_SUGGESTIONS.length + 1}. Custom name`);

  while (true) {
    const answer = (await rl.question(`${CYAN}?${RESET} Choose 1-${COFOUNDER_SUGGESTIONS.length + 1}: `)).trim();
    if (!answer) return defaultValue;

    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= COFOUNDER_SUGGESTIONS.length) {
      return COFOUNDER_SUGGESTIONS[index - 1]!;
    }
    if (index === COFOUNDER_SUGGESTIONS.length + 1) {
      return await askRequiredText(rl, output, "Custom co-founder name", defaultValue);
    }

    write(output, `${YELLOW}Enter a valid number.${RESET}`);
  }
}

async function askEmoji(
  rl: readline.Interface,
  output: NodeJS.WritableStream,
  defaultValue: string,
): Promise<string> {
  write(output, `${BOLD}Pick an icon${RESET}`);
  EMOJI_SUGGESTIONS.forEach((emoji, index) => {
    const selected = emoji === defaultValue ? ` ${DIM}(default)${RESET}` : "";
    write(output, `  ${index + 1}. ${emoji}${selected}`);
  });
  write(output, `  ${EMOJI_SUGGESTIONS.length + 1}. Custom emoji`);

  while (true) {
    const answer = (await rl.question(`${CYAN}?${RESET} Choose 1-${EMOJI_SUGGESTIONS.length + 1}: `)).trim();
    if (!answer) return defaultValue;

    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= EMOJI_SUGGESTIONS.length) {
      return EMOJI_SUGGESTIONS[index - 1]!;
    }
    if (index === EMOJI_SUGGESTIONS.length + 1) {
      return await askRequiredText(rl, output, "Paste any emoji", defaultValue);
    }

    write(output, `${YELLOW}Enter a valid number.${RESET}`);
  }
}

function renderStatusBoard(output: NodeJS.WritableStream, statuses: ProviderStatus[]): void {
  write(output, `${BOLD}Provider status${RESET}`);
  write(output, `  ${DIM}Claude Code powers Nova, Scout, Oracle, and Courier.${RESET}`);
  write(output, `  ${DIM}Codex powers Builder and Sentinel.${RESET}`);

  for (const status of statuses) {
    const badge = status.installed ? `${GREEN}READY${RESET}` : `${RED}MISSING${RESET}`;
    write(output, `  ${badge} ${status.label} ${DIM}- ${status.detail}${RESET}`);
    if (!status.installed) {
      write(output, `     Install: ${status.installCommand}`);
      write(output, `     Sign in: ${status.loginCommand}`);
    }
  }
}

function renderConfigSummary(
  output: NodeJS.WritableStream,
  profilePath: string,
  configPath: string,
  wroteConfig: boolean,
): void {
  write(output, `${GREEN}${BOLD}Profile saved${RESET} ${DIM}${profilePath}${RESET}`);
  if (wroteConfig) {
    write(output, `${GREEN}${BOLD}Config written${RESET} ${DIM}${configPath}${RESET}`);
    return;
  }

  write(output, `${DIM}hivemind.yaml already exists. Keeping ${configPath}.${RESET}`);
}

function writePersonalizedWelcome(output: NodeJS.WritableStream, profile: HivemindProfile): void {
  write(
    output,
    `
${MAGENTA}${BOLD}${profile.cofounder.name}${RESET} ${DIM}is ready.${RESET}
${profile.cofounder.emoji} ${profile.cofounder.personalityLabel}
Project: ${profile.user.project}
Suggested first prompt: ${buildFirstTaskSuggestion(profile)}
`,
  );
}

function writeStep(output: NodeJS.WritableStream, step: number, total: number, title: string): void {
  write(output, `\n${MAGENTA}${BOLD}Step ${step} of ${total}${RESET} ${DIM}${title}${RESET}`);
}

function normalizeRole(value: unknown): UserRole {
  return ROLE_OPTIONS.some((option) => option.value === value) ? (value as UserRole) : "founder";
}

function normalizeStage(value: unknown): ProjectStage {
  return STAGE_OPTIONS.some((option) => option.value === value) ? (value as ProjectStage) : "idea";
}

function normalizeWorkStyle(value: unknown): WorkStyle {
  if (value === "hybrid") return "balanced";
  return WORK_STYLE_OPTIONS.some((option) => option.value === value) ? (value as WorkStyle) : "balanced";
}

function stringOrDefault(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function write(output: NodeJS.WritableStream, text: string): void {
  output.write(`${text}\n`);
}
