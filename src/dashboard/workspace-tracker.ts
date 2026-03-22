import path from 'path';
import { readdir, readFile, stat } from 'fs/promises';

export interface WorkspaceFileState {
  size: number;
  mtimeMs: number;
}

export interface WorkspaceSnapshot {
  rootDir: string;
  files: Map<string, WorkspaceFileState>;
  scannedFileCount: number;
}

export interface WorkspaceMutationSummary {
  changed: boolean;
  added: string[];
  modified: string[];
  removed: string[];
  samplePaths: string[];
  scannedFileCount: number;
}

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
]);

const MAX_REVIEW_FILES = 6;
const MAX_FILE_BYTES_FOR_REVIEW = 64 * 1024;
const MAX_FILE_CHARS_FOR_REVIEW = 3000;

export async function snapshotWorkspace(rootDir: string): Promise<WorkspaceSnapshot> {
  const files = new Map<string, WorkspaceFileState>();

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);

      if (shouldSkipEntry(entry.name, relativePath, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const fileStat = await stat(fullPath);
        files.set(normalizeRelativePath(relativePath), {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        });
      } catch {
        // Ignore files that disappear during the scan.
      }
    }
  }

  await walk(rootDir);

  return {
    rootDir,
    files,
    scannedFileCount: files.size,
  };
}

export function diffWorkspaceSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): WorkspaceMutationSummary {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const [filePath, afterState] of after.files) {
    const beforeState = before.files.get(filePath);
    if (!beforeState) {
      added.push(filePath);
      continue;
    }

    if (beforeState.size !== afterState.size || beforeState.mtimeMs !== afterState.mtimeMs) {
      modified.push(filePath);
    }
  }

  for (const filePath of before.files.keys()) {
    if (!after.files.has(filePath)) {
      removed.push(filePath);
    }
  }

  added.sort();
  modified.sort();
  removed.sort();

  const samplePaths = [...added, ...modified, ...removed].slice(0, 8);

  return {
    changed: samplePaths.length > 0,
    added,
    modified,
    removed,
    samplePaths,
    scannedFileCount: after.scannedFileCount,
  };
}

export function formatWorkspaceMutationSummary(summary: WorkspaceMutationSummary): string {
  if (!summary.changed) {
    return 'No workspace files were added, modified, or removed.';
  }

  const parts: string[] = [];
  if (summary.added.length > 0) parts.push(`${summary.added.length} added`);
  if (summary.modified.length > 0) parts.push(`${summary.modified.length} modified`);
  if (summary.removed.length > 0) parts.push(`${summary.removed.length} removed`);

  const label = parts.join(', ');
  const samples = summary.samplePaths.length > 0 ? ` (${summary.samplePaths.join(', ')})` : '';
  return `${label}${samples}`;
}

export async function buildWorkspaceReviewContext(
  rootDir: string,
  summary: WorkspaceMutationSummary,
): Promise<string> {
  if (!summary.changed) {
    return '';
  }

  const candidatePaths = [...summary.added, ...summary.modified].slice(0, MAX_REVIEW_FILES);
  const sections: string[] = [];

  for (const relativePath of candidatePaths) {
    const fullPath = path.join(rootDir, relativePath);
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES_FOR_REVIEW) {
      continue;
    }

    let content: string;
    try {
      content = await readFile(fullPath, 'utf8');
    } catch {
      continue;
    }

    if (looksBinary(content)) {
      continue;
    }

    const excerpt = content.length > MAX_FILE_CHARS_FOR_REVIEW
      ? content.slice(0, MAX_FILE_CHARS_FOR_REVIEW) + '\n...'
      : content;

    sections.push(`### ${relativePath}\n\`\`\`\n${excerpt}\n\`\`\``);
  }

  return sections.join('\n\n');
}

function shouldSkipEntry(name: string, relativePath: string, isDirectory: boolean): boolean {
  if (!isDirectory) {
    return false;
  }

  if (EXCLUDED_DIR_NAMES.has(name)) {
    return true;
  }

  const segments = normalizeRelativePath(relativePath).split('/');
  return segments.some((segment) => EXCLUDED_DIR_NAMES.has(segment));
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function looksBinary(content: string): boolean {
  return content.includes('\u0000');
}
