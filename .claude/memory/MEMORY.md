# Cross-Session Learnings

## CLI Quirks
- **Codex CLI:** Uses `--full-auto` for autonomous mode. `--approval-mode` does NOT exist and silently fails (no error, just exits non-zero). Always check `codex exec --help` before adding flags.
- **Claude Code CLI:** `claude -p` for prompt mode, `--resume <sessionId>` for persistent sessions. `--max-turns` caps iteration count. Session files stored in `~/.claude/`.
- **Claude Code streaming:** Outputs plain text to stdout, not JSONL. Codex outputs JSONL events.

## User Preferences (Saul)
- Non-technical — prefers GUI over terminal
- Wants to see things working visually, not code explanations
- Gets frustrated when agents go silent during long tasks — always show progress
- Expects Nova to be as capable as using Claude Code directly
