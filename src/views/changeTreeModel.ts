import type { ChangedFile, FileChangeStatus } from "../diff/types.ts";

/** Snapshot the Changes Tree renders (no VS Code types). */
export type ChangesTreeSnapshot = {
  overlayActive: boolean;
  base?: string;
  files: readonly ChangedFile[];
};

export type ChangesTreeRow =
  | { kind: "message"; id: string; label: string; description?: string }
  | { kind: "base"; id: string; label: string; description?: string }
  | {
      kind: "file";
      id: string;
      path: string;
      status: FileChangeStatus;
      label: string;
      description: string;
      /** Deleted files must not open an editor (D12). */
      openable: boolean;
      binary: boolean;
    };

/**
 * Flatten a review snapshot into ordered tree rows.
 * Overlay off → one guidance row; on → base header then file rows.
 */
export function changesTreeRowsFromSnapshot(snapshot: ChangesTreeSnapshot): ChangesTreeRow[] {
  if (!snapshot.overlayActive || !snapshot.base) {
    return [
      {
        kind: "message",
        id: "overlay-off",
        label: "Review is off",
        description: "Set Base or Resume Review",
      },
    ];
  }

  const rows: ChangesTreeRow[] = [
    {
      kind: "base",
      id: `base:${snapshot.base}`,
      label: `Base: ${snapshot.base}`,
    },
  ];

  if (snapshot.files.length === 0) {
    rows.push({
      kind: "message",
      id: "no-changes",
      label: "No changes",
      description: `${snapshot.base}...HEAD`,
    });
    return rows;
  }

  for (const file of snapshot.files) {
    rows.push(fileRowFromChangedFile(file));
  }
  return rows;
}

export function fileRowFromChangedFile(
  file: ChangedFile,
): Extract<ChangesTreeRow, { kind: "file" }> {
  const letter = statusLetter(file.status);
  const binary = file.binary === true;
  const openable = file.status !== "deleted";
  return {
    kind: "file",
    id: `file:${file.path}`,
    path: file.path,
    status: file.status,
    label: `${letter} ${file.path}`,
    description: formatFileStats(file),
    openable,
    binary,
  };
}

export function statusLetter(status: FileChangeStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
  }
}

/** `+12 -4`, `binary`, or rename hint — shown as TreeItem description. */
export function formatFileStats(file: ChangedFile): string {
  if (file.binary) {
    return "binary";
  }
  if (file.status === "renamed" && file.oldPath) {
    const stats = formatPlusMinus(file.additions, file.deletions);
    return stats ? `${file.oldPath} → · ${stats}` : `${file.oldPath} →`;
  }
  return formatPlusMinus(file.additions, file.deletions);
}

function formatPlusMinus(additions: number, deletions: number): string {
  if (additions === 0 && deletions === 0) {
    return "";
  }
  const parts: string[] = [];
  if (additions > 0) {
    parts.push(`+${additions}`);
  }
  if (deletions > 0) {
    parts.push(`-${deletions}`);
  }
  return parts.join(" ");
}
