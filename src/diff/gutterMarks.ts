import type { DiffHunk } from "./types.ts";

export type GutterKind = "add" | "change" | "delete";

/** One gutter mark on the HEAD / buffer document (1-based line). */
export type GutterMark = {
  kind: GutterKind;
  line: number;
};

/**
 * Map §18 hunks to ADD / CHANGE / DELETE gutter marks (D8 for deletes).
 * Line numbers are 1-based on the new (HEAD) side.
 * Hover text is attached once per hunk (`hunkHoversFromHunks`), not per mark.
 */
export function gutterMarksFromHunks(hunks: readonly DiffHunk[]): GutterMark[] {
  const marks: GutterMark[] = [];

  for (const hunk of hunks) {
    const marked = markedLinesForHunk(hunk);
    if (!marked) {
      continue;
    }
    for (const line of marked.lines) {
      marks.push({ kind: marked.kind, line });
    }
  }

  return dedupeMarks(marks);
}

/**
 * HEAD-side lines a hunk marks in the gutter, in ascending order.
 * Adds mark each new line (`change` when the hunk also deletes);
 * delete-only hunks mark the adjacent remaining line (D8).
 */
export function markedLinesForHunk(
  hunk: DiffHunk,
): { kind: GutterKind; lines: number[] } | undefined {
  let addCount = 0;
  let hasDelete = false;
  const addLines: number[] = [];

  for (const change of hunk.changes) {
    if (change.type === "add") {
      addCount += 1;
      if (change.newLine !== undefined && change.newLine > 0) {
        addLines.push(change.newLine);
      }
    } else if (change.type === "delete") {
      hasDelete = true;
    }
  }

  if (addCount > 0) {
    return { kind: hasDelete ? "change" : "add", lines: addLines };
  }
  if (hasDelete) {
    return { kind: "delete", lines: [deleteAnchorLine(hunk.newStart)] };
  }
  return undefined;
}

/**
 * Adjacent remaining line for a delete-only hunk (D8).
 * Git's `+newStart,0` is the line after which deleted lines would have appeared.
 */
export function deleteAnchorLine(newStart: number): number {
  return newStart > 0 ? newStart : 1;
}

function dedupeMarks(marks: GutterMark[]): GutterMark[] {
  const byLine = new Map<number, GutterMark>();
  for (const mark of marks) {
    const existing = byLine.get(mark.line);
    if (!existing) {
      byLine.set(mark.line, mark);
      continue;
    }
    if (strongerKind(existing.kind, mark.kind) === mark.kind) {
      byLine.set(mark.line, mark);
    }
  }
  return [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([, mark]) => mark);
}

function strongerKind(a: GutterKind, b: GutterKind): GutterKind {
  const rank: Record<GutterKind, number> = { delete: 0, add: 1, change: 2 };
  return rank[b] > rank[a] ? b : a;
}
