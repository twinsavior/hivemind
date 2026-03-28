/**
 * Shared profile types and pure functions used by both CLI and dashboard.
 * Extracted from src/cli/onboarding.ts to break the direct CLI→dashboard import coupling.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PERSONALITY_PROMPTS } from "../cli/onboarding-copy.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const PROFILE_VERSION = 1;

export const DEFAULT_AGENT_ORDER = [
  "nova-1",
  "scout-1",
  "builder-1",
  "sentinel-1",
  "oracle-1",
  "courier-1",
] as const;

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Lookup Tables ──────────────────────────────────────────────────────────

export const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "founder", label: "Founder / CEO" },
  { value: "developer", label: "Developer" },
  { value: "designer", label: "Designer" },
  { value: "pm", label: "Product Manager" },
  { value: "student", label: "Student / Learner" },
  { value: "hobbyist", label: "Hobbyist / Maker" },
];

export const STAGE_OPTIONS: Array<{ value: ProjectStage; label: string }> = [
  { value: "idea", label: "Just an idea" },
  { value: "mvp", label: "Building the MVP" },
  { value: "beta", label: "In beta / testing" },
  { value: "production", label: "Live in production" },
];

const WORK_STYLE_OPTIONS: Array<{ value: WorkStyle; label: string; description: string }> = [
  { value: "hands-on", label: "Hands-on", description: "Review key details and stay closely involved." },
  { value: "balanced", label: "Balanced", description: "Review big decisions and let the swarm handle the rest." },
  { value: "delegator", label: "Delegator", description: "Prefer results over play-by-play." },
];

const PERSONALITY_OPTIONS: Array<{ value: PersonalityStyle; label: string; prompt: string }> = [
  { value: "direct", label: "Direct & strategic", prompt: PERSONALITY_PROMPTS["direct"]! },
  { value: "warm", label: "Warm & encouraging", prompt: PERSONALITY_PROMPTS["warm"]! },
  { value: "technical", label: "Technical & precise", prompt: PERSONALITY_PROMPTS["technical"]! },
  { value: "casual", label: "Casual & fun", prompt: PERSONALITY_PROMPTS["casual"]! },
  { value: "no-nonsense", label: "No-nonsense", prompt: PERSONALITY_PROMPTS["no-nonsense"]! },
];

const DEFAULT_AGENTS: Record<AgentId, AgentProfile> = {
  "nova-1": { id: "nova-1", name: "Nova", icon: "🐝", roleLabel: "Your Selling Partner" },
  "scout-1": { id: "scout-1", name: "Scout Alpha", icon: "S", roleLabel: "Product & Market Research" },
  "builder-1": { id: "builder-1", name: "Builder Prime", icon: "B", roleLabel: "Listing & Content" },
  "sentinel-1": { id: "sentinel-1", name: "Sentinel Watch", icon: "W", roleLabel: "Account Health Monitor" },
  "oracle-1": { id: "oracle-1", name: "Oracle Insight", icon: "O", roleLabel: "Pricing & Profitability" },
  "courier-1": { id: "courier-1", name: "Courier Express", icon: "C", roleLabel: "Buyer & Support Comms" },
};

// ─── Internal helpers ───────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function cloneAgents(): Record<AgentId, AgentProfile> {
  return Object.fromEntries(
    DEFAULT_AGENT_ORDER.map((agentId) => [agentId, { ...DEFAULT_AGENTS[agentId] }]),
  ) as Record<AgentId, AgentProfile>;
}

function defaultUserName(): string {
  return process.env["USER"] || process.env["USERNAME"] || os.userInfo().username || "Operator";
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

// ─── Exported pure functions ────────────────────────────────────────────────

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
  const project = profile.user.project.trim() || "my project";
  return `Help me plan the next 3 highest-leverage moves for ${project} (${stageLabel}) as a ${roleLabel}.`;
}
