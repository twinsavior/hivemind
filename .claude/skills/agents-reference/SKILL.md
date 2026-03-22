---
name: agents-reference
description: Agent types, system prompts, provider wiring, cognitive loop. Auto-loads when working on src/agents/ or src/cli/commands.ts.
user-invocable: false
---

# Agents (`src/agents/` + `src/cli/commands.ts`)

## Agent Types

| Agent | ID | Provider | Role |
|---|---|---|---|
| Nova | nova-1 | Claude Code | Coordinator — delegates, reviews, synthesizes |
| Scout Alpha | scout-1 | Claude Code | Research — web search, file exploration |
| Builder Prime | builder-1 | Codex | Code generation and modification |
| Sentinel Watch | sentinel-1 | Codex | Code review, security, testing |
| Oracle Insight | oracle-1 | Claude Code | Deep analysis, architecture advice |
| Courier Express | courier-1 | Claude Code | Communication, formatting, summaries |

## Provider Architecture

### Claude Code (`src/core/claude-code-provider.ts`)
- Uses `claude -p` CLI with `--resume` for persistent sessions
- Session key: `agentId:conversationId` — isolates per conversation
- Auto-summarization when context grows large
- `--max-turns 50` to prevent infinite loops
- MCP server passthrough supported

### Codex (`src/core/codex-provider.ts`)
- Uses `codex exec` CLI with `--json --ephemeral --skip-git-repo-check`
- `--full-auto` flag for write-capable agents (Builder, Sentinel)
- JSONL event stream: `message.delta`, `item.completed`, `response.completed`
- No session persistence (ephemeral by design)
- No API key needed — authenticates via "Sign in with ChatGPT"

## System Prompts (`src/cli/commands.ts`)
- `NOVA_PROMPT` — Nova's full system prompt including delegation format, review protocol, ground truth rule
- `AGENT_PREAMBLE` — Shared prefix for all sub-agents (ground truth rule, tool instructions)
- Each agent gets specialized instructions appended to the preamble

## Cognitive Loop (`src/agents/base-agent.ts`)
- `think()` → `act()` → `observe()` → `report()`
- Used by `LLMAgent` for non-Nova tasks
- Nova does NOT use this loop — she runs via `coordinateRequest()` subprocess

## Key Prompts

### Builder Prime
- Large File Strategy: Edit tool for surgical changes, never rewrite files >200 lines
- Addresses review feedback specifically (for the review loop)

### Nova
- Code Review Protocol: Reviews Builder's code, responds with `[APPROVED]` or `[REVISE]`
- Ground Truth Rule: Must read actual files before reporting on codebase state
- Delegation format: JSON block with `delegations[]` array

## Gotchas
1. **Codex uses `--full-auto` not `--approval-mode`.** The latter doesn't exist and silently fails.
2. **Provider health checks run at startup** in `commands.ts`. If Codex CLI isn't installed, `hasCodex` is false and those agents fall back to Claude Code.
3. **Trust system** (`src/core/trust.ts`) controls which tools each agent can use. Builder gets Edit/Write/Bash; Scout only gets Read/Grep/Glob/WebSearch.
