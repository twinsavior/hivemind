# Contributing to HIVEMIND

Thank you for your interest in contributing to HIVEMIND. This guide covers everything you need to get started.

## Ways to Contribute

- **Code** — Fix bugs, implement features, or improve performance
- **Skills** — Build new agent skills and capabilities
- **Documentation** — Improve guides, API docs, or examples
- **Testing** — Write tests, report bugs, or help with QA
- **Translations** — Help localize HIVEMIND for other languages

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v22 or later
- [pnpm](https://pnpm.io/) v9 or later
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/your-org/hivemind.git
cd hivemind

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run the test suite
pnpm test

# Start the development dashboard
pnpm dev:dashboard
```

### Project Structure

```
hivemind/
├── src/
│   ├── core/           # Core swarm engine and agent lifecycle
│   ├── agents/         # Agent types and behaviors
│   ├── skills/         # Built-in skill definitions
│   ├── memory/         # Shared memory and knowledge graph
│   ├── communication/  # Inter-agent messaging
│   ├── dashboard/      # Web dashboard (React + Three.js)
│   └── index.ts        # Main entry point
├── tests/              # Test suites
├── docs/               # Documentation
└── examples/           # Example configurations and workflows
```

## Pull Request Guidelines

### Before You Start

1. Check the [issue tracker](https://github.com/your-org/hivemind/issues) to see if your idea is already being worked on.
2. For large changes, open an issue first to discuss the approach.
3. Fork the repository and create your branch from `main`.

### Branch Naming

Use descriptive branch names:

- `feat/agent-memory-sharing` — New feature
- `fix/websocket-reconnect` — Bug fix
- `docs/skill-authoring-guide` — Documentation
- `skill/web-scraper` — New agent skill

### Commit Messages

Write clear, concise commit messages:

```
feat: add inter-agent memory synchronization

Implement a CRDT-based shared memory layer that allows agents
to synchronize state without a central coordinator.
```

Use conventional commit prefixes: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`.

### PR Checklist

Before submitting your pull request:

- [ ] Code compiles without errors (`pnpm build`)
- [ ] All tests pass (`pnpm test`)
- [ ] Linting passes (`pnpm lint`)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] New code has tests where appropriate
- [ ] Documentation is updated if needed

### Review Process

1. Submit your PR against `main`.
2. A maintainer will review your changes, usually within a few days.
3. Address any feedback and push follow-up commits.
4. Once approved, a maintainer will merge your PR.

## Writing Skills

Skills are modular capabilities that agents can learn and execute. To contribute a new skill:

1. Create a new file in `src/skills/` following the existing patterns.
2. Implement the `Skill` interface with `name`, `description`, `input schema`, and `execute` method.
3. Write tests in `tests/skills/`.
4. Add documentation for the skill's usage and parameters.
5. Submit a PR with the `skill` label.

See existing skills in `src/skills/` for reference implementations.

## Code Style

- We use [Biome](https://biomejs.dev/) for linting and formatting.
- Run `pnpm lint` and `pnpm format:check` before committing.
- Follow existing code patterns and naming conventions.
- Prefer explicit types over `any`.
- Document public APIs with JSDoc comments.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you agree to uphold a welcoming, inclusive, and respectful community.

## Questions?

If you have questions about contributing, open a [discussion](https://github.com/your-org/hivemind/discussions) or reach out to the maintainers.

We appreciate every contribution, no matter how small. Thank you for helping build HIVEMIND.
