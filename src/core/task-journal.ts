/**
 * HIVEMIND Task Journal (#4: Persistent Task State & Recovery)
 *
 * SQLite-backed persistence for tasks so the orchestrator can
 * resume after a crash. Each task state change is journaled,
 * and on startup the orchestrator can reload incomplete tasks.
 */

interface JournalDatabase {
  exec(sql: string): void;
  prepare(sql: string): JournalStatement;
  close(): void;
}

interface JournalStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface PersistedTask {
  id: string;
  description: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  parentId: string | null;
  input: string; // JSON
  result: string | null; // JSON
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  timeoutMs: number;
  retries: number;
  maxRetries: number;
}

export class TaskJournal {
  private db!: JournalDatabase;
  private initialized = false;

  /** Initialize the journal database. */
  async initialize(dbPath: string): Promise<void> {
    const { default: Database } = await import("better-sqlite3");
    this.db = new Database(dbPath) as unknown as JournalDatabase;

    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_journal (
        id            TEXT PRIMARY KEY,
        description   TEXT NOT NULL,
        priority      TEXT NOT NULL DEFAULT 'normal',
        status        TEXT NOT NULL DEFAULT 'queued',
        assigned_to   TEXT,
        parent_id     TEXT,
        input         TEXT NOT NULL DEFAULT '{}',
        result        TEXT,
        error         TEXT,
        created_at    TEXT NOT NULL,
        started_at    TEXT,
        completed_at  TEXT,
        timeout_ms    INTEGER NOT NULL DEFAULT 300000,
        retries       INTEGER NOT NULL DEFAULT 0,
        max_retries   INTEGER NOT NULL DEFAULT 3
      );

      CREATE INDEX IF NOT EXISTS idx_journal_status ON task_journal(status);
      CREATE INDEX IF NOT EXISTS idx_journal_parent ON task_journal(parent_id);
    `);

    this.initialized = true;
  }

  /** Persist a new task. */
  save(task: PersistedTask): void {
    this.ensureInitialized();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO task_journal
         (id, description, priority, status, assigned_to, parent_id,
          input, result, error, created_at, started_at, completed_at,
          timeout_ms, retries, max_retries)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.description,
        task.priority,
        task.status,
        task.assignedTo,
        task.parentId,
        task.input,
        task.result,
        task.error,
        task.createdAt,
        task.startedAt,
        task.completedAt,
        task.timeoutMs,
        task.retries,
        task.maxRetries,
      );
  }

  /** Update task status and optional fields. */
  updateStatus(
    taskId: string,
    status: string,
    fields?: Partial<Pick<PersistedTask, "assignedTo" | "result" | "error" | "startedAt" | "completedAt" | "retries">>,
  ): void {
    this.ensureInitialized();

    let sql = "UPDATE task_journal SET status = ?";
    const params: unknown[] = [status];

    if (fields?.assignedTo !== undefined) {
      sql += ", assigned_to = ?";
      params.push(fields.assignedTo);
    }
    if (fields?.result !== undefined) {
      sql += ", result = ?";
      params.push(fields.result);
    }
    if (fields?.error !== undefined) {
      sql += ", error = ?";
      params.push(fields.error);
    }
    if (fields?.startedAt !== undefined) {
      sql += ", started_at = ?";
      params.push(fields.startedAt);
    }
    if (fields?.completedAt !== undefined) {
      sql += ", completed_at = ?";
      params.push(fields.completedAt);
    }
    if (fields?.retries !== undefined) {
      sql += ", retries = ?";
      params.push(fields.retries);
    }

    sql += " WHERE id = ?";
    params.push(taskId);

    this.db.prepare(sql).run(...params);
  }

  /** Load all incomplete tasks (for recovery after restart). */
  loadIncomplete(): PersistedTask[] {
    this.ensureInitialized();
    const rows = this.db
      .prepare(
        "SELECT * FROM task_journal WHERE status IN ('queued', 'assigned', 'running') ORDER BY created_at ASC",
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => this.rowToTask(r));
  }

  /** Load a single task by ID. */
  load(taskId: string): PersistedTask | null {
    this.ensureInitialized();
    const row = this.db
      .prepare("SELECT * FROM task_journal WHERE id = ?")
      .get(taskId) as Record<string, unknown> | undefined;

    return row ? this.rowToTask(row) : null;
  }

  /** Load all tasks for a deployment (by parent ID). */
  loadByParent(parentId: string): PersistedTask[] {
    this.ensureInitialized();
    const rows = this.db
      .prepare("SELECT * FROM task_journal WHERE parent_id = ? ORDER BY created_at ASC")
      .all(parentId) as Array<Record<string, unknown>>;

    return rows.map((r) => this.rowToTask(r));
  }

  /** Delete completed/failed tasks older than the given age in milliseconds. */
  prune(maxAgeMs: number): number {
    this.ensureInitialized();
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = this.db
      .prepare(
        "DELETE FROM task_journal WHERE status IN ('completed', 'failed', 'cancelled') AND completed_at < ?",
      )
      .run(cutoff);
    return result.changes;
  }

  /** Close the database connection. */
  close(): void {
    this.db?.close();
    this.initialized = false;
  }

  private rowToTask(row: Record<string, unknown>): PersistedTask {
    return {
      id: row["id"] as string,
      description: row["description"] as string,
      priority: row["priority"] as string,
      status: row["status"] as string,
      assignedTo: row["assigned_to"] as string | null,
      parentId: row["parent_id"] as string | null,
      input: row["input"] as string,
      result: row["result"] as string | null,
      error: row["error"] as string | null,
      createdAt: row["created_at"] as string,
      startedAt: row["started_at"] as string | null,
      completedAt: row["completed_at"] as string | null,
      timeoutMs: row["timeout_ms"] as number,
      retries: row["retries"] as number,
      maxRetries: row["max_retries"] as number,
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("TaskJournal not initialized. Call initialize() first.");
    }
  }
}
