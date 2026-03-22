---
name: web-research
version: 2.0.0
agent: scout
description: "Deep web research with source verification — searches, fetches, cross-references, stores findings"
triggers: ["research this", "find information about", "look up", "investigate", "what is", "tell me about", "deep dive on", "gather intel on", "what do we know about", "background check on"]
dependencies: []
requiredSecrets: []
timeout: 600
tags: ["research", "web", "information-gathering", "analysis"]
author: hivemind-core
---

# Web Research

Deep research on any topic. Search multiple sources, verify claims, produce a structured report with citations.

## Process

### Phase 1: Break Down the Question

Split the user's request into sub-questions:

1. **Core question** — what is the user fundamentally trying to learn? Write it as one sentence
2. **Supporting questions** — what context or background is needed to answer the core question?
3. **Verification questions** — what claims will need cross-referencing?

### Phase 2: Search

Use `WebSearch` for each sub-question. Run at least 3 searches with different phrasings to avoid search bias.

For each result:
1. Use `WebFetch` to get the full page content
2. Record: URL, title, publication date, author
3. Rate credibility (1-5): 5 = primary source (official docs, peer-reviewed), 3 = reputable journalism, 1 = anonymous forum post
4. Note potential biases (company blog promoting own product, political slant, etc.)

**Minimum 5 sources.** If you can't find 5, note the information gap.

### Phase 3: Extract Facts

From each source, pull out:

1. **Concrete facts** — verifiable claims with direct quotes. Attribute each: "[Claim]" — [Source, Date]
2. **Statistics** — include methodology context when available. Flag stats without methodology
3. **Expert opinions** — label clearly as opinion, name the expert and their credentials
4. **Contradictions** — when sources disagree, list both positions side by side

Do NOT paraphrase in ways that change meaning. When in doubt, quote directly.

### Phase 4: Synthesize

Combine findings into this exact format:

```
## Research: [Topic]

### Summary
[2-3 sentences answering the core question. Include confidence level: high/medium/low]

### Key Findings
1. [Finding with source attribution]
2. [Finding with source attribution]
3. [Finding with source attribution]

### Contradictions & Gaps
- [Where sources disagree or information is missing]

### Sources
1. [Title](URL) — [Author, Date] — Credibility: X/5
2. ...
```

## Guardrails

- Do NOT present speculation as fact. If it's uncertain, say "likely" or "unconfirmed"
- Do NOT use a single source for any key claim. Cross-reference or flag as single-source
- Do NOT include information older than 2 years without noting the date and checking for updates
- If the topic is rapidly evolving (breaking news, new tech), warn that findings may be outdated within days
- If you find contradictory information and can't resolve it, present both sides — do NOT pick one

## Memory

Store under `research.<topic-slug>`:
- **L0**: One-sentence answer to the core question with confidence level
- **L1**: Key findings list and source URLs
- **L2**: Full research report with all details
