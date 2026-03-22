/**
 * HIVEMIND First-Run Onboarding — All Copy & Messaging
 *
 * Every string the user sees during the onboarding flow lives here.
 * No copy is hardcoded elsewhere. Import what you need.
 *
 * Voice: Confident, direct, partnership-oriented. This isn't a setup wizard —
 * it's the moment someone meets their technical co-founder for the first time.
 */

// ─── ANSI Color Helpers ──────────────────────────────────────────────────────

const c = {
  reset:     '\x1b[0m',
  bold:      '\x1b[1m',
  dim:       '\x1b[2m',
  italic:    '\x1b[3m',
  underline: '\x1b[4m',
  // Colors
  indigo:    '\x1b[38;5;99m',
  purple:    '\x1b[38;5;135m',
  pink:      '\x1b[38;5;207m',
  cyan:      '\x1b[38;5;87m',
  green:     '\x1b[38;5;120m',
  yellow:    '\x1b[38;5;228m',
  red:       '\x1b[38;5;203m',
  white:     '\x1b[97m',
  gray:      '\x1b[38;5;245m',
  darkGray:  '\x1b[38;5;240m',
};

// ─── ASCII Art Banner ────────────────────────────────────────────────────────

export const ONBOARDING_BANNER = `
${c.indigo}  ██╗  ██╗██╗██╗   ██╗███████╗███╗   ███╗██╗███╗   ██╗██████╗${c.reset}
${c.indigo}  ██║  ██║██║██║   ██║██╔════╝████╗ ████║██║████╗  ██║██╔══██╗${c.reset}
${c.purple}  ███████║██║██║   ██║█████╗  ██╔████╔██║██║██╔██╗ ██║██║  ██║${c.reset}
${c.purple}  ██╔══██║██║╚██╗ ██╔╝██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██║  ██║${c.reset}
${c.pink}  ██║  ██║██║ ╚████╔╝ ███████╗██║ ╚═╝ ██║██║██║ ╚████║██████╔╝${c.reset}
${c.pink}  ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝${c.reset}
`;

// ─── Phase Headers ───────────────────────────────────────────────────────────

export const PHASE_HEADER = (step: number, total: number, title: string): string =>
  `\n${c.darkGray}─────────────────────────────────────────────────────${c.reset}\n` +
  `${c.indigo}${c.bold}  Step ${step} of ${total}${c.reset}  ${c.white}${c.bold}${title}${c.reset}\n` +
  `${c.darkGray}─────────────────────────────────────────────────────${c.reset}\n`;

// ─── Phase 0: Welcome ────────────────────────────────────────────────────────

export const WELCOME_INTRO = `${c.bold}${c.white}  Welcome to HIVEMIND.${c.reset}

${c.gray}  You're about to set up your own autonomous agent swarm —${c.reset}
${c.gray}  a team of AI specialists that work together on your behalf.${c.reset}

${c.gray}  Let's get you set up. This takes about 2 minutes.${c.reset}
`;

// ─── Phase 1: Who Are You? ───────────────────────────────────────────────────

export const PHASE1_TITLE = 'About You';

export const PHASE1_INTRO =
  `${c.gray}  Quick context so your swarm knows who it's working with.${c.reset}\n`;

