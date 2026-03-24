import { getSetting, setSetting } from './db.js';
import { runPipeline, processRetryQueue } from './pipeline.js';

let intervalId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastRunAt: Date | null = null;
let nextRunAt: Date | null = null;
let lastError: string | null = null;

export function startScheduler() {
  const enabled = getSetting('pipeline_enabled') === 'true';
  if (!enabled) {
    console.log('[Scheduler] Pipeline is disabled. Not starting scheduler.');
    return;
  }

  const intervalMinutes = parseInt(getSetting('scan_interval_minutes') || '15', 10);
  console.log(`[Scheduler] Starting with ${intervalMinutes}-minute interval`);

  // Run once immediately
  tick();

  // Set up recurring interval
  const intervalMs = intervalMinutes * 60 * 1000;
  nextRunAt = new Date(Date.now() + intervalMs);
  intervalId = setInterval(tick, intervalMs);
}

async function tick() {
  if (isRunning) {
    console.log('[Scheduler] Skipping tick — previous run still in progress');
    return;
  }

  isRunning = true;
  lastError = null;

  try {
    // Process retry queue before main pipeline run
    const retryResult = await processRetryQueue();
    if (retryResult.attempted > 0) {
      console.log(
        `[Scheduler] Retry queue: ${retryResult.attempted} attempted, ` +
        `${retryResult.succeeded} succeeded, ${retryResult.failed} permanently failed`,
      );
    }

    console.log('[Scheduler] Running pipeline...');
    const result = await runPipeline('scheduled');
    lastRunAt = new Date();
    console.log(
      `[Scheduler] Complete. Scanned: ${result.emails_scanned}, ` +
      `Flagged: ${result.emails_flagged}, Pushed: ${result.emails_pushed}, ` +
      `Errors: ${result.emails_errored} (${result.duration_ms}ms)`,
    );
    if (result.error_message) {
      lastError = result.error_message;
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    console.error('[Scheduler] Pipeline error:', lastError);
  } finally {
    isRunning = false;
    const intervalMinutes = parseInt(getSetting('scan_interval_minutes') || '15', 10);
    nextRunAt = new Date(Date.now() + intervalMinutes * 60 * 1000);
  }
}

export async function triggerManualRun() {
  if (isRunning) {
    throw new Error('Pipeline is already running');
  }

  isRunning = true;
  lastError = null;

  try {
    const result = await runPipeline('manual');
    lastRunAt = new Date();
    if (result.error_message) {
      lastError = result.error_message;
    }
    return result;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    isRunning = false;
  }
}

export function updateInterval(minutes: number) {
  setSetting('scan_interval_minutes', String(minutes));

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  const enabled = getSetting('pipeline_enabled') === 'true';
  if (enabled) {
    const intervalMs = minutes * 60 * 1000;
    nextRunAt = new Date(Date.now() + intervalMs);
    intervalId = setInterval(tick, intervalMs);
    console.log(`[Scheduler] Interval updated to ${minutes} minutes`);
  }
}

export function toggleScheduler(enabled: boolean) {
  setSetting('pipeline_enabled', String(enabled));

  if (enabled) {
    if (!intervalId) {
      startScheduler();
    }
  } else {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      nextRunAt = null;
      console.log('[Scheduler] Stopped');
    }
  }
}

export function getSchedulerStatus() {
  return {
    enabled: getSetting('pipeline_enabled') === 'true',
    is_running: isRunning,
    last_run_at: lastRunAt?.toISOString() ?? null,
    next_run_at: nextRunAt?.toISOString() ?? null,
    last_error: lastError,
    scan_interval_minutes: parseInt(getSetting('scan_interval_minutes') || '15', 10),
  };
}
