<!-- /autoplan restore point: /Users/saul/.gstack/projects/hivemind/main-autoplan-restore-20260325-163256.md -->

# HIVEMIND E-Commerce Seller Gap Analysis

**Objective:** Ensure an Amazon, Walmart, or eBay arbitrage seller from the Buy Box / FlipAlert community can install HIVEMIND and get immediate, tangible value.

**Distribution:** Free tool for ~500-1,000 community members. Desktop Electron app (macOS + Windows).

**Persona:** Arbitrage sellers doing $1K-$200K/month across Amazon, Walmart, eBay. Some outliers at $10-25M/year. Most are solo operators without VAs. They buy products from retail/online sources at a discount and resell on marketplaces. They want to focus on sourcing — not backend operations.

**What arbitrage sellers care about (ranked):**
1. **Sourcing & buy lists** — What to buy, where to buy it, is it profitable?
2. **Financial tracking** — Credit card limits, spending capacity, ROI per purchase
3. **Inventory pipeline** — Bought → Shipped to prep → Prepped → Shipped to FBA → Live → Sold
4. **Shipment/delivery tracking** — Was it shipped? Was it delivered? Proof of delivery?
5. **Account health** — Suspensions, policy violations, appeals, IP complaints
6. **Prep center management** — Coordinating with prep services, tracking what's where
7. **Alerts & proactive monitoring** — Surface problems before they become crises
8. **Forecasting** — What's going to sell, when to reorder, seasonal trends

---

## Current State: What Already Exists

### Onboarding (Built — 9 steps)
- Welcome → Identity (role selection: Private Label, Wholesale, **Arbitrage**, Dropship, Brand Owner, New Seller; revenue tier; work style) → Co-founder AI setup → Connect Claude/Codex → Marketplace Connect (informational) → Email Setup (Gmail/IMAP) → Email Rules (retailer selection) → Skill Packs → Launch
- Settings page has full guided marketplace connection with step-by-step OAuth for Amazon/Walmart/eBay

### Marketplace API Clients (Built — 12 endpoints)
- **Amazon SP-API** — Orders, inventory, FBA shipments, account health notifications
- **Walmart Marketplace API** — Orders, inventory, listings, WFS
- **eBay REST API** — Inventory items, orders/fulfillment
- **Server endpoints:** `/api/seller/status`, `/api/seller/connect/*`, `/api/seller/orders`, `/api/seller/inventory`, `/api/seller/fba/shipments`, `/api/seller/health`, `/api/seller/briefing`

### Email Processing (Built — 170+ tests)
- Gmail & IMAP support (multi-account)
- Amazon/Walmart/eBay seller alert detection (15 categories)
- Purchase order extraction from 15+ retailers
- Shipment tracking, delivery photo extraction
- SQLite database with orders, seller_alerts, processed_emails tables

### Dashboard & UI (Built — 7 sidebar views)
- Chat, Dashboard, Purchases & Shipments, Alerts, Skills, Knowledge, Settings
- Dashboard shows KPI cards + recent alerts + email pipeline status
- Purchases view: search, filter by retailer, pagination
- Shipments view: stage filters (Ordered, Shipped, Delivered)
- Alerts view: seller alerts with acknowledge functionality

### Knowledge Skills (Built)
- Amazon Seller Expert (14 knowledge areas)
- Walmart Seller Expert (14 knowledge areas)

### Infrastructure (Built)
- Multi-agent swarm (Scout, Builder, Sentinel, Oracle, Courier) + Nova coordinator
- Desktop Electron app with chat UI (~5000 line vanilla JS renderer)
- Express + WebSocket dashboard server at port 4000
- Hierarchical memory (SQLite + vector search, L0/L1/L2)
- LLM provider adapters (Anthropic, OpenAI, Google, Ollama, Claude Code, Codex)

---

## Gap Analysis: What's Missing for Arbitrage Seller Value

### GAP 1: Onboarding Polish — Connect Marketplaces Inline + First Data Pull
**Status: 80% built.** Onboarding exists and is well-designed. Marketplace connection deferred to Settings.
**Remaining work:**
- Move marketplace OAuth into onboarding (or at least offer it as optional inline step)
- After connecting, immediately pull and display recent orders/inventory ("Here's your data!")
- After onboarding, land on Dashboard with real data instead of Chat view
- Add prep center question ("Do you use a prep center?") for arb sellers
- Tailor post-onboarding experience by role (arb sellers see pipeline view, PL sellers see different)