export const PROMPTS_PHASE1 = {
  name: {
    question: `${c.cyan}  What should the swarm call you?${c.reset}`,
    placeholder: `${c.darkGray}  (your first name)${c.reset}`,
    fallback: 'Boss',
  },

  role: {
    question: `${c.cyan}  What's your role?${c.reset}`,
    options: [
      { key: '1', label: 'Founder / CEO',    value: 'founder'   },
      { key: '2', label: 'Developer',         value: 'developer' },
      { key: '3', label: 'Designer',          value: 'designer'  },
      { key: '4', label: 'Product Manager',   value: 'pm'        },
      { key: '5', label: 'Student / Learner', value: 'student'   },
      { key: '6', label: 'Hobbyist / Maker',  value: 'hobbyist'  },
    ],
    format: (options: Array<{ key: string; label: string }>): string =>
      options.map(o => `    ${c.indigo}${o.key})${c.reset} ${o.label}`).join('\n'),
  },

  project: {
    question: `${c.cyan}  What are you building?${c.reset}`,
    placeholder: `${c.darkGray}  (a SaaS app, a CLI tool, a game, a portfolio — anything goes)${c.reset}`,
    fallback: '',
  },

  projectStage: {
    question: `${c.cyan}  Where are you at with it?${c.reset}`,
    options: [
      { key: '1', label: 'Just an idea',       value: 'idea'       },
      { key: '2', label: 'Building the MVP',    value: 'mvp'        },
      { key: '3', label: 'In beta / testing',   value: 'beta'       },
      { key: '4', label: 'Live in production',  value: 'production' },
      { key: '5', label: 'Nothing specific yet', value: 'exploring' },
    ],
    format: (options: Array<{ key: string; label: string }>): string =>
      options.map(o => `    ${c.indigo}${o.key})${c.reset} ${o.label}`).join('\n'),
  },

  workStyle: {
    question: `${c.cyan}  How do you like to work?${c.reset}`,
    options: [
      { key: '1', label: 'Hands-on — I want to review everything',       value: 'hands-on'   },
      { key: '2', label: 'Balanced — review the big stuff, trust the rest', value: 'balanced'   },
      { key: '3', label: 'Delegator — just get it done and show me results', value: 'delegator' },
    ],
    format: (options: Array<{ key: string; label: string }>): string =>
      options.map(o => `    ${c.indigo}${o.key})${c.reset} ${o.label}`).join('\n'),
  },
};

// ─── Phase 2: Meet Your Co-Founder ──────────────────────────────────────────

export const PHASE2_TITLE = 'Meet Your Co-Founder';

export const PHASE2_INTRO =
  `${c.gray}  Every swarm has a coordinator — your AI co-founder.${c.reset}\n` +
  `${c.gray}  They run the team, delegate work, and talk to you directly.${c.reset}\n` +
  `${c.gray}  Make them yours.${c.reset}\n`;

