import type { FileChangeStatus } from "./types.ts";

export type NameStatusEntry = {
  status: FileChangeStatus;
  path: string;
  oldPath?: string;
};

/**
 * Parse `git diff --name-status` output into file entries.
 * Rename/copy lines are `R100\told\tnew` / `C100\told\tnew`.
 */
export function parseNameStatus(output: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    const tab = line.indexOf("\t");
    if (tab <= 0) {
      continue;
    }

    const code = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    const paths = rest.split("\t");

    if (code.startsWith("R") && paths.length >= 2) {
      entries.push({
        status: "renamed",
        oldPath: paths[0],
        path: paths[1]!,
      });
      continue;
    }

    if (code.startsWith("C") && paths.length >= 2) {
      // Copy: treat as added at the destination path (§18 has no "copied").
      entries.push({
        status: "added",
        path: paths[1]!,
      });
      continue;
    }

    const path = paths[0];
    if (!path) {
      continue;
    }

    const status = statusFromCode(code);
    if (!status) {
      continue;
    }

    entries.push({ status, path });
  }
  return entries;
}

function statusFromCode(code: string): FileChangeStatus | undefined {
  switch (code[0]) {
    case "A":
      return "added";
    case "M":
    case "T":
      return "modified";
    case "D":
      return "deleted";
    default:
      return undefined;
  }
}