### GAP 2: No Source-to-Sale Pipeline Tracker
**Status: 0% built.** This is THE core workflow for arbitrage sellers.
**The lifecycle:** Purchased → Shipped to Prep → Prepped → Shipped to FBA/WFS → Received at Warehouse → Live for Sale → Sold → Paid Out
**What's needed:**
- Purchase log (manual entry or auto-populated from email extraction)
- Status tracking per batch/shipment through each stage
- Integration with prep center workflows
- Inbound shipment tracking to FBA/WFS (link to existing FBA shipment API)
- Cost basis attached to every unit (carried through pipeline)
- Connection to marketplace orders (when a unit sells, link back to source purchase)

### GAP 3: No Financial / Spending Tracking — USE SIMPLEFIN BRIDGE
**Status: 0% built.**
**Solution: Integrate SimpleFIN Bridge (beta-bridge.simplefin.org)** for automated bank/credit card data.

**SimpleFIN Bridge Overview:**
- $1.50/month or $15/year per user
- Connects up to 25 financial institutions
- REST API with JSON responses
- Returns: account balances, available balances, transactions (amount, description, date, pending status)
- Auth flow: User gets Setup Token → app exchanges for Access URL → Basic Auth for all requests
- Rate limit: 24 requests/day, 90-day transaction history window
- Protocol: https://www.simplefin.org/protocol.html

**Integration plan:**
1. **Onboarding step:** "Connect your bank accounts to track spending" → redirect to SimpleFIN setup token page
2. **Token exchange:** User pastes Setup Token → HIVEMIND calls `POST /claim/:token` → stores Access URL (encrypted)
3. **Daily sync:** Fetch `/accounts` once daily → update balances and transactions
4. **Dashboard cards:** Show per-card: name, balance, available credit, recent transactions
5. **Spending capacity:** Sum available credit across all cards = "You can spend $X today"
6. **Transaction categorization:** Auto-tag transactions as "sourcing" (purchases from known retailers), "prep" (prep center charges), "shipping" (carrier charges), "marketplace fees" (Amazon/Walmart/eBay fees), "other"
7. **ROI tracking:** Match sourcing transactions to pipeline batches → calculate actual ROI when items sell

**Data model (from SimpleFIN Protocol):**
```
Account: { id, name, currency, balance, available-balance, balance-date, transactions[] }
Transaction: { id, posted, amount, description, pending, transacted_at }
```

**What this enables:**
- "How much can I spend?" → instant answer from real card balances
- "What did I spend this week on sourcing?" → auto-categorized transactions
- "What's my cash flow this month?" → income (marketplace payouts) vs expenses (sourcing + fees)
- Employee card tracking → if employee cards are on same account, visible automatically

