import { parseNameStatus } from "./parseNameStatus.ts";
import { parseUnifiedDiff } from "./parseUnifiedDiff.ts";
import type { ChangedFile, DiffHunk, GitDiff } from "./types.ts";

/**
 * Build §18 ChangedFile list from `git diff --name-status` + `git diff --unified=0`.
 */
export function buildChangedFiles(
  nameStatusOutput: string,
  unifiedDiffOutput: string,
): ChangedFile[] {
  const entries = parseNameStatus(nameStatusOutput);
  const { hunksByPath, binaryPaths } = parseUnifiedDiff(unifiedDiffOutput);

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
  nameStatusOutput: string,
  unifiedDiffOutput: string,
): GitDiff {
  return {
    base,
    head,
    files: buildChangedFiles(nameStatusOutput, unifiedDiffOutput),
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
