import { describe, it, expect } from "vitest";
import * as path from "node:path";

// Replicate the module-private resolveAndValidatePath for testing.

function resolveAndValidatePath(workDir: string, userPath: string): string {
  const resolved = path.resolve(workDir, userPath);
  const normalizedWorkDir = path.resolve(workDir);

  if (resolved !== normalizedWorkDir && !resolved.startsWith(normalizedWorkDir + path.sep)) {
    throw new Error(
      `Path traversal blocked: "${userPath}" resolves to "${resolved}" which is outside the workspace "${normalizedWorkDir}"`
    );
  }
  return resolved;
}

describe("resolveAndValidatePath (filesystem sandboxing)", () => {
  const workDir = "/tmp/hivemind-project";
  // On Windows, path.resolve("/tmp/hivemind-project") produces "D:\tmp\hivemind-project".
  // Use the resolved form in all assertions so tests pass cross-platform.
  const resolvedWorkDir = path.resolve(workDir);

  // ── Valid paths (should not throw) ──

  it("allows a simple relative path", () => {
    expect(resolveAndValidatePath(workDir, "src/index.ts")).toBe(
      path.resolve(workDir, "src/index.ts")
    );
  });

  it("allows the workDir itself", () => {
    expect(resolveAndValidatePath(workDir, ".")).toBe(resolvedWorkDir);
  });

  it("allows a nested relative path", () => {
    expect(resolveAndValidatePath(workDir, "a/b/c/d.txt")).toBe(
      path.resolve(workDir, "a/b/c/d.txt")
    );
  });

  it("allows a path with harmless internal ..", () => {
    expect(resolveAndValidatePath(workDir, "src/../lib/utils.ts")).toBe(
      path.resolve(workDir, "lib/utils.ts")
    );
  });

  // ── Traversal attacks (should throw) ──

  it("rejects ../../etc/passwd", () => {
    expect(() =>
      resolveAndValidatePath(workDir, "../../etc/passwd")
    ).toThrow("Path traversal blocked");
  });

  it("rejects ../../../etc/shadow", () => {
    expect(() =>
      resolveAndValidatePath(workDir, "../../../etc/shadow")
    ).toThrow("Path traversal blocked");
  });

  it("rejects absolute path outside workDir", () => {
    expect(() =>
      resolveAndValidatePath(workDir, "/etc/passwd")
    ).toThrow("Path traversal blocked");
  });

  it("rejects absolute path to root", () => {
    expect(() =>
      resolveAndValidatePath(workDir, "/")
    ).toThrow("Path traversal blocked");
  });

  it("rejects traversal that escapes via enough ../", () => {
    expect(() =>
      resolveAndValidatePath(workDir, "../../../../root/.ssh/id_rsa")
    ).toThrow("Path traversal blocked");
  });

  it("rejects path that looks similar but escapes (prefix attack)", () => {
    expect(() =>
      resolveAndValidatePath(workDir, "../hivemind-project-evil/secrets.txt")
    ).toThrow("Path traversal blocked");
  });

  it("rejects going up one level", () => {
    expect(() =>
      resolveAndValidatePath(workDir, "..")
    ).toThrow("Path traversal blocked");
  });

  it("rejects going up then into sibling", () => {
    expect(() =>
      resolveAndValidatePath(workDir, "../other-project/config.yaml")
    ).toThrow("Path traversal blocked");
  });
});