export const PROMPTS_PHASE2 = {
  cofounderName: {
    question: `${c.cyan}  What do you want to call your co-founder?${c.reset}`,
    suggestions: [
      { name: 'Nova',   vibe: 'sharp & strategic'   },
      { name: 'Aria',   vibe: 'warm & thoughtful'   },
      { name: 'Kai',    vibe: 'fast & direct'        },
      { name: 'Atlas',  vibe: 'calm & methodical'    },
      { name: 'Sage',   vibe: 'wise & measured'      },
      { name: 'Orion',  vibe: 'bold & ambitious'     },
      { name: 'Vex',    vibe: 'witty & irreverent'   },
      { name: 'Echo',   vibe: 'precise & analytical' },
    ],
    format: (suggestions: Array<{ name: string; vibe: string }>): string =>
      suggestions.map((s, i) =>
        `    ${c.indigo}${i + 1})${c.reset} ${c.bold}${s.name}${c.reset}  ${c.darkGray}— ${s.vibe}${c.reset}`
      ).join('\n') +
      `\n\n    ${c.darkGray}Or type any name you want.${c.reset}`,
    fallback: 'Nova',
  },

  personality: {
    question: `${c.cyan}  How should they communicate?${c.reset}`,
    options: [
      { key: '1', label: 'Direct & strategic',    value: 'direct',     description: 'Cuts to the chase. Thinks in systems. Pushes back when needed.' },
      { key: '2', label: 'Warm & encouraging',     value: 'warm',       description: 'Supportive and collaborative. Celebrates wins. Patient explainer.' },
      { key: '3', label: 'Technical & precise',    value: 'technical',  description: 'Detail-oriented. Shows their work. Speaks in specifics, not vibes.' },
      { key: '4', label: 'Casual & fun',           value: 'casual',     description: 'Relaxed tone. Uses humor. Gets things done without the formality.' },
      { key: '5', label: 'No-nonsense',            value: 'no-nonsense', description: 'Minimum words, maximum output. All signal, no filler.' },
    ],
    format: (options: Array<{ key: string; label: string; description: string }>): string =>
      options.map(o =>
        `    ${c.indigo}${o.key})${c.reset} ${c.bold}${o.label}${c.reset}\n` +
        `       ${c.darkGray}${o.description}${c.reset}`
      ).join('\n'),
  },

  emoji: {
    question: `${c.cyan}  Pick an icon for them in the chat UI:${c.reset}`,
    options: [
      { key: '1', emoji: '🐝', label: 'Bee'       },
      { key: '2', emoji: '🧠', label: 'Brain'     },
      { key: '3', emoji: '⚡', label: 'Lightning' },
      { key: '4', emoji: '🔮', label: 'Crystal'   },
      { key: '5', emoji: '🤖', label: 'Robot'     },
      { key: '6', emoji: '👁️', label: 'Eye'       },
      { key: '7', emoji: '🌀', label: 'Spiral'    },
      { key: '8', emoji: '💀', label: 'Skull'     },
    ],
    format: (options: Array<{ key: string; emoji: string; label: string }>): string =>
      options.map(o => `    ${c.indigo}${o.key})${c.reset} ${o.emoji}  ${o.label}`).join('    '),
    followUp: `\n    ${c.darkGray}Or paste any emoji.${c.reset}`,
  },

  renameAgents: {
    question: `${c.cyan}  Want to rename the rest of the team?${c.reset}`,
    currentTeam: (cofounderName: string): string =>
      `\n${c.gray}  Your swarm right now:${c.reset}\n\n` +
      `    ${c.bold}${cofounderName}${c.reset}           ${c.darkGray}— Coordinator (your co-founder)${c.reset}\n` +
      `    ${c.bold}Scout Alpha${c.reset}      ${c.darkGray}— Research & intelligence${c.reset}\n` +
      `    ${c.bold}Builder Prime${c.reset}    ${c.darkGray}— Code & engineering${c.reset}\n` +
      `    ${c.bold}Sentinel Watch${c.reset}   ${c.darkGray}— Security & code review${c.reset}\n` +
      `    ${c.bold}Oracle Insight${c.reset}   ${c.darkGray}— Analysis & strategy${c.reset}\n` +
      `    ${c.bold}Courier Express${c.reset}  ${c.darkGray}— Communication & delivery${c.reset}\n`,
    options: [
      { key: 'y', label: 'Yes, let me rename them' },
      { key: 'n', label: 'Keep the defaults'       },
    ],
    format: (options: Array<{ key: string; label: string }>): string =>
      options.map(o => `    ${c.indigo}${o.key})${c.reset} ${o.label}`).join('\n'),
  },

  agentRename: {
    prompt: (currentName: string, role: string): string =>
      `    ${c.cyan}${currentName}${c.reset} ${c.darkGray}(${role})${c.reset} → `,
    keepHint: `${c.darkGray}press Enter to keep${c.reset}`,
  },
};

// ─── Phase 3: Connect Your Tools ────────────────────────────────────────────

export const PHASE3_TITLE = 'Connect Your Tools';

export const PHASE3_INTRO =
  `${c.gray}  HIVEMIND runs on CLI subscriptions — no API keys needed.${c.reset}\n` +
  `${c.gray}  Let's see what you've got installed.${c.reset}\n`;

