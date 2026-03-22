# Skill Design Guide

> Based on lessons from the Claude Code team at Anthropic (Thariq, March 2026).
> Every skill in this project should follow these principles.

## Core Principle: Skills Are Folders, Not Files

A skill is a **directory** that can contain:
- `SKILL.md` — the main instructions (what Claude reads first)
- `references/` — API docs, function signatures, detailed specs (read on demand)
- `examples/` — code snippets, templates, sample outputs
- `scripts/` — executable helpers Claude can run
- `assets/` — templates, config files, data
- `config.json` — user-specific setup (channels, endpoints, preferences)
- `*.log` / `data/` — skill memory (append-only logs, JSON state)

Claude discovers these files and reads them when relevant. This is **progressive disclosure** — don't cram everything into one markdown file.

## The 9 Skill Categories

1. **Library & API Reference** — How to use a lib/CLI correctly. Include gotchas and code snippets.
2. **Product Verification** — Test that code works. Pair with Playwright, tmux, CDP. Record evidence.
3. **Data Fetching & Analysis** — Connect to data sources. Include helper scripts and query patterns.
4. **Business Process Automation** — One command for repetitive workflows. Store logs for consistency.
5. **Code Scaffolding & Templates** — Generate boilerplate specific to YOUR codebase.
6. **Code Quality & Review** — Enforce standards. Run adversarial reviews. Use deterministic scripts.
7. **CI/CD & Deployment** — Build, test, deploy, babysit PRs, auto-rollback.
8. **Runbooks** — Symptom → investigation → structured report. Multi-tool debugging.
9. **Infrastructure Operations** — Maintenance with guardrails. Destructive actions need confirmation.

## Writing Tips

### 1. Don't State the Obvious
Claude knows how to code. Focus on what pushes it OUT of its defaults — your org's patterns, your naming conventions, your specific gotchas.

### 2. Build a Gotchas Section
The highest-signal content in any skill. Build it up over time as Claude hits edge cases. Format:
```
## Gotchas
- **[Trap description].** Wrong: `do_this()`. Right: `do_that()`. [Why it matters.]
```

### 3. The Description Field Is for the Model
Claude scans descriptions to decide "is there a skill for this?" Write it as a trigger condition, not a summary.
- Bad: "A skill for web research"
- Good: "Deep web research with source verification — use when the user asks to research, investigate, or find information about any topic"

### 4. Avoid Railroading
Give Claude the info it needs, but let it adapt. Don't over-specify step order when flexibility helps.
- Bad: "Step 1: Always run npm test. Step 2: Always run npm lint."
- Good: "Verify the code works. At minimum: type-check and test. Add lint if the project has it configured."

### 5. Use config.json for Setup
If a skill needs user-specific info (Slack channel, API endpoint, preferred format), store it in `config.json`:
```json
{ "slack_channel": "#eng-updates", "format": "brief" }
```
If the config doesn't exist, ask the user once and create it.

### 6. Store Data for Memory
Skills can maintain their own state:
- `standups.log` — append-only log of every standup posted
- `last_run.json` — timestamp and results of the last execution
- Use `${CLAUDE_PLUGIN_DATA}` for stable storage that survives upgrades

### 7. Bundle Scripts
Give Claude composable code instead of making it generate boilerplate every time:
```
scripts/
  fetch-metrics.ts    # Helper to pull data from your monitoring stack
  format-report.ts    # Standard report formatting
  validate-schema.ts  # Schema validation utility
```

### 8. On-Demand Hooks
Skills can register session-scoped hooks via frontmatter:
- `/careful` — blocks `rm -rf`, `DROP TABLE`, force-push when touching prod
- `/freeze` — blocks edits outside a specific directory during debugging

### 9. Progressive Disclosure
Split large skills into multiple files:
```
my-skill/
  SKILL.md              # Core instructions (always loaded)
  references/api.md     # Detailed API docs (read when needed)
  references/schema.md  # Data structures (read when needed)
  examples/good.ts      # Example of correct usage
  examples/bad.ts       # Example of what NOT to do
```
Tell Claude what files exist in SKILL.md. It reads them at the right time.

## Measuring Quality

Score each skill on 7 dimensions (1-5 each, 35 max):

| Dimension | What to check |
|-----------|--------------|
| Trigger Coverage | 8+ natural phrases users would actually say |
| Instruction Clarity | Every step is a concrete, testable action |
| Output Format | Exact template with examples |
| Failure Handling | Guardrails, escape hatches, common mistakes |
| Memory Integration | Clear L0/L1/L2 storage with namespace |
| Conciseness | Every line changes behavior |
| Tool Specificity | Names exact tools and how to use them |

**28+/35 = production-ready.** Below that, needs optimization.
