import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextManager } from '../../src/memory/context.js';
import { MemoryStore } from '../../src/memory/store.js';
import { MemoryLevel } from '../../src/memory/types.js';
import os from 'os';
import path from 'path';
import fs from 'fs';

let store: MemoryStore;
let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `hivemind-ctx-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  store = new MemoryStore({ dbPath });
  await store.initialize();
});

afterEach(() => {
  try { store.close(); } catch {}
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch {}
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed the store with a small entry at the given level. Returns the ID. */
async function seedEntry(opts: {
  namespace?: string;
  title?: string;
  content?: string;
  level?: MemoryLevel;
  parentId?: string;
}): Promise<string> {
  return store.write({
    namespace: opts.namespace ?? 'tasks',
    title: opts.title ?? 'Test entry',
    content: opts.content ?? 'Some test content for memory',
    level: opts.level ?? MemoryLevel.L0,
    parentId: opts.parentId,
  });
}

// ---------------------------------------------------------------------------
// Budget basics
// ---------------------------------------------------------------------------

describe('ContextManager budget', () => {
  it('initial budget: total=4096, used=0, remaining=4096', () => {
    const ctx = new ContextManager(store, 4096);
    const budget = ctx.getBudget();
    expect(budget.total).toBe(4096);
    expect(budget.used).toBe(0);
    expect(budget.remaining).toBe(4096);
  });

  it('budget invariant: used + remaining = total at all times', async () => {
    await seedEntry({ title: 'Entry 1', content: 'Content for entry one' });
    await seedEntry({ title: 'Entry 2', content: 'Content for entry two' });

    const ctx = new ContextManager(store, 4096);
    await ctx.loadRelevant('entry', { limit: 5 });

    const budget = ctx.getBudget();
    expect(budget.used + budget.remaining).toBe(budget.total);
  });
});

// ---------------------------------------------------------------------------
// loadRelevant
// ---------------------------------------------------------------------------

describe('ContextManager loadRelevant', () => {
  it('returns matching entries and allocates from budget', async () => {
    await seedEntry({ title: 'Deploy pipeline', content: 'CI/CD deploy pipeline setup' });
    await seedEntry({ title: 'Fix login', content: 'Authentication bug fix' });

    const ctx = new ContextManager(store, 4096);
    const result = await ctx.loadRelevant('deploy pipeline', { limit: 5 });

    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    expect(ctx.getBudget().used).toBeGreaterThan(0);
    expect(ctx.getBudget().remaining).toBeLessThan(4096);
  });
});

// ---------------------------------------------------------------------------
// loadEntries
// ---------------------------------------------------------------------------

describe('ContextManager loadEntries', () => {
  it('allocates from existing budget without reset', async () => {
    const id1 = await seedEntry({ title: 'E1', content: 'Content one' });
    const id2 = await seedEntry({ title: 'E2', content: 'Content two' });

    const ctx = new ContextManager(store, 4096);
    const entries = [store.read(id1)!, store.read(id2)!];
    const loaded = ctx.loadEntries(entries);

    expect(loaded.length).toBe(2);
    expect(ctx.getBudget().used).toBeGreaterThan(0);
    expect(ctx.getBudget().remaining).toBeLessThan(4096);
  });

  it('after loadRelevant: shared budget (used from both phases adds up correctly)', async () => {
    await seedEntry({ title: 'Deploy task', content: 'Deploy pipeline with CI/CD' });
    const extraId = await seedEntry({ title: 'Extra entry', content: 'Additional context for backfill' });

    const ctx = new ContextManager(store, 4096);

    // Phase 1: semantic/keyword search
    await ctx.loadRelevant('deploy', { limit: 5 });
    const afterPhase1 = ctx.getBudget().used;
    expect(afterPhase1).toBeGreaterThan(0);

    // Phase 2: backfill with loadEntries
    const extra = store.read(extraId)!;
    ctx.loadEntries([extra]);
    const afterPhase2 = ctx.getBudget().used;

    expect(afterPhase2).toBeGreaterThan(afterPhase1);
    expect(ctx.getBudget().used + ctx.getBudget().remaining).toBe(ctx.getBudget().total);
  });

  it('stops at budget exhaustion (does not overflow)', async () => {
    // Create entries that will exhaust a tiny budget
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(await seedEntry({
        title: `Entry ${i}`,
        content: 'A'.repeat(200), // ~50 tokens each
      }));
    }

    const ctx = new ContextManager(store, 100); // Very small budget
    const entries = ids.map(id => store.read(id)!);
    const loaded = ctx.loadEntries(entries);

    expect(loaded.length).toBeLessThan(10);
    expect(ctx.getBudget().remaining).toBeGreaterThanOrEqual(0);
    expect(ctx.getBudget().used + ctx.getBudget().remaining).toBe(ctx.getBudget().total);
  });

  it('skips already-loaded entries', async () => {
    const id = await seedEntry({ title: 'Only once', content: 'Should not double-count' });

    const ctx = new ContextManager(store, 4096);
    const entry = store.read(id)!;

    const first = ctx.loadEntries([entry]);
    const usedAfterFirst = ctx.getBudget().used;

    const second = ctx.loadEntries([entry]);
    expect(second.length).toBe(0);
    expect(ctx.getBudget().used).toBe(usedAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// isLoaded
// ---------------------------------------------------------------------------

describe('ContextManager isLoaded', () => {
  it('true for loaded entries, false for unloaded', async () => {
    const id1 = await seedEntry({ title: 'Loaded', content: 'Will be loaded' });
    const id2 = await seedEntry({ title: 'Not loaded', content: 'Will not be loaded' });

    const ctx = new ContextManager(store, 4096);
    ctx.loadEntries([store.read(id1)!]);

    expect(ctx.isLoaded(id1)).toBe(true);
    expect(ctx.isLoaded(id2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

describe('ContextManager eviction', () => {
  it('evicts L2 before L1', async () => {
    const l0Id = await seedEntry({ level: MemoryLevel.L0, title: 'Root', content: 'L0 summary' });
    const l1Id = await seedEntry({ level: MemoryLevel.L1, title: 'Overview', content: 'L1 overview text', parentId: l0Id });
    const l2Id = await seedEntry({ level: MemoryLevel.L2, title: 'Detail', content: 'L2 full detail text', parentId: l1Id });

    const ctx = new ContextManager(store, 4096);
    ctx.loadEntries([store.read(l0Id)!, store.read(l1Id)!, store.read(l2Id)!]);
    expect(ctx.getLoadedEntries().length).toBe(3);

    // Evict enough for one entry
    const evicted = ctx.evict(1);
    expect(evicted.length).toBeGreaterThanOrEqual(1);
    // L2 should be evicted first
    expect(evicted[0].level).toBe(MemoryLevel.L2);
  });

  it('never auto-evicts L0', async () => {
    const l0Id = await seedEntry({ level: MemoryLevel.L0, title: 'Root', content: 'L0' });
    const l1Id = await seedEntry({ level: MemoryLevel.L1, title: 'Mid', content: 'L1', parentId: l0Id });

    const ctx = new ContextManager(store, 4096);
    ctx.loadEntries([store.read(l0Id)!, store.read(l1Id)!]);

    // Try to evict a huge amount
    const evicted = ctx.evict(100000);
    // Only L1 should be evicted, not L0
    const evictedLevels = evicted.map(e => e.level);
    expect(evictedLevels).not.toContain(MemoryLevel.L0);
    expect(ctx.isLoaded(l0Id)).toBe(true);
  });

  it('frees correct number of tokens', async () => {
    const l0Id = await seedEntry({ level: MemoryLevel.L0, title: 'Root', content: 'L0 data' });
    const l1Id = await seedEntry({ level: MemoryLevel.L1, title: 'Mid', content: 'L1 overview data', parentId: l0Id });

    const ctx = new ContextManager(store, 4096);
    ctx.loadEntries([store.read(l0Id)!, store.read(l1Id)!]);
    const usedBefore = ctx.getBudget().used;

    const evicted = ctx.evict(1);
    const freedTokens = evicted.reduce((sum, e) => sum + e.tokenCount, 0);
    expect(ctx.getBudget().used).toBe(usedBefore - freedTokens);
  });
});

// ---------------------------------------------------------------------------
// renderContext
// ---------------------------------------------------------------------------

describe('ContextManager renderContext', () => {
  it('empty store returns empty string', () => {
    const ctx = new ContextManager(store, 4096);
    expect(ctx.renderContext()).toBe('');
  });

  it('groups entries by namespace', async () => {
    const id1 = await seedEntry({ namespace: 'tasks', title: 'Task 1', content: 'Task content' });
    const id2 = await seedEntry({ namespace: 'projects', title: 'Project 1', content: 'Project content' });

    const ctx = new ContextManager(store, 4096);
    ctx.loadEntries([store.read(id1)!, store.read(id2)!]);

    const rendered = ctx.renderContext();
    expect(rendered).toContain('## tasks');
    expect(rendered).toContain('## projects');
    expect(rendered).toContain('<memory>');
    expect(rendered).toContain('</memory>');
  });

  it('labels levels as summary/overview/detail', async () => {
    const l0Id = await seedEntry({ level: MemoryLevel.L0, title: 'Root', content: 'Summary text' });
    const l1Id = await seedEntry({ level: MemoryLevel.L1, title: 'Mid', content: 'Overview text', parentId: l0Id });
    const l2Id = await seedEntry({ level: MemoryLevel.L2, title: 'Full', content: 'Detail text', parentId: l1Id });

    const ctx = new ContextManager(store, 4096);
    ctx.loadEntries([store.read(l0Id)!, store.read(l1Id)!, store.read(l2Id)!]);

    const rendered = ctx.renderContext();
    expect(rendered).toContain('[summary]');
    expect(rendered).toContain('[overview]');
    expect(rendered).toContain('[detail]');
  });
});

// ---------------------------------------------------------------------------
// drill
// ---------------------------------------------------------------------------

describe('ContextManager drill', () => {
  it('loads L1 children of L0 entry', async () => {
    const l0Id = await seedEntry({ level: MemoryLevel.L0, title: 'Parent', content: 'Summary' });
    await seedEntry({ level: MemoryLevel.L1, title: 'Child A', content: 'Overview A', parentId: l0Id });
    await seedEntry({ level: MemoryLevel.L1, title: 'Child B', content: 'Overview B', parentId: l0Id });

    const ctx = new ContextManager(store, 4096);
    ctx.loadEntries([store.read(l0Id)!]);

    const result = await ctx.drill(l0Id, MemoryLevel.L1);
    expect(result.entries.length).toBe(2);
    expect(result.entries.every(e => e.level === MemoryLevel.L1)).toBe(true);
    expect(ctx.getBudget().used).toBeGreaterThan(0);
  });
});
