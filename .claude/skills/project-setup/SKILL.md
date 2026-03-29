---
name: project-setup
description: First-run project setup interview. Auto-triggers when CLAUDE.md still contains the template placeholder '[Project Name]'. Asks the user questions, configures all project files, and creates a GitHub repo automatically.
user-invocable: true
allowed-tools: Bash, AskUserQuestion, Read, Edit, Write
---

# First-Run Project Setup

**Trigger:** This skill activates automatically when `CLAUDE.md` in the project root still contains `[Project Name]` — meaning the starter kit template hasn't been configured yet.

**On every conversation start, check:** Does `CLAUDE.md` line 1 contain `[Project Name]`? If yes, run this interview before doing anything else.

## Interview Flow

Greet the user briefly, then ask these questions using `AskUserQuestion`. Ask them in batches of 2-4 to keep it conversational, not overwhelming.

### Batch 1: Project Identity

Ask these together:

1. **"What's this project called?"** (Free text. Used for CLAUDE.md title, GitHub repo name, and folder references.)

2. **"Describe it in 1-2 sentences — what does it do?"** (Free text. Goes into "What This Project Is" section.)

3. **"What's the tech stack?"** (Options + Other)
   - React + TypeScript + Vite (Recommended)
   - Next.js + TypeScript
   - Python backend + HTML frontend
   - Other (let them type)

4. **"Will this have a production server, or is it local-only for now?"**
   - Production server (I have or will have hosting)
   - Local only for now
   - Not sure yet

### Batch 2: Production Details (only if they said "Production server")

5. **"What's the server SSH command?"** (Free text, e.g., `ssh user@1.2.3.4`)

6. **"What's the deploy method?"** (Options + Other)
   - rsync + systemctl restart
   - Docker push + restart
   - git push (Heroku/Railway/Render)
   - Vercel/Netlify (auto-deploy from git)
   - Other

7. **"Domain name?"** (Free text, e.g., `myproject.com` or "none yet")

### Batch 3: API Keys & Design

8. **"Which shared API key tiers does this project need?"** (Multi-select)
   - AI / Analytics (Gemini, OpenAI, Clarity) — always safe
   - Marketing / CRM (Meta, Klaviyo, GSC, etc.)
   - Commerce / Orders (Shopify, ShipBob, QBO)
   - Infrastructure / Messaging (Slack, SMTP, Gmail)
   - None — this project has its own keys

9. **"Are you using the shadcnuikit.com component kit?"** (Only ask if stack includes React/Next.js)
   - Yes — I'll paste the API key
   - No

10. **"Any architecture decisions you've already made that I should know about?"** (Free text, optional. E.g., "No ORMs", "Use Supabase not raw Postgres", "Monorepo".)

## After the Interview

Using the answers, automatically perform ALL of the following steps. Do not ask for permission — just do them.

### 1. Git + GitHub Repository

This is the FIRST thing to do after the interview, before updating any files.

**GitHub account:** `twinsavior` (already authenticated via `gh` CLI at `/opt/homebrew/bin/gh`)

a. Check if already a git repo (`git rev-parse --git-dir`). If not, run `git init`.

b. Check if a GitHub remote already exists (`git remote -v`). If not:
   - Create a **private** GitHub repo using the project name (kebab-case):
     ```bash
     /opt/homebrew/bin/gh repo create twinsavior/<project-name> --private --source=. --push
     ```
   - This creates the repo, sets the `origin` remote, and pushes in one command.

c. If the repo already exists on GitHub but has no remote, just add it:
   ```bash
   git remote add origin https://github.com/twinsavior/<project-name>.git
   ```

d. Set default branch to `main`:
   ```bash
   git branch -M main
   ```

**Always private by default.** The user can make it public later if they want.

### 2. CLAUDE.md
- Replace `[Project Name]` with the project name
- Fill in "What This Project Is" with description + stack
- Fill in "Production Environment" with server/deploy/domain details (or remove section if local-only)
- Add any architecture decisions to "Key Architecture Decisions"
- Add the GitHub repo URL to the Production Environment section
- Leave "Common Tasks" and "Cross-Cutting Gotchas" as templates — these get filled in during real work

### 3. .env
- Uncomment the `source` lines for whichever shared env tiers they selected
- Add `SHADCNUIKIT_API_KEY=` placeholder if they said yes to the UI kit

### 4. deploy/SKILL.md
- Replace placeholder commands with their actual deploy method:
  - rsync: Fill in SSH host and path
  - Docker: Fill in container/image names
  - Vercel/Netlify: Replace with "Deploy is automatic on git push. Check deployment status at [URL]."
  - git push: Fill in remote name
- If local-only: Replace deploy skill content with "No production server configured yet. Run `/project-setup` again when you have hosting."

### 5. server-logs/SKILL.md
- Fill in the SSH + journalctl command with their server details
- If Docker: Use `docker logs` commands instead
- If Vercel/Netlify: Replace with platform-specific log commands
- If local-only: Replace with "No production server configured yet."

### 6. design-system/SKILL.md
- If React/Next.js stack: Keep shadcn/ui references, add their brand tokens section
- If Python/HTML stack: Replace with simpler CSS/design patterns reference
- If they have shadcnuikit API key: Add setup instructions for the CLI

### 7. Initial Commit + Push
- Stage all configured files:
  ```bash
  git add CLAUDE.md SESSION_STATE.md .claude/ .gitignore
  ```
  (Do NOT stage `.env` — it's in `.gitignore`)
- Create initial commit:
  ```bash
  git commit -m "Initial project setup via Claude starter kit"
  ```
- Push to GitHub:
  ```bash
  git push -u origin main
  ```
- Confirm: "Project is set up and pushed to https://github.com/twinsavior/<project-name>. What do you want to build first?"

## Re-running Setup

The user can run `/project-setup` manually at any time to reconfigure. If CLAUDE.md no longer has `[Project Name]`, ask "Your project is already configured. Do you want to reconfigure it? This will overwrite your current CLAUDE.md." before proceeding.

## Troubleshooting

- **`gh` not found:** Try `/opt/homebrew/bin/gh`. If still missing: `brew install gh && gh auth login`.
- **Auth expired:** Run `gh auth login` and follow the prompts.
- **Repo name conflict:** If the repo already exists on GitHub, ask the user if they want to connect to it or pick a different name.
