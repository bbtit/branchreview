import { parseDiffStatus } from "./parseDiffStatus.ts";
import { parseUnifiedDiff } from "./parseUnifiedDiff.ts";
import type { ChangedFile, DiffHunk, GitDiff } from "./types.ts";

/**
 * Build the §18 ChangedFile list from per-file status lines plus a unified diff.
 */
export function buildChangedFiles(statusOutput: string, unifiedDiffOutput: string): ChangedFile[] {
  const entries = parseDiffStatus(statusOutput);
  // The status lines are the authority on paths; the patch headers are ambiguous
  // when an unquoted name contains a space.
  const knownPaths: string[] = [];
  for (const entry of entries) {
    knownPaths.push(entry.path);
    if (entry.oldPath !== undefined) {
      knownPaths.push(entry.oldPath);
    }
  }
  const { hunksByPath, binaryPaths } = parseUnifiedDiff(unifiedDiffOutput, knownPaths);

  return entries.map((entry) => {
    const hunks = hunksForEntry(entry.path, entry.oldPath, hunksByPath);
    const { additions, deletions } = countLineChanges(hunks);
    const binary =
      binaryPaths.has(entry.path) ||
      (entry.oldPath !== undefined && binaryPaths.has(entry.oldPath));
    const file: ChangedFile = {
      path: entry.path,
      status: entry.status,
      additions,
      deletions,
      hunks,
    };
    if (entry.oldPath !== undefined) {
      file.oldPath = entry.oldPath;
    }
    if (binary) {
      file.binary = true;
    }
    return file;
  });
}

export function buildGitDiff(
  base: string,
  head: string,
  statusOutput: string,
  unifiedDiffOutput: string,
): GitDiff {
  return {
    base,
    head,
    files: buildChangedFiles(statusOutput, unifiedDiffOutput),
  };
}

/**
 * Split `git diff --raw --unified=0` output: raw status lines come first,
 * then the patch starting at the first `diff --git` header.
 */
export function splitRawStatusAndPatch(output: string): { status: string; patch: string } {
  const patchStart = /^diff --git /m.exec(output);
  if (!patchStart) {
    return { status: output, patch: "" };
  }
  return {
    status: output.slice(0, patchStart.index),
    patch: output.slice(patchStart.index),
  };
}

function hunksForEntry(
  path: string,
  oldPath: string | undefined,
  hunksByPath: Map<string, DiffHunk[]>,
): DiffHunk[] {
  return (
    hunksByPath.get(path) ?? (oldPath !== undefined ? hunksByPath.get(oldPath) : undefined) ?? []
  );
}

function countLineChanges(hunks: DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (change.type === "add") {
        additions += 1;
      } else if (change.type === "delete") {
        deletions += 1;
      }
    }
  }
  return { additions, deletions };
}
