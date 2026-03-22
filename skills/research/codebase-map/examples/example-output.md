# Example Output: HIVEMIND

This is a complete codebase map produced by running the `codebase-map` skill on the HIVEMIND project itself. Use this as a formatting reference.

---

# Codebase Map: HIVEMIND

## Summary
HIVEMIND is an open-source autonomous agent swarm platform written in TypeScript (strict mode, ES2022 target). It deploys 5 specialized AI agents (Scout, Builder, Sentinel, Oracle, Courier) coordinated by a Nova orchestrator, communicating via EventEmitter patterns and a shared SQLite memory store. The system is accessible through a CLI, an Express+WebSocket dashboard, and an Electron desktop app. At ~20,800 LOC across 48 TypeScript files, it's a medium-sized project with a clean modular architecture, though several core files are growing large enough to warrant refactoring. Confidence: high (read >50% of source files).

## Architecture
```
                         ┌─────────────┐
                         │   Desktop   │
                         │  (Electron) │
                         └──────┬──────┘
                                │ WebSocket
┌─────────┐              ┌─────┴──────┐              ┌───────────┐
│   CLI   │──Commander──▶│ Dashboard  │◀─WebSocket──▶│  Browser  │
│ (index) │              │  (Express) │              │   Client  │
└─────────┘              └─────┬──────┘              └───────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              ┌──────────┐ ┌────────┐ ┌──────────┐
              │   Core   │ │ Memory │ │  Skills  │
              │(LLM,Trust│ │(SQLite)│ │(Loadable)│
              │ Orchestr)│ │ L0/L1  │ │          │
              └────┬─────┘ │  /L2   │ └──────────┘
                   │       └────────┘
        ┌──────────┼──────────┬──────────┬──────────┐
        ▼          ▼          ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │ Scout  │ │Builder │ │Sentinel│ │ Oracle │ │Courier │
   │Research│ │Engineer│ │Security│ │Strategy│ │Comms   │
   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
        │          │          │          │          │
        └──────────┴──────────┴──────────┴──────────┘
                     EventEmitter Bus
```

## Module Map
| Module | Files | LOC | Purpose | Health |
|--------|-------|-----|---------|--------|
| `src/core/` | 17 | ~8,900 | LLM adapters (Claude Code, Codex, OpenAI, Anthropic, Ollama), trust system, orchestrator, tool execution, multi-modal engine, tracing, config | Warning: `server.ts` is 2241 LOC, `tool-executor.ts` is 1832 LOC |
| `src/agents/` | 8 | ~3,200 | BaseAgent cognitive loop, LLMAgent, Scout, Builder, Sentinel, Oracle, Courier | Clean — each agent is a focused module |
| `src/memory/` | 4 | ~1,100 | SQLite-backed memory with L0/L1/L2 hierarchy, context manager, local embedder | Solid abstraction layer |
| `src/dashboard/` | 5 | ~3,500 | Express + WebSocket server, task orchestration, workspace tracker, swarm graph | `server.ts` needs splitting |
| `src/cli/` | 3 | ~1,800 | Commander CLI entry point, commands, skill management commands | `commands.ts` at 1044 LOC — growing |
| `src/connectors/` | 6 | ~900 | Platform connectors: Slack, Discord, Telegram, webhook, base interface | Well-structured with clear base |
| `src/skills/` | 6 | ~1,200 | Skill loader, marketplace server, runtime | Clean module boundary |
| `desktop/` | 3 | ~4,000+ | Electron main process, preload, vanilla JS renderer (single HTML file) | Renderer is one massive file |
| `tests/` | 3 | ~400 | Vitest test suite | Low coverage relative to source |
| `skills/` | 8 | N/A | Built-in skill definitions (YAML frontmatter + markdown) | Good structure following design guide |

## Entry Points
- **CLI**: `src/cli/index.ts` — Commander-based CLI with `up`, `run`, `task`, `config`, `skill` commands. Binary registered as `hivemind` in package.json.
- **Dashboard**: `src/dashboard/server.ts` — Express HTTP + WebSocket server. Hub for task orchestration and agent coordination.
- **Desktop**: `desktop/main.js` — Electron main process. Loads `renderer/index.html` which contains the full chat UI.
- **Library**: `src/index.ts` — Public API barrel file exporting core classes for programmatic use.

## Dependency Graph
```
cli ──────────▶ core ◀──────── dashboard
  │               │                │
  │               ▼                │
  │           agents ◀─────────────┘
  │             │ ▲
  │             ▼ │
  ├──────────▶ memory
  │
  └──────────▶ skills

connectors ──▶ core (base interface)

core/llm ──▶ core/claude-code-provider
         ──▶ core/codex-provider
         ──▶ core/trust
         ──▶ core/multimodal

agents/base-agent ◀── agents/llm-agent ◀── agents/{scout,builder,sentinel,oracle,courier}

memory/store ──▶ memory/context ──▶ memory/local-embedder
```

## External Dependencies
### Production (6 total)
- `better-sqlite3` — SQLite bindings for the memory store (L0/L1/L2 hierarchy)
- `claude-max-api-proxy` — Proxy adapter for Claude API access
- `commander` — CLI framework for argument parsing and subcommands
- `express` — HTTP server for the dashboard and API endpoints
- `ws` — WebSocket server for real-time agent-dashboard communication
- `yaml` — YAML parser for `hivemind.yaml` configuration

