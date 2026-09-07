import type { DiffChange, DiffHunk } from "./types.ts";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export type ParsedUnifiedDiff = {
  hunksByPath: Map<string, DiffHunk[]>;
  /** Paths whose unified diff is a binary marker (no text hunks). */
  binaryPaths: Set<string>;
};

/**
 * Parse `git diff --unified=0` (or any unified diff) into hunks keyed by new-side path.
 * Binary file markers yield an empty hunk list and are recorded in `binaryPaths`.
 */
export function parseUnifiedDiff(output: string): ParsedUnifiedDiff {
  const byPath = new Map<string, DiffHunk[]>();
  const binaryPaths = new Set<string>();
  let currentPath: string | undefined;
  let hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  const flushPath = (): void => {
    if (currentPath !== undefined) {
      byPath.set(currentPath, hunks);
    }
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine;

    const gitPath = pathFromDiffGitLine(line);
    if (gitPath !== undefined) {
      flushPath();
      currentPath = gitPath;
      hunks = [];
      currentHunk = undefined;
      continue;
    }

    if (line.startsWith("+++ ")) {
      const fromPlus = pathFromPlusMinusLine(line);
      if (fromPlus !== undefined) {
        currentPath = fromPlus;
      }
      continue;
    }

    if (line.startsWith("Binary files ") && line.includes(" and ") && line.endsWith(" differ")) {
      // Keep path with empty hunks; caller still sees the file via name-status.
      if (currentPath !== undefined) {
        binaryPaths.add(currentPath);
      }
      currentHunk = undefined;
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      const oldStart = Number(hunkMatch[1]);
      const oldLines = hunkMatch[2] !== undefined ? Number(hunkMatch[2]) : 1;
      const newStart = Number(hunkMatch[3]);
      const newLines = hunkMatch[4] !== undefined ? Number(hunkMatch[4]) : 1;
      currentHunk = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        changes: [],
      };
      hunks.push(currentHunk);
      oldLine = oldStart;
      newLine = newStart;
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("\\")) {
      // "\ No newline at end of file" — ignore.
      continue;
    }

    const change = changeFromDiffLine(line, oldLine, newLine);
    if (!change) {
      continue;
    }
    currentHunk.changes.push(change);
    if (change.type === "add") {
      newLine += 1;
    } else if (change.type === "delete") {
      oldLine += 1;
    } else {
      oldLine += 1;
      newLine += 1;
    }
  }

  flushPath();
  return { hunksByPath: byPath, binaryPaths };
}

function pathFromDiffGitLine(line: string): string | undefined {
  // diff --git a/path b/path  (paths may contain spaces when quoted — keep simple MVP)
  if (!line.startsWith("diff --git ")) {
    return undefined;
  }
  const body = line.slice("diff --git ".length);
  const match = /^a\/(.+) b\/(.+)$/.exec(body);
  if (!match) {
    return undefined;
  }
  // Prefer new-side path (b/).
  return match[2];
}

function pathFromPlusMinusLine(line: string): string | undefined {
  // +++ b/path  /  +++ /dev/null
  const rest = line.slice(4);
  if (rest === "/dev/null") {
    return undefined;
  }
  if (rest.startsWith("b/")) {
    return rest.slice(2);
  }
  return rest;
}

function changeFromDiffLine(
  line: string,
  oldLine: number,
  newLine: number,
): DiffChange | undefined {
  if (line.length === 0) {
    return undefined;
  }
  const marker = line[0];
  const content = line.slice(1);
  if (marker === "+") {
    return { type: "add", newLine, content };
  }
  if (marker === "-") {
    return { type: "delete", oldLine, content };
  }
  if (marker === " ") {
    return { type: "context", oldLine, newLine, content };
  }
  return undefined;
}
