---
name: discord-notify
version: 1.0.0
agent: communicator
description: "Send formatted notifications, alerts, and reports to Discord channels via the REST API"
triggers: ["notify discord", "send to discord", "discord message", "post to discord", "alert discord", "send a discord alert", "discord update", "message discord"]
dependencies: []
requiredSecrets: ["DISCORD_BOT_TOKEN"]
timeout: 30
tags: ["discord", "notification", "messaging", "alerting"]
author: hivemind-core
optional: true
---

# Discord Notification

Send rich notifications to Discord channels. Classify the message type, format with embeds, deliver, confirm.

## Process

### Phase 1: Classify the Message

Determine type from context:

| Type | When | Embed Color |
|------|------|-------------|
| **Alert** | Something needs immediate attention | Red (`0xED4245`) |
| **Report** | Summary of completed work | Blue (`0x5865F2`) |
| **Update** | Status change or progress | Green (`0x57F287`) |
| **Question** | Needs team input | Yellow (`0xFEE75C`) |

### Phase 2: Resolve the Channel

1. If the user specifies a channel ID -> use it
2. If `config.discord.channels` exists in memory -> use the mapping (alerts -> #alerts, reports -> #general, etc.)
3. If neither -> ask the user: "Which Discord channel should I send this to? (Provide the channel ID)"

Do NOT guess the channel. Wrong channel = noise for the wrong people.

### Phase 3: Compose the Message

Use Discord embed JSON. Here's the template for each type:

**Alert:**
```json
{
  "embeds": [{
    "title": "[Alert Title]",
    "description": "[What happened and what to do about it]",
    "color": 15548997,
    "fields": [
      {"name": "Severity", "value": "[High/Medium/Low]", "inline": true},
      {"name": "Source", "value": "[What triggered this]", "inline": true}
    ],
    "timestamp": "[ISO-8601 timestamp]"
  }]
}
```

**Report:** Embed with multiple fields for key-value data, blue color, footer with timestamp.

**Update:** Single embed, green color, concise description. Use emoji for status (checkmark, warning, x).

**Question:** Yellow embed with the question in description. List options in a numbered field.

### Phase 4: Send

Use `Bash` to call the Discord API:

```bash
curl -s -X POST "https://discord.com/api/v10/channels/CHANNEL_ID/messages" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"embeds": [...]}'
```

Steps:
1. Verify `DISCORD_BOT_TOKEN` is set. If not -> stop and tell the user to set it
2. Send the message
3. Check response for a valid message object (has `id` field)
4. Save the message `id` — needed for threading follow-ups

### Phase 5: Confirm

Report to the user:
- "Sent [type] to Discord channel [channel ID]" + message ID
- "Failed: [error message]" + suggested fix

## Error Handling

| Error | Action |
|-------|--------|
| `401 Unauthorized` | Token is wrong. Tell user to check DISCORD_BOT_TOKEN |
| `403 Forbidden` | Bot lacks permissions. Tell user to check bot role in Discord server |
| `404 Not Found` | Channel doesn't exist or bot can't see it. Verify channel ID |
| `429 Too Many Requests` | Rate limited. Wait `retry_after` seconds (from response body), retry once |
| Network error | Retry up to 3 times with 2s, 4s, 8s delays |

## Guardrails

- Do NOT send to multiple channels unless explicitly asked — respect notification fatigue
- Do NOT use @everyone or @here unless the user specifically requests it
- Do NOT send embeds with more than 6 fields for Updates or 10 fields for Reports — consolidate
- If sending a follow-up to a previous message, consider using a thread

## Memory

Store under `comms.discord.<channel>`:
- **L0**: "Last Discord message: [type] to channel [channel ID] at [time]"
- **L1**: Message type, channel ID, message ID, embed color
- **L2**: Full embed JSON payload sent
