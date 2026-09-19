import { stripDiffSidePrefix, unquoteGitPath } from "./gitPathQuoting.ts";
import type { DiffChange, DiffHunk } from "./types.ts";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** The last `"…"` token on a `diff --git` line — the new-side path when quoted. */
const TRAILING_QUOTED = / ("(?:[^"\\]|\\.)*")$/;

export type ParsedUnifiedDiff = {
  hunksByPath: Map<string, DiffHunk[]>;
  /** Paths whose unified diff is a binary marker (no text hunks). */
  binaryPaths: Set<string>;
};

/**
 * Parse `git diff --unified=0` (or any unified diff) into hunks keyed by new-side path.
 * Binary file markers yield an empty hunk list and are recorded in `binaryPaths`.
 *
 * `knownPaths` (the paths the status lines already reported) disambiguates a
 * `diff --git a/… b/…` header whose unquoted names contain spaces.
 */
export function parseUnifiedDiff(
  output: string,
  knownPaths: Iterable<string> = [],
): ParsedUnifiedDiff {
  const byPath = new Map<string, DiffHunk[]>();
  const binaryPaths = new Set<string>();
  const known = new Set(knownPaths);
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

    // Hunk bodies always start with `+`, `-`, ` ` or `\`, so this is a header.
    const gitPath = pathFromDiffGitLine(line, known);
    if (gitPath !== undefined) {
      flushPath();
      currentPath = gitPath;
      hunks = [];
      currentHunk = undefined;
      continue;
    }

    // Only before the first hunk: inside one, `+++ x` is an added line.
    // These lines beat the `diff --git` guess — they delimit the path with a tab.
    if (!currentHunk && (line.startsWith("+++ ") || line.startsWith("--- "))) {
      const headerPath = pathFromPlusMinusLine(line);
      if (headerPath !== undefined) {
        currentPath = headerPath;
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

/**
 * New-side path of a `diff --git a/x b/x` header.
 * Unquoted names may contain spaces, so `a/… b/…` has no unique split; each
 * strategy below narrows that down before the last-resort greedy match.
 */
function pathFromDiffGitLine(line: string, knownPaths: ReadonlySet<string>): string | undefined {
  if (!line.startsWith("diff --git ")) {
    return undefined;
  }
  const body = line.slice("diff --git ".length);

  // Quoted new side: `diff --git "a/qu\"ote.txt" "b/qu\"ote.txt"`.
  const quoted = TRAILING_QUOTED.exec(body);
  if (quoted) {
    return stripDiffSidePrefix(unquoteGitPath(quoted[1]!));
  }

  // Both sides equal (everything but a rename), so the header splits down the middle.
  const half = (body.length - "a/".length - " b/".length) / 2;
  if (Number.isInteger(half) && half > 0) {
    const candidate = body.slice("a/".length, "a/".length + half);
    if (body === `a/${candidate} b/${candidate}`) {
      return candidate;
    }
  }

  // A rename whose names hold spaces: the status lines already named both sides.
  for (let at = body.indexOf(" b/"); at >= 0; at = body.indexOf(" b/", at + 1)) {
    const candidate = body.slice(at + " b/".length);
    if (knownPaths.has(candidate)) {
      return candidate;
    }
  }

  const match = /^a\/(.+) b\/(.+)$/.exec(body);
  return match?.[2];
}

function pathFromPlusMinusLine(line: string): string | undefined {
  // `+++ b/path` / `--- a/path` / `+++ /dev/null`.
  // Git appends a tab (and optional metadata) when the path contains a space;
  // a tab inside a real name is escaped, so the first tab always ends the path.
  const rest = line.slice(4);
  const tab = rest.indexOf("\t");
  const token = tab >= 0 ? rest.slice(0, tab) : rest;
  if (token === "/dev/null") {
    return undefined;
  }
  return stripDiffSidePrefix(unquoteGitPath(token));
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
