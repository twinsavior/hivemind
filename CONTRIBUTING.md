# Contributing to HIVEMIND

Thank you for your interest in contributing to HIVEMIND. This guide covers everything you need to get started.

## Ways to Contribute

- **Code** — Fix bugs, implement features, or improve performance
- **Skills** — Build new agent skills and capabilities
- **Documentation** — Improve guides or examples
- **Testing** — Write tests, report bugs, or help with QA

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) v10 or later
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/twinsavior/hivemind.git
cd hivemind

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run the test suite
pnpm test

# Start in development mode (hot-reload via tsx)
pnpm dev
```

### Project Structure

```
hivemind/
├── src/
│   ├── core/           # LLM adapter, providers, orchestrator, trust system
│   ├── agents/         # BaseAgent + 5 specialized agents
│   ├── skills/         # Skill loader, registry, executor
│   ├── memory/         # SQLite store, L0/L1/L2 hierarchy, context manager
│   ├── connectors/     # Slack, Discord, Telegram, webhook connectors
│   ├── dashboard/      # Express + WebSocket server
│   └── cli/            # CLI entry point, commands, onboarding
├── desktop/            # Electron app, chat UI (vanilla HTML/JS)
├── skills/             # Built-in skill folders (YAML frontmatter)
├── tests/              # Test suites (Vitest)
└── public/             # Static dashboard assets
```

## Pull Request Guidelines

### Before You Start

1. Check the [issue tracker](https://github.com/twinsavior/hivemind/issues) to see if your idea is already being worked on.
2. For large changes, open an issue first to discuss the approach.
3. Fork the repository and create your branch from `main`.

### Branch Naming

Use descriptive branch names:

- `feature/agent-memory-sharing` — New feature
- `fix/websocket-reconnect` — Bug fix
- `docs/skill-authoring-guide` — Documentation
- `chore/update-deps` — Maintenance

### Commit Messages

Write clear, concise commit messages using conventional commit prefixes:

```
feat: add inter-agent memory synchronization
fix: prevent WebSocket reconnect loop
docs: update skill authoring guide
test: add orchestrator edge case coverage
refactor: extract trust validation into module
chore: update dependencies
```

### PR Checklist

Before submitting your pull request:

- [ ] Code compiles without errors (`pnpm build`)
- [ ] All tests pass (`pnpm test`)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] New code has tests where appropriate
- [ ] Documentation is updated if needed

### Review Process

1. Submit your PR against `main`.
2. A maintainer will review your changes.
3. Address any feedback and push follow-up commits.
4. Once approved, a maintainer will merge your PR.

## Writing Skills

Skills are **folders, not single files**. Each skill uses progressive disclosure:

```
skills/category/skill-name/
  SKILL.md              # Core instructions (always loaded first)
  references/           # Detailed specs (loaded on demand)
  examples/             # Usage examples
  scripts/              # Executable helpers
```

Skills use YAML frontmatter for metadata (`name`, `agent`, `triggers`, `timeout`, etc.). See `skills/SKILL_DESIGN_GUIDE.md` for the full design guide and existing skills for reference.

## Code Style

- TypeScript strict mode, ES2022
- Async/await for all I/O
- EventEmitter for inter-agent communication
- Interfaces over abstract classes
- Prefer explicit types over `any`

## Questions?

If you have questions about contributing, open a [discussion](https://github.com/twinsavior/hivemind/discussions) or reach out to the maintainers.

We appreciate every contribution. Thank you for helping build HIVEMIND.
