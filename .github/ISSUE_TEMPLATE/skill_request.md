---
name: Skill Request
about: Propose a new skill for HIVEMIND agents
title: "[Skill] "
labels: skill-request, enhancement
assignees: ""
---

## Skill Name

A short, descriptive name for the proposed skill.

## Description

What should this skill allow agents to do?

## Input / Output

**Input**: What data or context does the skill require?

**Output**: What does the skill produce or return?

## Agent Types

Which agent types should have access to this skill?

- [ ] Orchestrator
- [ ] Worker
- [ ] Specialist
- [ ] Sentinel

## Example Usage

```typescript
// Show how an agent would invoke this skill
const result = await agent.executeSkill('skill-name', {
  // parameters
});
```

## Dependencies

Does this skill require external APIs, services, or libraries?

## Complexity Estimate

- [ ] Small — Can be implemented in a single file
- [ ] Medium — Requires multiple files or integration work
- [ ] Large — Requires architectural changes or new subsystems

## Additional Context

Any references, research, or related skills that inform this request.