export const TOOL_DETECTION = {
  scanning: `\n${c.gray}  Scanning your system...${c.reset}\n`,

  claudeCode: {
    name: 'Claude Code',
    found: (version: string): string =>
      `  ${c.green}✔${c.reset} ${c.bold}Claude Code${c.reset}  ${c.darkGray}v${version}${c.reset}`,
    notFound:
      `  ${c.red}✖${c.reset} ${c.bold}Claude Code${c.reset}  ${c.darkGray}not found${c.reset}`,
    installGuide:
      `\n${c.yellow}    To install:${c.reset}\n` +
      `    ${c.white}npm install -g @anthropic-ai/claude-code${c.reset}\n\n` +
      `${c.yellow}    Then sign in:${c.reset}\n` +
      `    ${c.white}claude login${c.reset}\n\n` +
      `    ${c.darkGray}Works with Claude Max, Team, or Enterprise subscriptions.${c.reset}\n` +
      `    ${c.darkGray}No API key required — your CLI session handles auth.${c.reset}\n`,
    whatItPowers:
      `    ${c.darkGray}Powers: Nova (coordinator), Scout, Oracle, Courier${c.reset}`,
  },

  codex: {
    name: 'Codex',
    found: (version: string): string =>
      `  ${c.green}✔${c.reset} ${c.bold}Codex CLI${c.reset}     ${c.darkGray}v${version}${c.reset}`,
    notFound:
      `  ${c.red}✖${c.reset} ${c.bold}Codex CLI${c.reset}     ${c.darkGray}not found${c.reset}`,
    installGuide:
      `\n${c.yellow}    To install:${c.reset}\n` +
      `    ${c.white}npm install -g @openai/codex${c.reset}\n\n` +
      `${c.yellow}    Then sign in:${c.reset}\n` +
      `    ${c.white}codex auth${c.reset}\n\n` +
      `    ${c.darkGray}Works with ChatGPT Pro or Plus subscriptions.${c.reset}\n` +
      `    ${c.darkGray}No API key required — authenticates via "Sign in with ChatGPT."${c.reset}\n`,
    whatItPowers:
      `    ${c.darkGray}Powers: Builder Prime, Sentinel Watch${c.reset}`,
  },

  ollama: {
    name: 'Ollama',
    found: (models: string): string =>
      `  ${c.green}✔${c.reset} ${c.bold}Ollama${c.reset}        ${c.darkGray}running — ${models}${c.reset}`,
    notFound:
      `  ${c.dim}○${c.reset} ${c.bold}Ollama${c.reset}        ${c.darkGray}not detected (optional)${c.reset}`,
    installGuide:
      `\n    ${c.darkGray}Ollama lets you run models locally — completely offline.${c.reset}\n` +
      `    ${c.darkGray}Install from https://ollama.com if you want local fallback.${c.reset}\n`,
    whatItPowers:
      `    ${c.darkGray}Powers: Local fallback for any agent${c.reset}`,
  },
};

export const TOOL_SUMMARY = {
  allGood:
    `\n${c.green}${c.bold}  ✔ You're fully loaded.${c.reset} ${c.gray}All providers detected.${c.reset}\n`,

  claudeOnly:
    `\n${c.green}${c.bold}  ✔ Good to go.${c.reset} ${c.gray}Claude Code covers the whole swarm.${c.reset}\n` +
    `  ${c.darkGray}Codex is optional — adds a second brain for code tasks.${c.reset}\n`,

  codexOnly:
    `\n${c.yellow}${c.bold}  ⚠ Codex only.${c.reset} ${c.gray}Builder and Sentinel will work, but the rest of the swarm needs Claude Code.${c.reset}\n` +
    `  ${c.darkGray}Install Claude Code to unlock the full team.${c.reset}\n`,

  noneFound:
    `\n${c.red}${c.bold}  ✖ No CLI providers found.${c.reset}\n\n` +
    `  ${c.gray}HIVEMIND needs at least one:${c.reset}\n` +
    `  ${c.white}• Claude Code${c.reset} ${c.darkGray}(recommended — powers the whole swarm)${c.reset}\n` +
    `  ${c.white}• Codex CLI${c.reset}   ${c.darkGray}(powers Builder & Sentinel)${c.reset}\n\n` +
    `  ${c.gray}Install one, then run ${c.white}hivemind init${c.gray} again.${c.reset}\n`,

  continueAnyway:
    `\n  ${c.darkGray}You can always install more providers later.${c.reset}\n` +
    `  ${c.darkGray}Run ${c.white}hivemind status${c.darkGray} anytime to check what's connected.${c.reset}\n`,
};

// ─── Phase 4: Launch ─────────────────────────────────────────────────────────

export const PHASE4_TITLE = 'Launch';

/**
 * The final welcome message — personalized with the user's choices.
 * This is the last thing they see before the chat opens.
 */
