import { spawn } from 'child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CDP_SCRIPT = path.join(__dirname, 'cdp.mjs');

// ── Types ────────────────────────────────────────────────────────────────────

export interface BrowserTab {
  targetId: string;
  title: string;
  url: string;
}

export interface BrowserScreenshot {
  filePath: string;
  dpr: number;
  info: string;
}

export interface BrowserCommandResult {
  ok: boolean;
  output: string;
  error?: string;
}

// ── Browser Provider ─────────────────────────────────────────────────────────

/**
 * Programmatic wrapper around Chrome DevTools Protocol via cdp.mjs.
 * Gives HIVEMIND agents live access to the user's Chrome browser —
 * logged-in sessions, open tabs, and full page interaction.
 *
 * Requires: Chrome with remote debugging enabled.
 *   Enable at: chrome://inspect/#remote-debugging
 */
export class BrowserProvider {
  private readonly timeoutMs: number;

  constructor(config: { timeoutMs?: number } = {}) {
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  /** List all open Chrome tabs. */
  async listTabs(): Promise<BrowserTab[]> {
    const output = await this.exec(['list']);
    if (!output.ok) return [];

    const lines = output.output.trim().split('\n').filter(l => l.trim());
    return lines.map(line => {
      // Format: "TARGETID  TITLE                                                  URL"
      const parts = line.match(/^(\S+)\s+(.{54})\s+(.+)$/);
      if (!parts) return { targetId: line.trim(), title: '', url: '' };
      return {
        targetId: parts[1]!.trim(),
        title: parts[2]!.trim(),
        url: parts[3]!.trim(),
      };
    });
  }

  /** Get the accessibility tree snapshot of a tab (for understanding page structure). */
  async snapshot(targetId: string): Promise<string> {
    const result = await this.exec(['snap', targetId]);
    return result.ok ? result.output : `Error: ${result.error}`;
  }

  /** Take a screenshot of a tab. */
  async screenshot(targetId: string, filePath?: string): Promise<BrowserScreenshot> {
    const args = ['shot', targetId];
    if (filePath) args.push(filePath);
    const result = await this.exec(args);
    if (!result.ok) throw new Error(result.error ?? 'Screenshot failed');

    const lines = result.output.split('\n');
    const dprMatch = result.output.match(/DPR\):\s*([\d.]+)/);
    return {
      filePath: lines[0] ?? '',
      dpr: dprMatch ? parseFloat(dprMatch[1]!) : 1,
      info: result.output,
    };
  }

  /** Get the HTML of a page or a specific element. */
  async getHtml(targetId: string, selector?: string): Promise<string> {
    const args = ['html', targetId];
    if (selector) args.push(selector);
    const result = await this.exec(args);
    return result.ok ? result.output : `Error: ${result.error}`;
  }

  /** Navigate a tab to a URL and wait for load. */
  async navigate(targetId: string, url: string): Promise<string> {
    const result = await this.exec(['nav', targetId, url]);
    return result.ok ? result.output : `Error: ${result.error}`;
  }

  /** Click an element by CSS selector. */
  async click(targetId: string, selector: string): Promise<string> {
    const result = await this.exec(['click', targetId, selector]);
    return result.ok ? result.output : `Error: ${result.error}`;
  }

  /** Click at specific CSS pixel coordinates. */
  async clickXY(targetId: string, x: number, y: number): Promise<string> {
    const result = await this.exec(['clickxy', targetId, String(x), String(y)]);
    return result.ok ? result.output : `Error: ${result.error}`;
  }

  /** Type text into the currently focused element. */
  async type(targetId: string, text: string): Promise<string> {
    const result = await this.exec(['type', targetId, text]);
    return result.ok ? result.output : `Error: ${result.error}`;
  }

  /** Evaluate a JavaScript expression in the page context. */
  async evaluate(targetId: string, expression: string): Promise<string> {
    const result = await this.exec(['eval', targetId, expression]);
    return result.ok ? result.output : `Error: ${result.error}`;
  }

  /** Get network performance timing data. */
  async network(targetId: string): Promise<string> {
    const result = await this.exec(['net', targetId]);
    return result.ok ? result.output : `Error: ${result.error}`;
  }

  /** Open a new tab, optionally with a URL. */
  async openTab(url?: string): Promise<string> {
    const args = ['open'];
    if (url) args.push(url);
    const result = await this.exec(args);
    return result.ok ? result.output : `Error: ${result.error}`;
  }

  /** Repeatedly click a "load more" button until it disappears. */
  async loadAll(targetId: string, selector: string, intervalMs?: number): Promise<string> {
    const args = ['loadall', targetId, selector];
    if (intervalMs) args.push(String(intervalMs));
    const result = await this.exec(args, 300_000); // 5 min timeout for loading
    return result.ok ? result.output : `Error: ${result.error}`;
  }

  /** Check if Chrome remote debugging is accessible. */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.exec(['list']);
      return result.ok;
    } catch {
      return false;
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private exec(args: string[], timeout?: number): Promise<BrowserCommandResult> {
    return new Promise((resolve) => {
      const proc = spawn('node', [CDP_SCRIPT, ...args], {
        timeout: timeout ?? this.timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ ok: true, output: stdout.trim() });
        } else {
          resolve({ ok: false, output: stdout.trim(), error: stderr.trim() || stdout.trim() });
        }
      });

      proc.on('error', (err) => {
        resolve({ ok: false, output: '', error: err.message });
      });
    });
  }
}

// ── Verification ─────────────────────────────────────────────────────────────

/**
 * Check if Chrome remote debugging is available.
 * User needs to enable it at chrome://inspect/#remote-debugging
 */
export async function verifyBrowser(): Promise<{ ok: boolean; error?: string; tabCount?: number }> {
  const browser = new BrowserProvider({ timeoutMs: 10_000 });
  try {
    const tabs = await browser.listTabs();
    if (tabs.length > 0) {
      return { ok: true, tabCount: tabs.length };
    }
    return { ok: false, error: 'No tabs found. Enable remote debugging at chrome://inspect/#remote-debugging' };
  } catch {
    return { ok: false, error: 'Chrome remote debugging not available. Enable at chrome://inspect/#remote-debugging' };
  }
}
