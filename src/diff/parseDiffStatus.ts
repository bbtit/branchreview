import type { FileChangeStatus } from "./types.ts";

export type DiffStatusEntry = {
  status: FileChangeStatus;
  path: string;
  oldPath?: string;
};

/**
 * Parse per-file status lines into file entries.
 * Accepts `git diff --name-status` lines (`M\tpath`) and `git diff --raw` lines,
 * which prefix the status with `:<old mode> <new mode> <old sha> <new sha> `.
 * Rename/copy lines are `R100\told\tnew` / `C100\told\tnew`.
 */
export function parseDiffStatus(output: string): DiffStatusEntry[] {
  const entries: DiffStatusEntry[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    const tab = line.indexOf("\t");
    if (tab <= 0) {
      continue;
    }

    const code = statusCodeFromField(line.slice(0, tab));
    if (!code) {
      continue;
    }
    const paths = line.slice(tab + 1).split("\t");

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

/** `M` stays `M`; a raw field like `:100644 100644 abc def M` yields `M`. */
function statusCodeFromField(field: string): string | undefined {
  if (!field.startsWith(":")) {
    return field;
  }
  const fields = field.split(" ");
  return fields[fields.length - 1];
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