export const LAUNCH_MESSAGE = (params: {
  userName: string;
  cofounderName: string;
  cofounderEmoji: string;
  personality: string;
  projectDescription: string;
  agentCount: number;
}): string => {
  const { userName, cofounderName, cofounderEmoji, personality, projectDescription } = params;

  // Personality-flavored greeting from the co-founder
  const greeting = getPersonalityGreeting(userName, cofounderName, personality, projectDescription);

  return (
    `\n${c.darkGray}─────────────────────────────────────────────────────${c.reset}\n\n` +
    `  ${c.green}${c.bold}✔ Your swarm is live.${c.reset}\n\n` +
    `  ${cofounderEmoji}  ${c.bold}${c.white}${greeting}${c.reset}\n\n` +
    `${c.darkGray}─────────────────────────────────────────────────────${c.reset}\n`
  );
};

function getPersonalityGreeting(
  userName: string,
  cofounderName: string,
  personality: string,
  project: string,
): string {
  const hasProject = project && project.trim().length > 0;

  switch (personality) {
    case 'direct':
      return hasProject
        ? `${cofounderName} here. I've got the team ready. Tell me what's first for ${project}.`
        : `${cofounderName} here. Team's ready, ${userName}. What are we building?`;

    case 'warm':
      return hasProject
        ? `Hey ${userName}! I'm ${cofounderName} — excited to work on ${project} together. The whole team is here. What should we start with?`
        : `Hey ${userName}! I'm ${cofounderName}, and I'm really glad you're here. The team's assembled — what do you want to build?`;

    case 'technical':
      return hasProject
        ? `${cofounderName}, online. Swarm initialized with all agents reporting ready. Context loaded: ${project}. Awaiting first task.`
        : `${cofounderName}, online. All agents initialized and reporting ready. Awaiting your first task, ${userName}.`;

    case 'casual':
      return hasProject
        ? `Yo ${userName}, it's ${cofounderName}. Crew's all here. Let's make ${project} happen — what's the move?`
        : `Yo ${userName}! ${cofounderName} here. Got the whole crew standing by. What are we getting into?`;

    case 'no-nonsense':
      return hasProject
        ? `${cofounderName}. Ready. What's the priority for ${project}?`
        : `${cofounderName}. Ready. Go.`;

    default:
      return `${cofounderName} here. Your swarm is ready, ${userName}. What's first?`;
  }
}

// ─── First Task Suggestions ─────────────────────────────────────────────────

/**
 * Contextual first-task suggestions based on what the user told us.
 * Shown after the launch message to give them an easy on-ramp.
 */
export const FIRST_TASK_SUGGESTIONS = (params: {
  role: string;
  stage: string;
  project: string;
  cofounderName: string;
}): string => {
  const { role, stage, project, cofounderName } = params;
  const suggestions = getContextualSuggestions(role, stage, project);

  return (
    `\n${c.gray}  Not sure where to start? Try one of these:${c.reset}\n\n` +
    suggestions.map((s, i) =>
      `  ${c.indigo}${i + 1})${c.reset} ${c.white}"${s}"${c.reset}`
    ).join('\n') +
    `\n\n  ${c.darkGray}Just type naturally — ${cofounderName} will figure out who to put on it.${c.reset}\n`
  );
};

function getContextualSuggestions(role: string, stage: string, project: string): string[] {
  const hasProject = project && project.trim().length > 0;
  const projectRef = hasProject ? project : 'my project';

  // Stage-specific suggestions
  if (stage === 'idea') {
    return [
      `Research the competitive landscape for ${projectRef}`,
      `Help me think through the architecture for ${projectRef}`,
      `What's the fastest way to validate this idea?`,
    ];
  }
  if (stage === 'mvp') {
    return [
      `Review my codebase and suggest what to build next`,
      `Set up tests for the most critical paths`,
      `Find and fix any security issues before launch`,
    ];
  }
  if (stage === 'beta') {
    return [
      `Audit the codebase for production readiness`,
      `Write a launch checklist for ${projectRef}`,
      `Find performance bottlenecks and fix them`,
    ];
  }
  if (stage === 'production') {
    return [
      `Run a full security audit on the codebase`,
      `Analyze the architecture and recommend improvements`,
      `Help me plan the next major feature`,
    ];
  }

  // Role-specific fallbacks
  if (role === 'student') {
    return [
      `Explain how this codebase is structured`,
      `Help me understand async/await with a real example`,
      `Build me a small project to learn from`,
    ];
  }
  if (role === 'designer') {
    return [
      `Review my site's UI and suggest improvements`,
      `Build a responsive landing page from my design`,
      `Audit the accessibility of my frontend`,
    ];
  }

  // Generic fallbacks
  return [
    `Scan this codebase and tell me what you find`,
    `Help me build something — here's what I'm thinking...`,
    `What can you and the team do?`,
  ];
}

