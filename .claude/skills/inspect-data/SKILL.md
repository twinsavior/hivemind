---
name: inspect-data
description: Inspect production data (cache, database, state) to debug issues. Use when the user asks to check data, inspect a key, debug data issues, or see what's stored.
allowed-tools: Bash
argument-hint: <key_or_query>
---

# Inspect HIVEMIND Data

HIVEMIND uses two local SQLite databases.

## Memory DB (agent memory)

```bash
# List tables
node -e "const db=require('better-sqlite3')('data/hivemind.db');console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all())"

# Recent memory entries
node -e "const db=require('better-sqlite3')('data/hivemind.db');console.log(db.prepare('SELECT id,namespace,title,level,created_at FROM memories ORDER BY created_at DESC LIMIT 10').all())"

# Search by namespace
node -e "const db=require('better-sqlite3')('data/hivemind.db');console.log(db.prepare(\"SELECT title,content FROM memories WHERE namespace LIKE '%$ARGUMENTS%' LIMIT 5\").all())"
```

## Email DB (email parsing module)

```bash
# List tables
node -e "const db=require('better-sqlite3')('data/email.db');console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all())"

# Recent processed emails
node -e "const db=require('better-sqlite3')('data/email.db');console.log(db.prepare('SELECT id,subject,from_email,processed_at FROM processed_emails ORDER BY processed_at DESC LIMIT 10').all())"
```

## Config (hivemind.yaml)

```bash
cat hivemind.yaml
```

## Rules

- Read-only. Never modify data from this skill.
- Show structure first (keys, types, counts), then drill into specifics if needed.
