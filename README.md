<div align="center">

```
 ██╗  ██╗██╗██╗   ██╗███████╗███╗   ███╗██╗███╗   ██╗██████╗
 ██║  ██║██║██║   ██║██╔════╝████╗ ████║██║████╗  ██║██╔══██╗
 ███████║██║██║   ██║█████╗  ██╔████╔██║██║██╔██╗ ██║██║  ██║
 ██╔══██║██║╚██╗ ██╔╝██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██║  ██║
 ██║  ██║██║ ╚████╔╝ ███████╗██║ ╚═╝ ██║██║██║ ╚████║██████╔╝
 ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝
```

### Your AI co-founder for Amazon, Walmart & eBay selling

[![Download for Mac](https://img.shields.io/badge/Download_for_Mac-.dmg-0078D4?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/twinsavior/hivemind/releases/download/v1.0.0-beta.14/HIVEMIND-1.0.0-beta.14-arm64.dmg)
[![Download for Windows](https://img.shields.io/badge/Download_for_Windows-.exe-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/twinsavior/hivemind/releases/download/v1.0.0-beta.14/HIVEMIND-Setup-1.0.0-beta.14.exe)

[![version](https://img.shields.io/badge/version-v1.0.0--beta.14-blue)](https://github.com/twinsavior/hivemind/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/twinsavior/hivemind/ci.yml?branch=main&label=build)](https://github.com/twinsavior/hivemind/actions)
[![Tests](https://img.shields.io/badge/tests-621_passing-brightgreen)](https://github.com/twinsavior/hivemind)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/twinsavior/hivemind)](https://github.com/twinsavior/hivemind/stargazers)
[![Downloads](https://img.shields.io/github/downloads/twinsavior/hivemind/total)](https://github.com/twinsavior/hivemind/releases)

</div>

---

## Get Started

### 1. Install Node.js (one-time)

HIVEMIND needs [Node.js](https://nodejs.org/) to run. Download the installer — no terminal needed:

👉 **[Download Node.js](https://nodejs.org/)** (click the big green button, run the installer)

> Already have it? You're good. HIVEMIND will tell you if it's missing.

### 2. Download HIVEMIND

- **Mac**: [Download the .dmg](https://github.com/twinsavior/hivemind/releases/download/v1.0.0-beta.14/HIVEMIND-1.0.0-beta.14-arm64.dmg) → open it → drag HIVEMIND to Applications
  - First launch: right-click the app → Open (macOS requires this for unsigned apps)
- **Windows**: [Download the .exe](https://github.com/twinsavior/hivemind/releases/download/v1.0.0-beta.14/HIVEMIND-Setup-1.0.0-beta.14.exe) → run it → done

### 3. Launch and Go

Open HIVEMIND. The onboarding wizard walks you through everything — your name, your AI co-founder's personality, and connecting your seller accounts. That's it. No terminal, no commands.

> **Stuck on "Starting your swarm"?** Install Node.js from the link above and restart the app.

---

### Run from Source (for developers)

```bash
git clone https://github.com/twinsavior/hivemind.git
cd hivemind
pnpm install        # requires pnpm 10+ (npm install -g pnpm)
pnpm build
cd desktop && npm install && npm start
```

> **Build tools needed:** macOS: `xcode-select --install` · Linux: `apt install build-essential python3` · Windows: Visual Studio Build Tools

---

## What is HIVEMIND?

HIVEMIND is a desktop app that gives you an AI-powered team for your reselling business. It runs a swarm of 6 specialized agents — led by **Nova**, your AI co-founder — that handle the daily grind: parsing purchase emails, tracking profitability, monitoring account health, and managing your source-to-sale pipeline.

Everything runs locally on your machine. Your data never leaves your computer. No cloud, no subscription fees for the platform itself.

**Built for the Buy Box / FlipAlert seller community.**

---

## ✨ Features

### Seller Operations
- **Email automation** — Parses purchase confirmations, shipment tracking, and seller alerts from 15+ retailers (Amazon, Walmart, eBay, Target, Costco, etc.) via Gmail OAuth or IMAP. Multi-account support with validated connections and encrypted credential storage
- **Marketplace APIs** — Connects to Amazon SP-API, Walmart Seller Center, and eBay REST APIs for orders, inventory, FBA shipments, and account health
- **Financial tracking** — SimpleFIN Bridge integration syncs bank/credit card transactions, auto-categorizes spend (sourcing, prep, shipping, fees)
- **Profitability calculator** — Per-item ROI across Amazon, Walmart, and eBay using exact fee lookups
- **Source-to-sale pipeline** — Tracks items through 8 stages: Purchased → Shipped to Prep → Prepping → Shipped to FBA → Received → Live → Sold → Settled
- **Account health monitoring** — Alerts for suspensions, policy violations, IP complaints, and performance warnings

### AI Agent Swarm
- **5 specialized agents** + Nova coordinator with autonomous task delegation
- **Claude Code** — powered by Anthropic's Claude, the best coding & reasoning model
- **Trust-based security** — Owner, Trusted, and Untrusted tiers with per-task permissions
- **Hierarchical memory** — Persistent context across conversations (L0/L1/L2)
- **Skills system** — Extensible skills with hot-reload

### Platform
- **Desktop app** — Native Electron app with chat UI and operations dashboard
- **Discord integration** — Connect HIVEMIND to your Discord server for bidirectional messaging
- **Local-first** — All data stays on your machine in SQLite databases
- **Open source** — MIT licensed, community-driven

---

## 🐝 The Agent Roster

| Agent | Role | What It Does |
|-------|------|-------------|
| 🌐 **Nova** | Coordinator | Orchestrates the swarm. Breaks seller tasks into subtasks, delegates to specialists, synthesizes results. |
| 🔍 **Scout** | Reconnaissance | Searches deals, monitors prices, gathers market intelligence. Multimodal (images, documents). |
| 🔨 **Builder** | Construction | Writes code, generates reports, creates listings. CI/CD pipeline tracking. |
| 🛡 **Sentinel** | Protection | Monitors account health, validates outputs, runs security audits. Alert severity tracking. |
| 🔮 **Oracle** | Analysis | Profitability analysis, trend detection, forecasting. ROI calculations with confidence intervals. |
| 📬 **Courier** | Delivery | Routes messages via Slack, Discord, Telegram, and webhooks. Priority-based delivery. |

---

## 🏗 Architecture

```
HIVEMIND
├── src/
│   ├── agents/          # BaseAgent + 5 specialized agents
│   ├── core/
│   │   ├── llm.ts       # Universal LLM adapter
│   │   ├── orchestrator  # Task queue, agent lifecycle, swarm coordination
│   │   ├── trust.ts      # Owner/Trusted/Untrusted permission system
│   │   └── marketplace/  # Amazon SP-API, Walmart, eBay unified service
│   ├── modules/
│   │   ├── email/        # Gmail/IMAP parsing, 15+ retailer templates
│   │   ├── discord/      # Discord setup wizard + config writer
│   │   └── finance/      # SimpleFIN integration, pipeline tracking
│   ├── connectors/       # Discord, Slack, Telegram, Webhook connectors
│   ├── memory/           # SQLite store, L0/L1/L2 hierarchy, context manager
│   ├── dashboard/        # Express + WebSocket server, API routes
│   └── cli/              # CLI entry point, commands, onboarding
├── desktop/              # Electron app, chat UI, operations views
├── skills/               # Built-in skills (marketplace experts, runbooks, tools)
└── tests/                # Vitest test suites (613 tests)
```

**Databases:**

| Database | Purpose |
|----------|---------|
| `hivemind.db` | Agent memory, task history, conversation context |
| `email.db` | Processed emails, extracted orders, seller alerts |
| `finance.db` | Bank accounts, transactions, pipeline batches |

---

---

## ⚙️ Configuration

HIVEMIND uses a layered config model: **CLI args > environment variables > hivemind.yaml > defaults**.

### Marketplace Connections

Marketplace API credentials (Amazon SP-API, Walmart, eBay) are configured through the onboarding flow in the desktop app and stored encrypted locally.

### Email Setup

Email accounts (Gmail OAuth or IMAP) are configured through the desktop app's Settings > Email section.

### Discord

Connect HIVEMIND to your Discord server through Settings > Connectors. The setup wizard walks you through creating a bot and linking it.

---

## 🛠 Development

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev mode (hot-reload via tsx)
pnpm build            # Build TypeScript
pnpm test             # Run tests (613 tests, Vitest)
pnpm typecheck        # Type-check
```

---

## 🧱 Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript 5.7 (strict mode, ES2022) |
| Runtime | Node.js 22 |
| Database | SQLite via better-sqlite3 |
| HTTP Server | Express 4 |
| Real-time | WebSocket (ws) |
| Desktop | Electron 35 |
| Email | Gmail API + IMAP |
| Testing | Vitest |

---

## 📄 License

[MIT](LICENSE)

---

<div align="center">

**If HIVEMIND helps your selling business, [⭐ star this repo](https://github.com/twinsavior/hivemind) — it helps other sellers find it.**

</div>