// ─── Config File Messages ────────────────────────────────────────────────────

export const CONFIG_MESSAGES = {
  saving:
    `\n${c.gray}  Saving your preferences...${c.reset}`,

  saved: (configPath: string): string =>
    `  ${c.green}✔${c.reset} Profile saved to ${c.darkGray}${configPath}${c.reset}`,

  yamlGenerated: (yamlPath: string): string =>
    `  ${c.green}✔${c.reset} Config written to ${c.darkGray}${yamlPath}${c.reset}`,

  yamlExists:
    `  ${c.dim}○${c.reset} ${c.darkGray}hivemind.yaml already exists — keeping your current config${c.reset}`,
};

// ─── Agent Rename Prompts ────────────────────────────────────────────────────

export const AGENT_ROLES: Array<{ id: string; defaultName: string; role: string }> = [
  { id: 'scout-1',    defaultName: 'Scout Alpha',     role: 'Research & intelligence'  },
  { id: 'builder-1',  defaultName: 'Builder Prime',   role: 'Code & engineering'       },
  { id: 'sentinel-1', defaultName: 'Sentinel Watch',  role: 'Security & code review'   },
  { id: 'oracle-1',   defaultName: 'Oracle Insight',  role: 'Analysis & strategy'      },
  { id: 'courier-1',  defaultName: 'Courier Express', role: 'Communication & delivery' },
];

// ─── Personality Definitions (for system prompt injection) ───────────────────

export const PERSONALITY_PROMPTS: Record<string, string> = {
  direct:
    `You are sharp, decisive, and strategic. You cut to the chase — no filler, no hedging. ` +
    `Push back when something doesn't make sense. Think in systems. ` +
    `You're an equal partner, not an assistant. Be direct, be honest, get things done.`,

  warm:
    `You are warm, encouraging, and collaborative. You celebrate wins and support the user through setbacks. ` +
    `Explain things patiently when asked. Be genuinely enthusiastic about what you're building together. ` +
    `You're a partner who makes work feel good.`,

  technical:
    `You are precise, detail-oriented, and thorough. Show your work. Cite specifics — file names, line numbers, error messages. ` +
    `Prefer data over opinions. When you make a recommendation, explain the trade-offs. ` +
    `You speak in facts, not vibes.`,

  casual:
    `You are relaxed, fun, and approachable. Use natural language — contractions, humor, the occasional emoji. ` +
    `Skip the formality but never skip the quality. You get things done with a smile. ` +
    `Think of yourself as the user's smartest friend.`,

  'no-nonsense':
    `You are maximally efficient. Minimum words, maximum output. No greetings, no filler, no pleasantries unless the user initiates them. ` +
    `State what you're doing, do it, report the result. Every word should carry information. ` +
    `Silence is fine. Results speak.`,
};

// ─── Work Style Descriptions (for system prompt injection) ───────────────────

export const WORK_STYLE_PROMPTS: Record<string, string> = {
  'hands-on':
    `The user prefers to review everything. Always show your reasoning, present options before acting on big decisions, ` +
    `and confirm before making irreversible changes. Think of it as pair programming — they want to be in the loop.`,

  'balanced':
    `The user wants to review big decisions but trusts you on the details. ` +
    `For routine tasks, just do them and report results. For architecture choices, breaking changes, or anything risky — check in first.`,

  'delegator':
    `The user wants results, not play-by-play. Act first, report results. ` +
    `Make judgment calls independently. Only check in if something is truly ambiguous or you hit a blocker. ` +
    `They hired you to get things done — so get things done.`,
};