### GAP 4: Dashboard Needs Seller Business Data
**Status: 60% built.** Dashboard has KPI cards and alerts. Missing marketplace business data.
**What's missing — the daily summary view:**
- Revenue today/this week (from `/api/seller/orders` — endpoint exists, UI doesn't call it)
- Inventory at a glance (from `/api/seller/inventory` — endpoint exists, UI doesn't call it)
- Account health status (from `/api/seller/health` — endpoint exists, UI doesn't call it)
- Financial snapshot (from SimpleFIN — available credit, recent spend)
- Active shipments (from `/api/seller/fba/shipments` + email tracking data)
- Action items list ("3 returns, 1 health warning, 2 shipments delivered" — from combined data)
- The daily briefing endpoint (`/api/seller/briefing`) already aggregates most of this — dashboard just needs to call it

### GAP 5: Proactive Alerts Need Dashboard Integration
**Status: 40% built.** Email alert detection works + Alerts view shows them. API health endpoint exists.
**What's missing:**
- Dashboard KPI cards should show alert counts with severity colors
- Combine email-detected alerts with API-fetched health alerts in one view
- Push notifications (system-level macOS/Windows notifications for critical alerts)
- Prioritized "action items" list on Dashboard (not just Alerts page)

### GAP 6: No Account Health & Appeals Assistant
**Status: 10% built.** API fetches health data. Knowledge skills have policy info.
**What's needed:**
- Account health score visualization per marketplace (green/yellow/red)
- When alert detected → automatically draft appeal using AI + Amazon Seller Expert skill
- Plan of Action (POA) templates for common issues (IP complaints, authenticity, safety)
- A-to-Z claim response helper
- "What's wrong and what do I do?" one-click diagnostic (reads health data + recent alerts → AI analysis)

### GAP 7: No Natural Language Queries for Seller Data
**Status: 0% built.** Marketplace data not in agent context.
**What's needed:**
- Inject daily briefing summary into agent system prompt (or L0 memory)
- Inject financial summary (SimpleFIN balances) into agent context
- Seller can ask in chat: "How are my sales?", "What's my account health?", "How much can I spend?", "Help me write an appeal", "What do I need to deal with today?"
- Agent responds with real data, not generic advice

### GAP 8: No Prep Center Management
**Status: 0% built.**
**What's needed:**
- Prep center profiles (name, contact, address, pricing)
- Inbound tracking (what was sent to prep — linked to purchase batches)
- Status tracking (received, processing, labeled, ready to ship)
- Outbound tracking (what was shipped to FBA/WFS)
- Cost per unit for prep services
- Dashboard card: "X units at prep center, Y ready to ship"

### GAP 9: No Buy List / Sourcing Assistance
**Status: 0% built.** Scoped to profitability calculator only (not full sourcing platform).
**What's needed (Phase C only):**
- Profitability calculator: sale price - cost - FBA fees - referral fee - prep cost = profit (and ROI %)
- FBA fee estimation (based on size/weight tier)
- Save items to a buy list for later purchasing
- Future: Keepa/price history integration, restriction checker, hazmat flags

### GAP 10: Missing eBay Seller Expert Skill
**Status: 0% built.** Amazon + Walmart expert skills exist.
**Fix:** Create `ebay-seller-expert` skill with equivalent 14 knowledge areas.

### GAP 11: Shipment Tracking Hub Needs Unification
**Status: 50% built.** Email extracts tracking. Shipments view has stage filters.
**What's missing:**
- FBA inbound shipments (from API) not shown alongside email-tracked shipments
- No carrier tracking integration (link to UPS/FedEx/USPS tracking pages)
- No FBA inbound reconciliation view (sent vs received quantities)
- No unified source→prep→FBA pipeline view

### GAP 12: Employee/VA Card Management
**Status: 0% built.** Deferred to Phase D.
**Note:** SimpleFIN integration partially addresses this — if employee cards are on the same bank account, their transactions show up automatically. Additional employee profile/assignment features can be layered on later.

---

## Revised Priority Matrix

| Gap | Status | Impact | Effort (CC) | Priority |
|-----|--------|--------|-------------|----------|
| GAP 4: Dashboard business data | 60% built | Critical — daily value | ~45 min | P0 |
| GAP 7: NL Queries for seller data | 0% | Critical — accessibility | ~30 min | P0 |
| GAP 5: Alert dashboard integration | 40% built | High — saves time daily | ~30 min | P0 |
| GAP 1: Onboarding polish | 80% built | Medium — first impression | ~30 min | P0 |
| GAP 3: Financial tracking (SimpleFIN) | 0% | High — buying decisions | ~1.5 hours | P1 |
| GAP 6: Account health assistant | 10% | High — existential threat | ~1 hour | P1 |
| GAP 2: Source-to-sale pipeline | 0% | High — core workflow | ~2 hours | P1 |
| GAP 11: Shipment hub unification | 50% built | Medium — operational | ~30 min | P2 |
| GAP 8: Prep center mgmt | 0% | Medium — many sellers need | ~1 hour | P2 |
| GAP 9: Profitability calculator | 0% | Medium — sourcing help | ~45 min | P2 |
| GAP 10: eBay expert skill | 0% | Low — fewer eBay arb sellers | ~30 min | P3 |
| GAP 12: Employee card mgmt | 0% (partial via SimpleFIN) | Low — minority of sellers | ~45 min | P3 |

---

## Implementation Plan

### Phase A: "First 5 Minutes" (P0) — Wire existing data to dashboard
Most of the APIs and data already exist. Phase A is about CONNECTING them to the UI.
1. **Dashboard business summary** — Call `/api/seller/briefing` + email alert data → render KPI cards (revenue, orders, inventory, health, actions)
2. **NL queries** — Inject daily briefing into agent context so chat can answer seller questions
3. **Alert integration** — Combine email alerts + API health alerts → show on dashboard with severity badges
4. **Onboarding polish** — Land on Dashboard after onboarding; offer marketplace connection inline
5. **Windows build** — Configure electron-builder for `.exe` packaging

### Phase B: "Daily Operations" (P1) — New capabilities
1. **SimpleFIN integration** — Setup token flow, daily sync, balance/transaction display, spending capacity calculator
2. **Account health assistant** — Health score visualization + AI-powered appeal drafting using Amazon/Walmart expert skills
3. **Source-to-sale pipeline** — New DB tables, status tracking, cost basis, link to marketplace orders
4. **Daily briefing agent** — Auto-generate morning summary (triggered by Sentinel agent on schedule)

### Phase C: "Operational Efficiency" (P2) — Power features
1. **Shipment hub** — Unify email tracking + FBA API shipments + carrier links
2. **Prep center management** — Profiles, inbound/outbound tracking, status pipeline
3. **Profitability calculator** — FBA fee estimation, ROI per item, buy list management

### Phase D: "Polish" (P3) — Complete coverage
1. **eBay seller expert skill** — 14 knowledge areas matching Amazon/Walmart skills
2. **Employee card management** — Profiles, card assignment, spending limits (layer on SimpleFIN data)

---

## SimpleFIN Integration Architecture

```
User clicks "Connect Bank Accounts"
         ↓
Opens beta-bridge.simplefin.org/simplefin/create in browser
         ↓
User creates account ($1.50/mo) → gets Setup Token
         ↓
Pastes Setup Token into HIVEMIND
         ↓
HIVEMIND decodes base64 → POST to claim URL → receives Access URL
         ↓
Access URL stored encrypted in .hivemind/credentials (same pattern as marketplace creds)
         ↓
Daily cron: GET /accounts?version=2 → parse accounts + transactions
         ↓
Store in SQLite: simplefin_accounts, simplefin_transactions tables
         ↓
Dashboard cards: balance, available credit, recent spend
Agent context: financial summary injected for NL queries
```

**New DB tables needed (in email.db or separate finance.db):**
```sql
CREATE TABLE simplefin_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT,
  currency TEXT DEFAULT 'USD',
  balance REAL,
  available_balance REAL,
  balance_date TEXT,
  account_type TEXT, -- credit_card, checking, savings, custom label
  last_synced TEXT,
  access_url_encrypted TEXT
);

CREATE TABLE simplefin_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES simplefin_accounts(id),
  posted TEXT,
  amount REAL,
  description TEXT,
  pending INTEGER DEFAULT 0,
  category TEXT, -- sourcing, prep, shipping, marketplace_fees, payout, other
  linked_batch_id INTEGER, -- FK to pipeline batches
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## Decision Audit Trail

| # | Phase | Decision | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|
| 1 | CEO-0A | Reframe persona from generic seller to arbitrage seller | P1 (Completeness) | User clarified: community is 500-1K arbitrage sellers buying from retail/online sources | Generic "marketplace seller" persona |
| 2 | CEO-0A | Add source-to-sale pipeline as GAP 2 (new) | P1 (Completeness) | This is THE core workflow for arb sellers and has zero support in HIVEMIND | Treating arb sellers like private label sellers |
| 3 | CEO-0A | Add financial/credit card tracking as GAP 3 (new) | P1 (Completeness) | Sellers need to know spending capacity for buying decisions | Assuming sellers track this elsewhere |
| 4 | CEO-0A | Add prep center management as GAP 8 (new) | P2 (Boil lakes) | Many arb sellers use prep centers; tracking is in blast radius | Deferring prep center support entirely |
| 5 | CEO-0A | Add buy list / sourcing as GAP 9 (new) | P2 (Boil lakes) | Highest value-add for sellers but highest complexity | Building full Jungle Scout competitor |
| 6 | CEO-0A | Add employee card mgmt as GAP 12 (new) | P3 (Pragmatic) | Only subset of sellers need this; defer to Phase D | Building it in Phase A |
| 7 | CEO-0A | Mode: SELECTIVE EXPANSION — hold e-commerce scope, expand for arb-specific needs | P1+P2 | User context revealed arb-specific needs beyond generic e-commerce | HOLD SCOPE / SCOPE EXPANSION |
| 8 | CEO-1 | Scope GAP 9 to profitability calculator only | P5 (Explicit) | Full sourcing assistant is an ocean; profitability calc is a lake | Building full Keepa/Jungle Scout competitor |
| 9 | CEO-4 | Accept accounting/sourcing boundaries | P3 (Pragmatic) | HIVEMIND is ops layer; integrate with, don't replace, external tools | Building full accounting platform |
| 10 | CEO-6 | Defer multi-user/team support to future | P6 (Action) | Initial release targets solo sellers (majority of community) | Building team features now |
| 11 | CEO-7 | Accept desktop renderer complexity as tech debt | P6 (Action) | Shipping seller features more important than refactoring UI framework | Pausing to refactor to React |
| 12 | Design-1 | Restructure nav to match seller mental model | P5 (Explicit) | Sellers think Orders/Inventory/Finances, not Operations/Purchases | Keeping current email-centric nav |
| 13 | Design-2 | Add summary cards with trend comparisons | P1 (Completeness) | Raw numbers without context aren't actionable | Showing flat number tables |
| 14 | Design-4 | Onboarding lands on Dashboard, not Chat | P1 (Completeness) | Sellers want to SEE data, not chat on first interaction | Landing on Chat after onboarding |
| 15 | Design-6 | Defer mobile/responsive entirely | P6 (Action) | User confirmed desktop-only. Electron for macOS + Windows. | Building mobile/PWA |
| 16 | Design-7 | Add basic keyboard nav + ARIA labels | P2 (Boil lakes) | In blast radius and minimal effort | Skipping accessibility entirely |
| 17 | Eng-4 | Add 15-min API response cache | P3 (Pragmatic) | Avoid redundant marketplace calls when navigating dashboard | No caching |
| 18 | Eng-2 | No DRY refactoring of parallel fetch pattern | P5 (Explicit) | 3 uses is clear enough; abstraction adds complexity | Extracting shared parallel-fetch helper |
| 19 | Eng-3 | 6 new test suites needed (written to disk) | P1 (Completeness) | Zero test coverage for all new features | Deferring tests to later phase |
| 20 | Gate | Desktop Electron app is the delivery vehicle (macOS + Windows) | P5 (Explicit) | User confirmed: no web app. Electron for macOS primary, Windows build needed | Building a web dashboard or PWA |
| 21 | Gate | Add Windows Electron packaging to Phase A | P1 (Completeness) | Community has Windows users; Electron supports both from same codebase | macOS-only for initial release |
| 22 | Rev-2 | Use SimpleFIN Bridge for financial data instead of manual entry | P1 (Completeness) | Automated bank/CC data is dramatically better UX than manual balance entry | Manual credit card balance entry |
| 23 | Rev-2 | SimpleFIN moves from P1 to P1 (stays) but unblocks employee card tracking | P3 (Pragmatic) | SimpleFIN surfaces all cards on an account including employee cards automatically | Building separate employee card tracking first |
| 24 | Rev-2 | Transaction auto-categorization (sourcing, prep, shipping, fees) | P1 (Completeness) | Raw transactions aren't useful; sellers need to see spend by category | Showing uncategorized transaction list |
| 25 | Rev-2 | Corrected GAP 1 status from 0% to 80% built | P5 (Explicit) | 9-step onboarding already exists with role selection and marketplace info | Claiming onboarding doesn't exist |
| 26 | Rev-2 | Corrected GAP 4 status from 0% to 60% built | P5 (Explicit) | Dashboard/Purchases/Shipments/Alerts views exist; missing marketplace API data | Claiming dashboard doesn't exist |
| 27 | Rev-2 | Phase A reframed as "wire existing data" not "build from scratch" | P3 (Pragmatic) | Most APIs + UI shells exist. Phase A is connecting them, not creating them. | Starting from zero |
