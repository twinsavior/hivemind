---
name: simplify
description: Review changed code for reuse, quality, and efficiency, then fix any issues found.
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# Simplify / Code Review

Run this after batch work or before merging a large feature. Reviews all changed files for quality issues.

## Steps

1. **Find changed files:**
   ```bash
   git diff --name-only main
   ```

2. **Read each changed file** and check for:
   - **Dead code**: Unused imports, unreachable branches, commented-out code
   - **Duplication**: Same logic repeated that should be extracted
   - **Over-engineering**: Abstractions for single-use cases, premature generalization
   - **Inconsistency**: Mixed patterns (e.g., some files use async/await, others use callbacks)
   - **Missing error handling** at system boundaries (user input, external APIs)
   - **Unnecessary error handling** for internal code paths that can't fail
   - **Naming**: Vague names (`data`, `result`, `temp`), misleading names
   - **Large functions**: Functions doing 3+ things that should be split

3. **Fix issues silently.** Don't ask permission for cleanup -- just do it.

4. **Report a summary:**
   - What was cleaned up
   - Any concerns that need the user's input (e.g., "this function looks unused -- should I remove it?")

## Rules

- Don't add docstrings, comments, or type annotations to code you didn't change
- Don't refactor working code that wasn't part of the current changes
- Don't add features or configurability beyond what was asked
- Three similar lines is better than a premature abstraction
