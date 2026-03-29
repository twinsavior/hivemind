---
name: scan-secrets
description: Scan the current repo for exposed API keys, passwords, and tokens. Use when the user says scan secrets, check for keys, audit secrets, or before making a repo public.
allowed-tools: Bash
argument-hint: [--history to scan full git history]
---

# Scan for Exposed Secrets

Uses gitleaks to scan the current repository for API keys, passwords, tokens, and other secrets.

## Steps

1. **Determine scan scope:**
   - Default: Scan current working directory files only (fast)
   - With `--history` argument: Scan full git history (thorough, slower)

2. **Run the scan:**

   For current files only:
   ```bash
   /opt/homebrew/bin/gitleaks dir . --no-banner 2>&1
   ```

   For full git history:
   ```bash
   /opt/homebrew/bin/gitleaks git . --no-banner 2>&1
   ```

3. **Report results:**
   - If clean: "No secrets found."
   - If secrets detected: List each finding with file path, line number, and what type of secret it appears to be. **Do NOT print the actual secret value** — just the type and location.
   - Recommend: Move the secret to `~/.config/shared-env/` and reference via environment variable.

## When to Use

- Before making a private repo public
- After onboarding a new API key
- As a periodic audit (monthly)
- If you suspect a key was accidentally committed

## Notes

- The global pre-commit hook already blocks new commits with secrets
- This skill catches secrets that were committed BEFORE the hook was installed
- If secrets are found in git history, they should be considered compromised — rotate them
