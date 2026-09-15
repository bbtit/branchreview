import { markedLinesForHunk } from "./gutterMarks.ts";
import type { DiffHunk } from "./types.ts";

/** Hover for one hunk over its gutter-marked HEAD lines (1-based, inclusive). */
export type HunkHover = {
  startLine: number;
  endLine: number;
  markdown: string;
};

/**
 * One hover per hunk. Repeating the hunk text on every marked line would grow
 * the decoration payload with lines × hunk size (a 2,000-line added file ≈ 225 MB).
 */
export function hunkHoversFromHunks(hunks: readonly DiffHunk[]): HunkHover[] {
  const hovers: HunkHover[] = [];
  for (const hunk of hunks) {
    const marked = markedLinesForHunk(hunk);
    if (!marked || marked.lines.length === 0) {
      continue;
    }
    hovers.push({
      startLine: marked.lines[0]!,
      endLine: marked.lines[marked.lines.length - 1]!,
      markdown: formatHunkHoverMarkdown(hunk),
    });
  }
  return hovers;
}

/**
 * Markdown body for a decoration hover: the hunk as a `diff` code fence.
 * Old/new lines only appear here — never injected into the editor buffer.
 */
export function formatHunkHoverMarkdown(hunk: DiffHunk): string {
  const lines: string[] = [];
  for (const change of hunk.changes) {
    if (change.type === "add") {
      lines.push(`+${change.content}`);
    } else if (change.type === "delete") {
      lines.push(`-${change.content}`);
    } else {
      lines.push(` ${change.content}`);
    }
  }

  if (lines.length === 0) {
    return "**SideDiff**\n\n_(no line changes in this hunk)_";
  }

  return `**SideDiff**\n\n\`\`\`diff\n${lines.join("\n")}\n\`\`\``;
}
