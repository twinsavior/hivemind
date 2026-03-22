---
name: slack-notify
version: 2.0.0
agent: communicator
description: "Send formatted notifications, alerts, and reports to Slack channels via the Web API"
triggers: ["notify slack", "send to slack", "slack message", "post to slack", "alert the team", "send a slack alert", "message the channel", "slack update", "notify the team"]
dependencies: []
requiredSecrets: ["SLACK_BOT_TOKEN"]
timeout: 30
tags: ["slack", "notification", "messaging", "alerting"]
author: hivemind-core
---

# Slack Notification

Send rich notifications to Slack channels. Classify the message type, format with Block Kit, deliver, confirm.

## Process

### Phase 1: Classify the Message

Determine type from context:

| Type | When | Format |
|------|------|--------|
| **Alert** | Something needs immediate attention | Red sidebar, action items, mention @here |
| **Report** | Summary of completed work | Sections with headers, data in fields |
| **Update** | Status change or progress | Single block, concise, with link |
| **Question** | Needs team input | Clear question, numbered options, mention relevant people |

### Phase 2: Resolve the Channel

1. If the user specifies a channel → use it
2. If `config.slack.channels` exists in memory → use the mapping (alerts → #alerts, reports → #general, etc.)
3. If neither → ask the user: "Which Slack channel should I send this to?"

Do NOT guess the channel. Wrong channel = noise for the wrong people.

### Phase 3: Compose the Message

Use Slack Block Kit JSON. Here's the template for each type:

**Alert:**
```json
{
  "blocks": [
    {"type": "header", "text": {"type": "plain_text", "text": "🚨 [Alert Title]"}},
    {"type": "section", "text": {"type": "mrkdwn", "text": "[What happened and what to do about it]"}},
    {"type": "section", "fields": [
      {"type": "mrkdwn", "text": "*Severity:*\n[High/Medium/Low]"},
      {"type": "mrkdwn", "text": "*Source:*\n[What triggered this]"}
    ]}
  ]
}
```

**Report:** Header block → section blocks with fields for key-value data → dividers between sections → context block with timestamp.

**Update:** Single section block with mrkdwn. Include a link. Use emoji for status (✅ ⚠️ ❌).

### Phase 4: Send

Use `Bash` to call the Slack API:

```bash
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "CHANNEL_ID", "blocks": [...]}'
```

Steps:
1. Verify `SLACK_BOT_TOKEN` is set. If not → stop and tell the user to set it
2. Resolve channel name to ID: `curl -s https://slack.com/api/conversations.list -H "Authorization: Bearer $SLACK_BOT_TOKEN"` — cache the result
3. Send the message
4. Check response for `"ok": true`
5. Save the `ts` value from the response — needed for threading follow-ups

### Phase 5: Confirm

Report to the user:
- ✅ "Sent [type] to #[channel]" + link to message if available
- ❌ "Failed: [error message]" + suggested fix

## Error Handling

| Error | Action |
|-------|--------|
| `invalid_auth` | Token is wrong. Tell user to check SLACK_BOT_TOKEN |
| `channel_not_found` | Ask user to verify channel name. List available channels if possible |
| `ratelimited` | Wait `retry_after` seconds (from response header), retry once |
| `not_in_channel` | Bot needs to be invited. Tell user: "Add the bot to #channel first" |
| Network error | Retry up to 3 times with 2s, 4s, 8s delays |

## Guardrails

- Do NOT send to multiple channels unless explicitly asked — respect notification fatigue
- Do NOT @mention individuals unless the user specifically requests it
- Do NOT send messages longer than 3 blocks for Updates or 6 blocks for Reports — consolidate
- If sending a follow-up to a previous message, use threading (pass `thread_ts`)

## Memory

Store under `comms.slack.<channel>`:
- **L0**: "Last Slack message: [type] to #[channel] at [time]"
- **L1**: Message type, channel, timestamp, thread_ts for follow-ups
- **L2**: Full Block Kit payload sent
