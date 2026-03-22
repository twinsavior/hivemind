---
name: trend-analysis
version: 2.0.0
agent: analyst
description: "Detect trends, anomalies, and patterns in data — time-series or categorical — and produce actionable forecasts"
triggers: ["analyze trends", "trend analysis", "what's trending", "predict", "forecast this", "spot patterns", "data trends", "is this growing", "show me the trend", "analyze this data"]
dependencies: []
requiredSecrets: []
timeout: 300
tags: ["analytics", "trends", "prediction", "data", "forecasting"]
author: hivemind-core
---

# Trend Analysis

Identify trends, anomalies, and patterns in data. Produce actionable forecasts with explicit confidence levels.

## Process

### Phase 1: Ingest Data

Accept data from:
- **File** — use `Read` to load CSV, JSON, or TSV files
- **API** — use `WebFetch` to pull from endpoints
- **Memory** — load historical data from memory store
- **Inline** — data pasted in the user's message

Normalize to this shape:
```typescript
{ timestamp: string; dimensions: string[]; metrics: Record<string, number> }
```

If the data is messy (missing headers, mixed formats), clean it first using `Bash` with standard Unix tools. State every assumption made during cleaning.

### Phase 2: Characterize

Before analyzing, describe the data:

1. **Row count** and **time range** (first date → last date)
2. **Granularity** — hourly, daily, weekly, monthly?
3. **Missing values** — count per column. If > 10% missing, warn the user
4. **Distribution** — min, max, mean, median, stddev for each metric
5. **Outliers** — values beyond 2 standard deviations. List them

Output this as a table. Do NOT skip this step — the user needs to trust the data before trusting the analysis.

### Phase 3: Detect Trends

**Time-series data:**
1. Calculate 7-period and 30-period moving averages
2. Compute period-over-period % change
3. Check for seasonality — do values repeat at regular intervals?
4. Find breakpoints — where does the trend direction change?
5. Measure acceleration — is the rate of change increasing or decreasing?

**Categorical data:**
1. Rank categories by count
2. Calculate growth rate per category
3. Identify share shifts — which categories are gaining/losing?

Use `Bash` to run calculations. For complex analysis, write a quick Python or Node script, execute it, and include the output.

### Phase 4: Flag Anomalies

An anomaly is any point that deviates significantly from the pattern:

- **Z-score > 2.5** from the rolling mean
- **Breaks the established trend** direction
- **Deviates from seasonal pattern** by > 50%

For each anomaly, report: the data point, its expected value, the deviation magnitude, and a possible explanation if context is available. If no explanation is obvious, say "unexplained — investigate."

### Phase 5: Report

Use this exact format:

```
## Trend Analysis: [Dataset Name]

### Data Quality
- Period: [start] → [end] | Points: [count] | Missing: [%]
- Granularity: [daily/weekly/etc.]

### Key Trends
1. [Metric] is [rising/falling/flat] at [X% per period]. [Confidence: high/medium/low]
2. ...

### Anomalies
- [Date]: [metric] = [value] (expected ~[value]) — [explanation or "unexplained"]

### Forecast
- Next 7 periods: [projection] (confidence: [high/medium/low])
- Next 30 periods: [projection] (confidence: [high/medium/low])

### What to Do
- [Specific, actionable recommendation based on the trends]
```

## Guardrails

- Do NOT present low-confidence findings as facts. Always tag confidence levels
- Do NOT forecast beyond 2x the data range (e.g., 30 days of data → max 60-day forecast)
- Do NOT confuse correlation with causation. If two metrics move together, say "correlated" not "caused by"
- If the dataset has fewer than 20 data points, warn that trend detection is unreliable
- If the user provides no data, ask for it — do NOT generate synthetic data

## Memory

Store under `analysis.<dataset-slug>.<date>`:
- **L0**: "Trend: [metric] [direction] [rate]. Key anomaly: [if any]"
- **L1**: Key trends, anomalies, and forecast summary
- **L2**: Full report with methodology and all statistics
