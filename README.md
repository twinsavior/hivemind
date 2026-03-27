<div align="center">

```
 ██╗  ██╗██╗██╗   ██╗███████╗███╗   ███╗██╗███╗   ██╗██████╗
 ██║  ██║██║██║   ██║██╔════╝████╗ ████║██║████╗  ██║██╔══██╗
 ███████║██║██║   ██║█████╗  ██╔████╔██║██║██╔██╗ ██║██║  ██║
 ██╔══██║██║╚██╗ ██╔╝██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██║  ██║
 ██║  ██║██║ ╚████╔╝ ███████╗██║ ╚═╝ ██║██║██║ ╚████║██████╔╝
 ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝
```

### AI-Powered Operations Platform for E-Commerce Sellers

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Quick Start](#-quick-start) · [Features](#-features) · [Architecture](#-architecture) · [Configuration](#%EF%B8%8F-configuration)

</div>

---

## What is HIVEMIND?

HIVEMIND is an AI operations platform built for Amazon, Walmart, and eBay arbitrage sellers. It deploys a swarm of specialized AI agents — coordinated by **Nova** — to automate the daily grind of running a reselling business: parsing purchase and shipment emails, tracking profitability across marketplaces, monitoring account health, managing source-to-sale pipeline, and connecting to your bank accounts for real-time financial visibility.

The platform runs locally on your machine via a desktop Electron app or CLI, connects to 30+ LLM providers, and keeps all your data in local SQLite databases. No cloud infrastructure, no subscription data leaving your machine.

**Built for the Buy Box / FlipAlert seller community.**

---

## ✨ Features

### Seller Operations
- **Email automation** — Parses purchase confirmations, shipment tracking, and seller alerts from 15+ retailers (Amazon, Walmart, eBay, Target, Costco, etc.) via Gmail OAuth or IMAP
- **Marketplace APIs** — Connects to Amazon SP-API, Walmart Seller Center, and eBay REST APIs for orders, inventory, FBA shipments, and account health
- **Financial tracking** — SimpleFIN Bridge integration syncs bank/credit card transactions, auto-categorizes spend (sourcing, prep, shipping, fees)
- **Profitability calculator** — Per-item ROI across Amazon, Walmart, and eBay using exact fee lookups (SP-API Product Fees, category-based referral fees)
- **Source-to-sale pipeline** — Tracks items through 8 stages: Purchased → Shipped to Prep → Prepping → Shipped to FBA → Received → Live → Sold → Settled
- **Account health monitoring** — Alerts for suspensions, policy violations, IP complaints, and performance warnings
- **Seller expert skills** — Built-in knowledge bases for Amazon, Walmart, eBay, and A2A arbitrage strategy

### AI Agent Swarm
- **5 specialized agents** + Nova coordinator with autonomous task delegation
- **Multi-provider LLM support** — Anthropic, OpenAI, Google, Ollama, Claude Code, and Codex with fallback chains
- **Trust-based security** — Three-tier trust system (Owner, Trusted, Untrusted) with per-task permissions
- **Hierarchical memory** — SQLite-backed L0/L1/L2 memory model with vector search
- **Cognitive loop** — Each agent runs think/act/observe cycles with confidence scoring
- **Skills system** — Folder-based skills with YAML frontmatter, progressive disclosure, and hot-reload

### Platform
- **Desktop app** — Electron app with chat UI, operations dashboard, and seller views
- **Real-time dashboard** — Express + WebSocket server with live agent status and business data
- **CLI** — Full command-line interface for headless operation
- **Local-first** — All data stays on your machine in SQLite databases

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
│   ├── agents/          # BaseAgent + 5 specialized agents (Scout, Builder, Sentinel, Oracle, Courier)
│   ├── core/
│   │   ├── llm.ts       # Universal LLM adapter (30+ providers)
│   │   ├── orchestrator  # Task queue, agent lifecycle, swarm coordination
│   │   ├── trust.ts      # Owner/Trusted/Untrusted permission system
│   │   └── marketplace/  # Amazon SP-API, Walmart, eBay unified service
│   ├── modules/
│   │   ├── email/        # Gmail/IMAP parsing, 15+ retailer templates, flag engine
│   │   └── finance/      # SimpleFIN integration, pipeline tracking, profitability
│   ├── memory/           # SQLite store, L0/L1/L2 hierarchy, context manager
│   ├── dashboard/        # Express + WebSocket server, API routes
│   ├── cli/              # CLI entry point, commands, onboarding
│   └── skills/           # Skill loader, registry, pack manager
├── desktop/              # Electron app, chat UI, operations views
├── skills/               # Built-in skills (marketplace experts, runbooks, tools)
├── data/                 # SQLite databases (email.db, finance.db, hivemind.db)
└── tests/                # Vitest test suites (489 tests)
```

**Databases:**

| Database | Purpose |
|----------|---------|
| `hivemind.db` | Agent memory, task history, conversation context |
| `email.db` | Processed emails, extracted orders, seller alerts, account connections |
| `finance.db` | Bank accounts, transactions, pipeline batches, prep center profiles |

**API Surface (`/api/`):**

| Endpoint Group | What It Serves |
|---------------|----------------|
| `/api/seller/*` | Marketplace connections, orders, inventory, FBA shipments, account health |
| `/api/email/*` | Email accounts, processing rules, pipeline control, retailer templates |
| `/api/finance/*` | Bank sync, transactions, pipeline CRUD, profitability calculations |
| `/api/tasks/*` | Agent task management, swarm status |
| `/api/ws` | WebSocket for real-time dashboard updates |

---

## ⚡ Quick Start

**Prerequisites:** Node.js >= 20, pnpm (or npm)

```bash
# 1. Clone and install
git clone https://github.com/twinsavior/hivemind.git
cd hivemind
pnpm install

# 2. Set your API keys
cp .env.example .env
# Edit .env with your Anthropic/OpenAI keys

# 3. Initialize
pnpm start -- init

# 4. Start HIVEMIND
pnpm start -- up
# Dashboard at http://localhost:4000
```

### Desktop App

```bash
cd desktop
npm install
npm start
```

The Electron app auto-starts the HIVEMIND server and connects via WebSocket.

---

## ⚙️ Configuration

HIVEMIND uses a layered config model: **CLI args > environment variables > hivemind.yaml > defaults**.

```bash
cp hivemind.example.yaml hivemind.yaml
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API access |
| `OPENAI_API_KEY` | OpenAI API access |
| `GOOGLE_API_KEY` | Google AI API access |
| `SLACK_BOT_TOKEN` | Slack connector |
| `DISCORD_BOT_TOKEN` | Discord connector |
| `DASHBOARD_PASSWORD` | Dashboard basic auth |

### Marketplace Connections

Marketplace API credentials (Amazon SP-API, Walmart, eBay) are configured through the onboarding flow and stored encrypted in `.hivemind/credentials`.

### Email Setup

Email accounts (Gmail OAuth or IMAP) are configured through the desktop app's onboarding wizard or via the API.

---

## 🛠 Development

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev mode (hot-reload via tsx)
pnpm build            # Build TypeScript
pnpm test             # Run tests (489 tests, Vitest)
pnpm typecheck        # Type-check main project

# Email module has its own tsconfig
npx tsc -p tsconfig.email.json --noEmit
```

---

## 🧱 Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript 5.7 (strict mode, ES2022) |
| Runtime | Node.js >= 20 |
| Database | SQLite via better-sqlite3 |
| HTTP Server | Express 4 |
| Real-time | WebSocket (ws) |
| Desktop | Electron 33 |
| Email | Gmail API (googleapis) + IMAP (imapflow) |
| PDF Parsing | pdf-parse |
| CLI | Commander |
| Testing | Vitest |

---

## 📄 License

[MIT](LICENSE)
