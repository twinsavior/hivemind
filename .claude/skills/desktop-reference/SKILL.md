---
name: desktop-reference
description: Desktop Electron app and chat UI -- renderer structure, WebSocket handling, streaming display. Auto-loads when working on desktop/ code.
user-invocable: false
---

# Desktop App (`desktop/`)

Electron app with a vanilla HTML/JS chat UI. No React, no framework.

## Key File
`desktop/renderer/index.html` — ~3700 lines, single file containing HTML + CSS + JS.

## Chat UI Architecture
- Messages stored in `conversations` Map, keyed by `conversationId`
- Each message: `{ role: 'user'|'ai', text, agentId?, timestamp }`
- Running tasks tracked in `runningTasks` Map with `{ buffer, el, lastAgentId }`
- Streaming text rendered via `renderMarkdown()` into a dedicated streaming element

## Agent Transitions
When `task:token` arrives with a different `agentId` than `lastAgentId`:
- Inserts a markdown separator: `---\n**Agent Name** \`Provider\`\n\n`
- Provider badge: Builder/Sentinel show "Codex", others show "Claude"
- Updates `lastAgentId` on the running task

## Attachments
- `pendingAttachments` array holds files selected via drag-drop or file picker
- On task submit: attachments converted to base64 and sent with the message
- On follow-up during active task: attachments sent as `[Attached image: /path]` references
- Preview thumbnails shown below the input bar

## Conversation History
- Last 20 messages sent with each `task:submit` (truncated to 500 chars each)
- Sent as `history` array in the WebSocket message
- Current message excluded from history (it's the `description`)

## Gotchas
1. **It's one massive file.** Use Edit tool for surgical changes, never rewrite large sections.
2. **No build step.** Changes to `index.html` are live on refresh (Electron dev mode).
3. **`scrollToBottom()` must be called** after DOM changes or the chat won't auto-scroll.
4. **Agent name map is duplicated** — exists in both the renderer and server. Keep them in sync.
