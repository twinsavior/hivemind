---
name: desktop-reference
description: Desktop Electron app and chat UI -- renderer structure, WebSocket handling, streaming display, async startup. Auto-loads when working on desktop/ code.
user-invocable: false
---

# Desktop App (`desktop/`)

Electron 35 app with a vanilla HTML/JS chat UI. No React, no framework.

## Key Files
- `desktop/main.js` — Electron main process (~690 lines). Fully async startup.
- `desktop/renderer/index.html` — ~5000 lines, single file containing HTML + CSS + JS.
- `desktop/package.json` — Electron 35, electron-builder 26, electron-updater.

## Startup Flow (main.js)
1. `app.whenReady()` → `createWindow()` → `startHivemindServer()`
2. `findNode()` — async, checks nvm/fnm/homebrew/system paths via `fs.promises`
3. `setupPackagedEnvironment()` — async, creates `~/.hivemind/` dirs and default config
4. Spawns the server process, waits for health check
5. `loadFile('renderer/index.html', { query: { port } })` — passes port via query param
6. Auto-updater checks GitHub Releases on launch + every 4h

## Port Handling
- `HIVEMIND_PORT = Number(process.env.HIVEMIND_DASHBOARD_PORT) || 4000`
- Passed to renderer via `loadFile` query param `?port=...`
- Renderer reads with `new URLSearchParams(window.location.search).get('port')`

## Chat UI Architecture
- Messages stored in `conversations` Map, keyed by `conversationId`
- Each message: `{ role: 'user'|'ai', text, agentId?, timestamp }`
- Running tasks tracked in `runningTasks` Map with `{ buffer, el, lastAgentId }`
- Streaming text rendered via `renderMarkdown()` into a dedicated streaming element

## Settings Persistence
- Settings page fetches `GET /api/config` on load to hydrate field values
- Save button sends `POST /api/config` with `{ sections: [...] }` payload

## Agent Transitions
When `task:token` arrives with a different `agentId` than `lastAgentId`:
- Inserts a markdown separator: `---\n**Agent Name** \`Provider\`\n\n`
- Provider badge: Builder/Sentinel show "Codex", others show "Claude"
- Updates `lastAgentId` on the running task
- Agent names come from the dynamic profile (`profile.agents[agentId].name`), not hardcoded. Keep the renderer's `agentMeta` map in sync with `applyProfile()`.

## Grounding Chips
On `task:complete`, if `msg.grounding` is present:
- Renders a `.grounding-bar` below the sender name with colored chips:
  - Green (`.seller-data`): "📊 Live {marketplace} data"
  - Yellow (`.seller-degraded`): "⚠️ Partial seller data"
  - Indigo (`.skill`): "📖 {skill-name}" for each loaded skill
  - Amber (`.memory`): "🧠 Memory ({N})" when memory entries were used
  - Gray (`.general`): "💡 General guidance" when no data sources present
- Grounding saved to conversation history for restore on page reload

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
5. **All main.js I/O is async.** `findNode()`, `setupPackagedEnvironment()`, `showErrorDialog()` all use `fs.promises`. Never add sync FS calls back.
6. **Port must come from query param in file:// mode.** The renderer can't detect the server port from `window.location` when loaded via `file://`.
