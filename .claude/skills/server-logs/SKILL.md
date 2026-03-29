---
name: server-logs
description: Check production server logs. Use when the user asks to check logs, debug server issues, check if the server is running, or after a deploy to verify status.
allowed-tools: Bash
argument-hint: [line_count]
---

# Check Server Status

HIVEMIND runs locally via the Electron desktop app or CLI. No remote server.

## Health Check

```bash
curl -s http://localhost:${HIVEMIND_DASHBOARD_PORT:-4000}/health | python3 -m json.tool
```

## Agent Status

```bash
curl -s http://localhost:${HIVEMIND_DASHBOARD_PORT:-4000}/api/agents | python3 -m json.tool
```

## Email Module Status

```bash
curl -s http://localhost:${HIVEMIND_DASHBOARD_PORT:-4000}/api/email/pipeline/status | python3 -m json.tool
```

## Troubleshooting

1. Port in use: `lsof -ti :${HIVEMIND_DASHBOARD_PORT:-4000}`
2. Node version (requires 22+): `node --version`
3. Native bindings: `node -e "require('better-sqlite3')" 2>&1`
   - If broken: `npm rebuild better-sqlite3`