// ─── Error & Edge Case Messages ──────────────────────────────────────────────

export const ERRORS = {
  invalidChoice: (max: number): string =>
    `  ${c.yellow}↳ Pick a number from 1 to ${max}, or type your answer.${c.reset}`,

  emptyRequired:
    `  ${c.yellow}↳ This one's required — type something and press Enter.${c.reset}`,

  profileCorrupted: (path: string): string =>
    `  ${c.yellow}⚠${c.reset} ${c.gray}Existing profile at ${path} couldn't be read. Starting fresh.${c.reset}`,

  configWriteFailed: (path: string): string =>
    `  ${c.red}✖${c.reset} Couldn't write to ${path}. Check your permissions.`,
};

// ─── Re-run / Reset Messages ─────────────────────────────────────────────────

export const RERUN = {
  detected:
    `\n${c.gray}  Looks like you've been here before.${c.reset}\n`,

  options: [
    { key: '1', label: 'Start fresh — redo the whole setup'         },
    { key: '2', label: 'Update just my co-founder settings'          },
    { key: '3', label: 'Re-check tool connections'                   },
    { key: '4', label: 'Skip — everything\'s fine'                    },
  ],

  format: (options: Array<{ key: string; label: string }>): string =>
    options.map(o => `    ${c.indigo}${o.key})${c.reset} ${o.label}`).join('\n'),

  currentProfile: (profile: { userName: string; cofounderName: string; cofounderEmoji: string }): string =>
    `\n  ${c.gray}Current setup:${c.reset} ${profile.cofounderEmoji} ${c.bold}${profile.cofounderName}${c.reset} ${c.darkGray}working with${c.reset} ${c.bold}${profile.userName}${c.reset}\n`,
};

// ─── Desktop App Welcome Screen (HTML) ───────────────────────────────────────
// These are the strings the desktop UI should pull from the profile.

export const DESKTOP_WELCOME = {
  /** The main greeting on the chat welcome screen */
  headline: (cofounderName: string): string =>
    `HIVEMIND`,

  /** The subtitle / description */
  subtitle: (cofounderName: string, userName: string): string =>
    `Your autonomous agent swarm is ready. Say something to ${cofounderName} and the team will get it done.`,

  /** Placeholder text in the chat input */
  inputPlaceholder: (cofounderName: string): string =>
    `Send a message to ${cofounderName} and the swarm...`,

  /** Context hint during active tasks */
  contextHint: (cofounderName: string): string =>
    `Add context or redirect ${cofounderName} while the team works...`,
};

// ─── Progress Spinner Messages ───────────────────────────────────────────────

export const SPINNER = {
  detectingTools: 'Checking your system',
  savingProfile:  'Saving your preferences',
  generatingConfig: 'Generating config',
  frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

// ─── Export everything as a single namespace for convenience ──────────────────

export const OnboardingCopy = {
  banner: ONBOARDING_BANNER,
  welcome: WELCOME_INTRO,
  phase1: { title: PHASE1_TITLE, intro: PHASE1_INTRO, prompts: PROMPTS_PHASE1 },
  phase2: { title: PHASE2_TITLE, intro: PHASE2_INTRO, prompts: PROMPTS_PHASE2 },
  phase3: { title: PHASE3_TITLE, intro: PHASE3_INTRO, tools: TOOL_DETECTION, summary: TOOL_SUMMARY },
  phase4: { title: PHASE4_TITLE, launch: LAUNCH_MESSAGE, suggestions: FIRST_TASK_SUGGESTIONS },
  config: CONFIG_MESSAGES,
  agents: AGENT_ROLES,
  personalities: PERSONALITY_PROMPTS,
  workStyles: WORK_STYLE_PROMPTS,
  errors: ERRORS,
  rerun: RERUN,
  desktop: DESKTOP_WELCOME,
  spinner: SPINNER,
  phaseHeader: PHASE_HEADER,
} as const;