### Development (7 total)
- `@types/better-sqlite3` — Type definitions for SQLite bindings
- `@types/express` — Type definitions for Express
- `@types/node` — Node.js type definitions
- `@types/ws` — WebSocket type definitions
- `tsx` — TypeScript execution for development mode (`pnpm dev`)
- `typescript` — TypeScript compiler (strict mode, ES2022)
- `vitest` — Test runner (v4.x)

### Dependency Notes
- Very lean production dependency set (6 packages) — minimal supply chain surface
- No frontend framework dependency — desktop renderer is vanilla HTML/JS
- No ORM — direct SQLite via `better-sqlite3`

## Patterns Detected
- **EventEmitter (Observer)**: Inter-agent communication via Node.js EventEmitter. Agents emit events, dashboard and orchestrator subscribe.
- **Strategy**: LLM providers (Claude Code, Codex, OpenAI, Anthropic, Ollama) are swappable implementations behind the `LLMAdapter` interface in `src/core/llm.ts`.
- **Template Method**: `BaseAgent` defines the cognitive loop (`think` -> `act` -> `observe` -> `report`), subclasses override each phase.
- **Factory**: Agent creation and provider instantiation use factory-style construction with config objects.
- **Middleware**: Express middleware chain in the dashboard server for request handling.
- **Barrel Exports**: `index.ts` files in most modules define public API boundaries.
- **Plugin Architecture**: Skills are loadable plugin folders with YAML frontmatter, discovered at runtime.

## Conventions
- **Naming**: PascalCase for classes/interfaces, camelCase for functions/variables, kebab-case for file names
- **Async**: async/await throughout, no callbacks or raw Promises
- **Errors**: try/catch with error logging, agents return structured results with `success` boolean
- **Imports**: Relative paths with `.js` extensions (ESM), type-only imports via `import type`
- **Config**: Layered precedence — CLI args > env vars > `hivemind.yaml` > defaults
- **Types**: TypeScript strict mode, interfaces preferred over abstract classes

## Strengths
1. **Clean agent abstraction.** The BaseAgent -> LLMAgent -> SpecializedAgent hierarchy is well-designed. Each agent has a clear role and the cognitive loop (`think`/`act`/`observe`/`report`) is a strong organizing principle.
2. **Minimal dependencies.** Only 6 production dependencies. This means a small attack surface, fast installs, and fewer breaking changes from upstream.
3. **Multi-modal capability.** Scout agent handles images, PDFs, audio, and screenshots through a unified `MultiModalEngine` — not many agent frameworks offer this out of the box.
4. **Layered memory system.** The L0/L1/L2 memory hierarchy (hot/warm/cold) with SQLite backing is a pragmatic design that avoids the complexity of vector databases while still providing structured recall.
5. **Skill system design.** Skills as folders with progressive disclosure (SKILL.md + references/ + examples/) is a mature pattern. The design guide enforces consistency.

## Concerns
1. **Large files need splitting.** `dashboard/server.ts` (2241 LOC) and `core/tool-executor.ts` (1832 LOC) are doing too much. Extract route handlers and tool implementations into separate files.
2. **Low test coverage.** Only 3 test files covering 48 source files (~6% file coverage). Critical paths like the orchestrator, memory store, and agent cognitive loop need tests.
3. **Desktop renderer is monolithic.** The entire chat UI lives in a single vanilla JS file inside `renderer/index.html`. Any modification risks regressions. Consider extracting into modules or at minimum splitting into separate JS files.
4. **No linter configuration found.** ESLint is referenced in package.json scripts but no `.eslintrc` or `eslint.config.*` was detected. Linting may not actually be enforced.
5. **Connector implementations may be stubs.** The connectors directory has the right structure but each connector should be verified for completeness — Slack/Discord/Telegram integrations often require significant OAuth and webhook handling.

## Health Metrics
- **Test Coverage**: ~6% file coverage (3 test files / 48 source files). No coverage tool configured beyond `vitest run --coverage` script.
- **Tech Debt Markers**: Not fully scanned — recommend running `grep -r "TODO\|FIXME\|HACK\|@ts-ignore" src/` for a count
- **Documentation**: 4/5 — Comprehensive README, CONTRIBUTING.md, skill design guide, architecture docs in CLAUDE.md. Inline JSDoc present on key classes.
- **Largest File**: `src/dashboard/server.ts` at 2241 LOC — serves as both HTTP server, WebSocket handler, task orchestrator, and agent coordinator. Prime refactoring candidate.

## Getting Started (New Contributors)
1. **Install and run.** `pnpm install && pnpm dev` to start in development mode. Requires Node.js >= 20.
2. **Read the architecture.** Start with `.claude/CLAUDE.md` for the system overview, then `skills/SKILL_DESIGN_GUIDE.md` if you want to add skills.
3. **Understand the agent loop.** Read `src/agents/base-agent.ts` (525 LOC) — the `think`/`act`/`observe`/`report` cycle is the foundation everything else builds on.
4. **First good contribution.** Extract route handlers from `src/dashboard/server.ts` into a `src/dashboard/routes/` directory. This is a low-risk, high-impact refactor.
5. **Add a test.** Pick any agent in `src/agents/` and write a Vitest test for its `think()` method. The test infrastructure is already set up — just add files to `tests/`.
