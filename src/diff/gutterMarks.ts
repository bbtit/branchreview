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
 */
export function gutterMarksFromHunks(hunks: readonly DiffHunk[]): GutterMark[] {
  const marks: GutterMark[] = [];

  for (const hunk of hunks) {
    const adds = hunk.changes.filter((c) => c.type === "add");
    const deletes = hunk.changes.filter((c) => c.type === "delete");

    if (adds.length > 0 && deletes.length > 0) {
      for (const change of adds) {
        if (change.newLine !== undefined && change.newLine > 0) {
          marks.push({ kind: "change", line: change.newLine });
        }
      }
      continue;
    }

    if (adds.length > 0) {
      for (const change of adds) {
        if (change.newLine !== undefined && change.newLine > 0) {
          marks.push({ kind: "add", line: change.newLine });
        }
      }
      continue;
    }

    if (deletes.length > 0) {
      const line = deleteAnchorLine(hunk.newStart);
      marks.push({ kind: "delete", line });
    }
  }

  return dedupeMarks(marks);
}

/**
 * Adjacent remaining line for a delete-only hunk (D8).
 * Git's `+newStart,0` is the line after which deleted lines would have appeared.
 */
export function deleteAnchorLine(newStart: number): number {
  return newStart > 0 ? newStart : 1;
}

function dedupeMarks(marks: GutterMark[]): GutterMark[] {
  const byLine = new Map<number, GutterKind>();
  for (const mark of marks) {
    const existing = byLine.get(mark.line);
    if (!existing) {
      byLine.set(mark.line, mark.kind);
      continue;
    }
    byLine.set(mark.line, strongerKind(existing, mark.kind));
  }
  return [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([line, kind]) => ({ line, kind }));
}

function strongerKind(a: GutterKind, b: GutterKind): GutterKind {
  const rank: Record<GutterKind, number> = { delete: 0, add: 1, change: 2 };
  return rank[b] > rank[a] ? b : a;
}
