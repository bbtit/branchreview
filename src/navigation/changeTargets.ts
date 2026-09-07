import { deleteAnchorLine } from "../diff/gutterMarks.ts";
import type { ChangedFile, DiffHunk } from "../diff/types.ts";

/** One navigable change (hunk) on the HEAD side. Line is 1-based. */
export type ChangeTarget = {
  path: string;
  line: number;
};

/**
 * Flatten `base...HEAD` files into ordered hunk targets for Next/Previous.
 * Deleted files are skipped (no buffer to open). File order follows `files`.
 */
export function changeTargetsFromFiles(files: readonly ChangedFile[]): ChangeTarget[] {
  const targets: ChangeTarget[] = [];
  for (const file of files) {
    if (file.status === "deleted") {
      continue;
    }
    for (const hunk of file.hunks) {
      const line = hunkAnchorLine(hunk);
      if (line !== undefined) {
        targets.push({ path: file.path, line });
      }
    }
  }
  return targets;
}

/** First HEAD-side line for a hunk (same anchors as gutter marks). */
export function hunkAnchorLine(hunk: DiffHunk): number | undefined {
  const adds = hunk.changes.filter((c) => c.type === "add");
  const deletes = hunk.changes.filter((c) => c.type === "delete");

  if (adds.length > 0) {
    for (const change of adds) {
      if (change.newLine !== undefined && change.newLine > 0) {
        return change.newLine;
      }
    }
  }

  if (deletes.length > 0) {
    return deleteAnchorLine(hunk.newStart);
  }

  return undefined;
}

/**
 * Next change after the cursor, wrapping from last → first (D7).
 * When `current` is omitted, returns the first target.
 */
export function findNextChangeTarget(
  targets: readonly ChangeTarget[],
  current: { path: string; line: number } | undefined,
): ChangeTarget | undefined {
  if (targets.length === 0) {
    return undefined;
  }
  if (!current) {
    return targets[0];
  }

  const rank = pathRankMap(targets);
  const after = targets.find((t) => compareTargetToCursor(t, current, rank) > 0);
  return after ?? targets[0];
}

/**
 * Previous change before the cursor, wrapping from first → last (D7).
 * When `current` is omitted, returns the last target.
 */
export function findPreviousChangeTarget(
  targets: readonly ChangeTarget[],
  current: { path: string; line: number } | undefined,
): ChangeTarget | undefined {
  if (targets.length === 0) {
    return undefined;
  }
  if (!current) {
    return targets[targets.length - 1];
  }

  const rank = pathRankMap(targets);
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i]!;
    if (compareTargetToCursor(t, current, rank) < 0) {
      return t;
    }
  }
  return targets[targets.length - 1];
}

function pathRankMap(targets: readonly ChangeTarget[]): Map<string, number> {
  const rank = new Map<string, number>();
  let next = 0;
  for (const t of targets) {
    if (!rank.has(t.path)) {
      rank.set(t.path, next++);
    }
  }
  return rank;
}

/**
 * Negative if target is before cursor, 0 if same, positive if after.
 * Paths not in the change list get an insertion rank among known paths.
 */
function compareTargetToCursor(
  target: ChangeTarget,
  cursor: { path: string; line: number },
  rank: Map<string, number>,
): number {
  const targetRank = rank.get(target.path) ?? 0;
  const cursorRank = rankForPath(cursor.path, rank);
  if (targetRank !== cursorRank) {
    return targetRank - cursorRank;
  }
  return target.line - cursor.line;
}

function rankForPath(path: string, rank: Map<string, number>): number {
  const existing = rank.get(path);
  if (existing !== undefined) {
    return existing;
  }
  const ordered = [...rank.entries()].sort((a, b) => a[1] - b[1]).map(([p]) => p);
  let insertAt = ordered.findIndex((p) => p.localeCompare(path) > 0);
  if (insertAt === -1) {
    insertAt = ordered.length;
  }
  return insertAt - 0.5;
}
