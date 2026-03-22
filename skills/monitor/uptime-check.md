---
name: uptime-check
version: 1.0.0
agent: monitor
description: Monitor website and API uptime with alerting on degradation
triggers: ["check uptime", "monitor site", "is it up", "health check", "monitor uptime"]
dependencies: ["slack-notify"]
requiredSecrets: []
timeout: 60
tags: ["monitoring", "uptime", "health", "observability", "alerting"]
author: hivemind-core
---

# Uptime Check Skill

You are a **Monitor agent** responsible for checking website and API availability, measuring response times, and alerting on degradation or outages.

## Process

### Phase 1: Target Resolution

Parse the monitoring request to identify:

1. **Endpoints** — URLs to monitor (support multiple targets per invocation)
2. **Method** — HTTP method (default: GET; support HEAD for lightweight checks)
3. **Expected status** — acceptable HTTP status codes (default: 200-299)
4. **Timeout** — per-request timeout in seconds (default: 10)
5. **Check interval** — for recurring checks (if scheduled)

### Phase 2: Health Check Execution

For each endpoint, perform the check:

```
1. Record start timestamp
2. Send HTTP request with timeout
3. Record response timestamp
4. Capture: status code, response time, headers, body size
5. Validate against expected status
6. If TLS, check certificate expiry
```

Collect the following metrics per check:

| Metric | Description |
|--------|-------------|
| `status_code` | HTTP response status |
| `response_time_ms` | Time to first byte |
| `total_time_ms` | Total request duration |
| `dns_time_ms` | DNS resolution time |
| `tls_valid` | Whether the TLS certificate is valid |
| `tls_expiry_days` | Days until certificate expires |
| `body_size_bytes` | Response body size |
| `content_match` | Whether expected content was found (if configured) |

### Phase 3: Status Determination

Classify each endpoint's status:

| Status | Criteria |
|--------|----------|
| **Healthy** | Expected status code, response time under 2x baseline |
| **Degraded** | Expected status code, but response time over 2x baseline |
| **Down** | Unexpected status code, timeout, or connection error |
| **Certificate Warning** | TLS certificate expires within 14 days |

Baseline response time is the rolling average from the last 10 checks stored in memory.

### Phase 4: Reporting

Generate a status report:

```
## Uptime Report — {timestamp}

| Endpoint | Status | Response Time | Details |
|----------|--------|--------------|---------|
| https://api.example.com | Healthy | 142ms | 200 OK |
| https://app.example.com | Degraded | 3201ms | 200 OK (baseline: 800ms) |

### Alerts
- app.example.com: Response time 4x above baseline (800ms -> 3201ms)
```

### Phase 5: Alerting

When status is **Degraded** or **Down**:

1. Check memory for recent alerts on the same endpoint to avoid duplicate notifications
2. If no recent alert (within the configured cooldown, default 15 minutes):
   - Trigger the `slack-notify` skill with an alert-type message
   - Store the alert record in memory under `monitor.alerts.<endpoint-slug>`
3. If the endpoint recovers after a previous alert, send a recovery notification

### Phase 6: Memory Storage

Store check results hierarchically:

- **L0**: Current status summary for all monitored endpoints (single line each)
- **L1**: Last 24 hours of status changes and response time trends
- **L2**: Full check history with all metrics

Update the rolling baseline after each check.

## Scheduled Mode

When run as a recurring scheduled skill:

1. Load the endpoint list from memory (`monitor.config.endpoints`)
2. Run all checks in parallel
3. Compare results to previous check
4. Alert only on state transitions (healthy -> degraded, degraded -> down, down -> healthy)
5. Update the L0 summary in memory

## Error Handling

- DNS resolution failure: mark as Down, include error message
- TLS handshake failure: mark as Down, note certificate issue
- Timeout: mark as Down, report configured timeout value
- Redirect loops: mark as Down after 5 redirects
