---
name: codebase-map
version: 1.0.0
agent: scout
description: "Deep structural analysis of a local codebase — maps dependencies, identifies patterns, catalogs abstractions, detects tech debt hotspots. Use when asked to understand, explore, map, or onboard onto any repository"
triggers: ["map this codebase", "understand this repo", "architecture overview", "how is this project structured", "onboard me", "codebase analysis", "show me the architecture", "what does this codebase do", "explore this project", "repo walkthrough", "code tour", "explain this project structure"]
dependencies: []
requiredSecrets: []
timeout: 600
tags: ["codebase", "architecture", "analysis", "onboarding", "structure", "dependencies", "tech-debt"]
author: nova
optional: true
---

# Codebase Map

Deep structural analysis of any local codebase. Produces a comprehensive report covering architecture, dependencies, patterns, and health — enough to onboard a new contributor in 2 minutes.

## Reference Files

- `references/language-detection.md` — Config file signatures for every major language and framework. Read this when identifying what a project uses.
- `examples/example-output.md` — Complete example output from running this skill on HIVEMIND itself. Use as a formatting template.

## Process

Run all five phases sequentially. Each phase builds on the previous one. Adapt depth to project size — a 500-file project needs more detail than a 20-file script.

### Phase 1: Surface Scan

Establish what the project *is* before diving into structure.

1. **Detect project type.** Check for config files at the root: `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`, `build.gradle`, `CMakeLists.txt`, `Gemfile`, `mix.exs`, `deno.json`, etc. See `references/language-detection.md` for the full lookup table.
2. **Count files by type.** Use `find` or glob to tally source files by extension. Report: `47 .ts files, 3 .js files, 12 .md files`
3. **Estimate total LOC.** Run `wc -l` across source files (exclude `node_modules/`, `dist/`, `build/`, `vendor/`, `.git/`). Break down by language.
4. **Identify build system.** Look for: `tsconfig.json`, `webpack.config.*`, `vite.config.*`, `Makefile`, `Dockerfile`, `docker-compose.yml`, CI configs (`.github/workflows/`, `.gitlab-ci.yml`)
5. **Detect test framework.** Check config files and devDependencies: `vitest`, `jest`, `mocha`, `pytest`, `go test`, `cargo test`, `rspec`
6. **Read README.** If present, extract the project's self-description. Use it to validate your own analysis later.

### Phase 2: Structural Mapping

Map the directory tree and identify what each area does.

1. **Generate directory tree.** List top-level directories and one level of subdirectories. Skip `node_modules/`, `dist/`, `.git/`, `build/`, `vendor/`.
2. **Annotate each directory.** Read 2-3 files in each directory to understand its purpose. Write a one-line description: `src/core/ — LLM adapters, trust system, orchestration logic`
3. **Find entry points.** Look for:
   - `main`, `index`, `app`, `server` files at expected locations
   - `bin` field in `package.json`
   - `main` in `Cargo.toml`
   - `__main__.py` or console_scripts in Python
   - CLI entry points
4. **Catalog configuration files.** List every config file and its role: `tsconfig.json — TypeScript compiler settings (strict mode, ES2022)`
5. **Identify module boundaries.** Look for barrel files (`index.ts`, `mod.rs`, `__init__.py`) that define public API surfaces.

### Phase 3: Dependency Analysis

Map how modules connect to each other and what external code the project relies on.

1. **Internal dependency graph.** For each major module/directory:
   - What does it import from other modules?
   - What modules import from it?
   - Represent as a text-based graph: `core --> agents, memory, dashboard`
2. **External dependencies.** From the package manifest, list:
   - Production dependencies with one-line purpose annotations
   - Dev dependencies with annotations
   - Flag any dependencies that are unusually large, unmaintained (>2 years since last update), or have known vulnerabilities
3. **Circular dependency detection.** Check for A->B->A import cycles. These are refactoring priorities.
4. **Coupling assessment.** Identify tightly coupled modules (>5 cross-imports) vs. loosely coupled ones. Tight coupling = harder to change independently.

### Phase 4: Pattern Recognition

Identify the design philosophy and conventions the team follows.

1. **Design patterns.** Scan for:
   - Factory pattern (functions returning class instances)
   - Observer/EventEmitter pattern (`.on()`, `.emit()`, event buses)
   - Strategy pattern (swappable implementations behind interfaces)
   - Singleton pattern (module-level instances)
   - Repository pattern (data access abstractions)
   - Middleware pattern (Express-style `.use()`)
   - Builder pattern (chained configuration)
2. **Code conventions.** Note:
   - Naming style (camelCase, snake_case, PascalCase for files vs exports)
   - Error handling approach (try/catch, Result types, error codes)
   - Async patterns (async/await, callbacks, Promises, Observables)
   - Import style (relative vs aliases, barrel imports)
