import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../src/memory/store.js';
import { MemoryLevel } from '../../src/memory/types.js';
import os from 'os';
import path from 'path';
import fs from 'fs';

let store: MemoryStore;
let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `hivemind-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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
// CRUD
// ---------------------------------------------------------------------------

describe('MemoryStore CRUD', () => {
  it('write + read: creates entry with correct fields', async () => {
    const id = await store.write({
      namespace: 'tasks',
      title: 'Test task',
      content: 'Some content for the test task',
      level: MemoryLevel.L0,
      metadata: { foo: 'bar' },
      source: 'test-agent',
    });

    expect(id).toBeTruthy();
    const entry = store.read(id);
    expect(entry).not.toBeNull();
    expect(entry!.namespace).toBe('tasks');
    expect(entry!.title).toBe('Test task');
    expect(entry!.content).toBe('Some content for the test task');
    expect(entry!.level).toBe(MemoryLevel.L0);
    expect(entry!.metadata).toEqual({ foo: 'bar' });
    expect(entry!.source).toBe('test-agent');
    expect(entry!.tokenCount).toBeGreaterThan(0);
    expect(entry!.parentId).toBeNull();
    expect(entry!.createdAt).toBeTruthy();
    expect(entry!.updatedAt).toBeTruthy();
  });

  it('read missing: returns null', () => {
    const entry = store.read('nonexistent-id');
    expect(entry).toBeNull();
  });

  it('update: changes content and recalculates tokenCount', async () => {
    const id = await store.write({
      namespace: 'tasks',
      title: 'Original',
      content: 'Short',
      level: MemoryLevel.L0,
    });

    const before = store.read(id)!;
    const oldTokens = before.tokenCount;

    await store.update(id, { content: 'A much longer piece of content that should have a higher token count than before' });

    const after = store.read(id)!;
    expect(after.content).toBe('A much longer piece of content that should have a higher token count than before');
    expect(after.tokenCount).toBeGreaterThan(oldTokens);
  });

  it('delete: removes entry, read returns null', async () => {
    const id = await store.write({
      namespace: 'tasks',
      title: 'To delete',
      content: 'Will be gone',
      level: MemoryLevel.L0,
    });

    const result = store.delete(id);
    expect(result).toBe(true);
    expect(store.read(id)).toBeNull();
  });

  it('delete cascade: deleting parent removes children recursively', async () => {
    const l0Id = await store.write({
      namespace: 'tasks',
      title: 'Parent',
      content: 'L0 content',
      level: MemoryLevel.L0,
    });
    const l1Id = await store.write({
      namespace: 'tasks',
      title: 'Child',
      content: 'L1 content',
      level: MemoryLevel.L1,
      parentId: l0Id,
    });
    const l2Id = await store.write({
      namespace: 'tasks',
      title: 'Grandchild',
      content: 'L2 content',
      level: MemoryLevel.L2,
      parentId: l1Id,
    });

    store.delete(l0Id);

    expect(store.read(l0Id)).toBeNull();
    expect(store.read(l1Id)).toBeNull();
    expect(store.read(l2Id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

describe('MemoryStore hierarchy', () => {
  it('writeHierarchy: creates L0->L1->L2 with correct parentId chain', async () => {
    const { l0, l1, l2 } = await store.writeHierarchy({
      namespace: 'tasks',
      title: 'Hierarchy test',
      summary: 'Brief summary',
      overview: 'Detailed overview of the task with more context',
      fullContent: 'The complete raw content with all details included here for posterity',
      metadata: { test: true },
      source: 'test',
    });

    const l0Entry = store.read(l0)!;
    const l1Entry = store.read(l1)!;
    const l2Entry = store.read(l2)!;

    expect(l0Entry.level).toBe(MemoryLevel.L0);
    expect(l0Entry.content).toBe('Brief summary');
    expect(l0Entry.parentId).toBeNull();

    expect(l1Entry.level).toBe(MemoryLevel.L1);
    expect(l1Entry.content).toBe('Detailed overview of the task with more context');
    expect(l1Entry.parentId).toBe(l0);

    expect(l2Entry.level).toBe(MemoryLevel.L2);
    expect(l2Entry.content).toBe('The complete raw content with all details included here for posterity');
    expect(l2Entry.parentId).toBe(l1);
  });
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

describe('MemoryStore queries', () => {
  it('listByNamespace: returns entries matching prefix, excludes other namespaces', async () => {
    await store.write({ namespace: 'tasks.sprint1', title: 'A', content: 'First', level: MemoryLevel.L0 });
    await store.write({ namespace: 'tasks.sprint1', title: 'B', content: 'Second', level: MemoryLevel.L0 });
    await store.write({ namespace: 'other', title: 'C', content: 'Other ns', level: MemoryLevel.L0 });

    const results = store.listByNamespace('tasks');
    expect(results.length).toBe(2);
    const titles = results.map(r => r.title).sort();
    expect(titles).toEqual(['A', 'B']);

    // Verify 'other' namespace entry is excluded
    const otherResults = store.listByNamespace('other');
    expect(otherResults.length).toBe(1);
    expect(otherResults[0].title).toBe('C');
  });

  it('listByNamespace with level: filters to specific level', async () => {
    await store.write({ namespace: 'tasks', title: 'L0 entry', content: 'summary', level: MemoryLevel.L0 });
    await store.write({ namespace: 'tasks', title: 'L1 entry', content: 'overview', level: MemoryLevel.L1 });

    const l0Only = store.listByNamespace('tasks', MemoryLevel.L0);
    expect(l0Only.length).toBe(1);
    expect(l0Only[0].title).toBe('L0 entry');

    const l1Only = store.listByNamespace('tasks', MemoryLevel.L1);
    expect(l1Only.length).toBe(1);
    expect(l1Only[0].title).toBe('L1 entry');
  });

  it('getChildren: returns direct children of parent', async () => {
    const parentId = await store.write({ namespace: 'tasks', title: 'Parent', content: 'P', level: MemoryLevel.L0 });
    await store.write({ namespace: 'tasks', title: 'Child 1', content: 'C1', level: MemoryLevel.L1, parentId });
    await store.write({ namespace: 'tasks', title: 'Child 2', content: 'C2', level: MemoryLevel.L1, parentId });
    await store.write({ namespace: 'tasks', title: 'Unrelated', content: 'U', level: MemoryLevel.L1 });

    const children = store.getChildren(parentId);
    expect(children.length).toBe(2);
    expect(children.map(c => c.title).sort()).toEqual(['Child 1', 'Child 2']);
  });

  it('keyword search: finds entries matching query terms, returns scored results', async () => {
    await store.write({ namespace: 'tasks', title: 'Deploy pipeline', content: 'Set up CI/CD deploy pipeline with GitHub Actions', level: MemoryLevel.L0 });
    await store.write({ namespace: 'tasks', title: 'Fix login bug', content: 'Authentication token was expired causing login failures', level: MemoryLevel.L0 });

    const results = await store.search({ query: 'deploy pipeline', limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].entry.title).toBe('Deploy pipeline');
    expect(results[0].score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

describe('MemoryStore dedup', () => {
  it('findDuplicate: finds existing entry by (namespace, title, level)', async () => {
    await store.write({ namespace: 'tasks', title: 'My task', content: 'v1', level: MemoryLevel.L0 });
    const dup = store.findDuplicate('tasks', 'My task', MemoryLevel.L0);
    expect(dup).toBeTruthy();
  });

  it('findDuplicate: returns null when no match', () => {
    const dup = store.findDuplicate('tasks', 'Nonexistent', MemoryLevel.L0);
    expect(dup).toBeNull();
  });

  it('writeOrUpdate (new): creates when no duplicate exists', async () => {
    const id = await store.writeOrUpdate({
      namespace: 'tasks',
      title: 'Brand new',
      content: 'Fresh content',
      level: MemoryLevel.L0,
    });

    const entry = store.read(id)!;
    expect(entry.content).toBe('Fresh content');
  });

  it('writeOrUpdate (existing): updates when duplicate exists', async () => {
    await store.write({ namespace: 'tasks', title: 'Existing', content: 'Old version', level: MemoryLevel.L0 });
    const id = await store.writeOrUpdate({
      namespace: 'tasks',
      title: 'Existing',
      content: 'Updated version',
      level: MemoryLevel.L0,
    });

    const entry = store.read(id)!;
    expect(entry.content).toBe('Updated version');
  });
});

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

describe('MemoryStore maintenance', () => {
  it('prune: keeps maxPerLevel newest, deletes rest', async () => {
    // Write 5 L0 entries
    for (let i = 0; i < 5; i++) {
      await store.write({ namespace: 'tasks', title: `Entry ${i}`, content: `Content ${i}`, level: MemoryLevel.L0 });
    }

    const deleted = store.prune('tasks', 2);
    expect(deleted).toBe(3);

    const remaining = store.listByNamespace('tasks', MemoryLevel.L0);
    expect(remaining.length).toBe(2);
  });

  it('stats: returns correct counts and tokens by namespace', async () => {
    await store.write({ namespace: 'tasks', title: 'T1', content: 'Hello world', level: MemoryLevel.L0 });
    await store.write({ namespace: 'tasks', title: 'T2', content: 'More content here', level: MemoryLevel.L0 });
    await store.write({ namespace: 'projects', title: 'P1', content: 'Project data', level: MemoryLevel.L0 });

    const s = store.stats();
    expect(s.total).toBe(3);
    expect(s.totalTokens).toBeGreaterThan(0);
    expect(s.byNamespace['tasks'].count).toBe(2);
    expect(s.byNamespace['projects'].count).toBe(1);
  });
});
