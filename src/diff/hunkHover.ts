import type { DiffHunk } from "./types.ts";

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