3. **Architecture style.** Classify:
   - Monolith with internal modules
   - Microservices
   - Layered (controller -> service -> repository)
   - Hexagonal / ports-and-adapters
   - Event-driven
   - Plugin-based
4. **Anti-patterns.** Flag:
   - God files (>500 LOC with mixed responsibilities)
   - Deep nesting (>4 levels)
   - Magic numbers / hardcoded values
   - Inconsistent error handling
   - Dead code (exported but never imported)

### Phase 5: Health Assessment

Evaluate project health for someone deciding whether to contribute or adopt.

1. **Largest files.** List the top 10 files by LOC. Files >500 LOC are refactoring candidates — note why they're large and whether the size is justified.
2. **Test coverage estimation.** Count test files vs source files. Check if tests exist for each module. Note any completely untested modules.
3. **Tech debt hotspots.** Look for:
   - TODO/FIXME/HACK comments (count and list the most significant)
   - `any` types in TypeScript
   - `@ts-ignore` / `@ts-expect-error`
   - `eslint-disable` directives
   - Commented-out code blocks
4. **Documentation quality.** Score on:
   - README completeness (setup, usage, contributing)
   - API documentation (JSDoc, docstrings, doc comments)
   - Architecture docs (ADRs, design docs)
   - Inline comments (present but not excessive)
5. **Dependency freshness.** Flag major-version-behind dependencies.

## Output Format

Produce the report in this exact structure. Every section is required — if data is unavailable, say "Not detected" rather than omitting.

```
# Codebase Map: [Project Name]

## Summary
[One paragraph: what the project is, what language/framework it uses, its architecture style, approximate size, and overall health impression]

## Architecture
[ASCII diagram showing major components and how they connect]

## Module Map
| Module | Files | LOC | Purpose | Health |
|--------|-------|-----|---------|--------|
| src/core/ | 12 | 3400 | LLM adapters, orchestration | ⚠ server.ts is 2200 LOC |
| ... | ... | ... | ... | ... |

## Entry Points
- **CLI**: `src/cli/index.ts` — Commander-based CLI with `up`, `run`, `config` commands
- **Server**: `src/dashboard/server.ts` — Express + WebSocket on port 3000
- **Desktop**: `desktop/main.js` — Electron main process

## Dependency Graph
```
[Text-based graph showing internal module dependencies]
```

## External Dependencies
### Production (N total)
- `express` — HTTP server framework
- ...

### Development (N total)
- `vitest` — Test runner
- ...

## Patterns Detected
- **[Pattern Name]**: [Where it appears and how it's used]
- ...

## Conventions
- **Naming**: [style]
- **Async**: [approach]
- **Errors**: [approach]
- **Imports**: [style]

## Strengths
1. [Strength with evidence]
2. ...

## Concerns
1. [Concern with evidence and suggested fix]
2. ...

## Health Metrics
- **Test Coverage**: [estimated %] — [N test files covering M source files]
- **Tech Debt Markers**: [N TODOs, M FIXMEs, K type escapes]
- **Documentation**: [score/5 with breakdown]
- **Largest File**: [path] at [N] LOC — [why it's large]

## Getting Started (New Contributors)
1. [First thing to do]
2. [Second thing to do]
3. [Where to look to understand the system]
4. [First good issue to tackle]
5. [Who/what to ask for help]
```

## Guardrails

- Do NOT modify any files in the target codebase. This is a read-only analysis.
- Do NOT execute project code (no `npm start`, `cargo run`, etc.). Analyze statically.
- Do NOT read `.env` files or files likely containing secrets. Note their existence but skip contents.
- Do NOT traverse into `node_modules/`, `vendor/`, `.git/`, or other dependency directories.
- If the codebase is very large (>1000 source files), sample strategically rather than reading every file. Note that you sampled.
- If you encounter binary files, note them but don't try to read them.
- Flag confidence level: "high" if you read >50% of source files, "medium" for 20-50%, "low" for <20%.

## Memory

Store under `codebase-map.<project-name-slug>`:
- **L0**: One-sentence project description with language, framework, and architecture style
- **L1**: Module table and dependency graph
- **L2**: Full codebase map report

## Adaptation by Project Size

| Project Size | Files | Approach |
|-------------|-------|----------|
| Tiny | <20 | Read every file. Full detail. |
| Small | 20-100 | Read every file. Full detail. |
| Medium | 100-500 | Read all directory indexes + largest files + a sample from each module. |
| Large | 500-2000 | Sample 3-5 files per module. Focus on public APIs and entry points. |
| Huge | >2000 | Top-level structure + entry points + config files + largest files only. Note sampling. |
