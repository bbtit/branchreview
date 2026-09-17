import type { ChangedFile, FileChangeStatus } from "../diff/types.ts";
import { countReviewedProgress } from "../review/reviewState.ts";

/** Snapshot the Changes Tree renders (no VS Code types). */
export type ChangesTreeSnapshot = {
  overlayActive: boolean;
  base?: string;
  files: readonly ChangedFile[];
  /** Reviewed paths for the current `(base, branch)` session (D10). */
  reviewedPaths?: readonly string[];
  /** Why `base...HEAD` could not be loaded; shown instead of the file list. */
  error?: string;
};

export type ChangesTreeRow =
  | { kind: "message"; id: string; label: string; description?: string }
  | { kind: "base"; id: string; label: string; description?: string }
  | {
      kind: "progress";
      id: string;
      label: string;
      description: string;
      reviewed: number;
      total: number;
    }
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
      reviewed: boolean;
    };

/**
 * Flatten a review snapshot into ordered tree rows.
 * Overlay off → one guidance row; on → base, progress, then file rows.
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

  const reviewedPaths = snapshot.reviewedPaths ?? [];
  const reviewedSet = new Set(reviewedPaths);

  const rows: ChangesTreeRow[] = [
    {
      kind: "base",
      id: `base:${snapshot.base}`,
      label: `Base: ${snapshot.base}`,
    },
  ];

  if (snapshot.error) {
    rows.push({
      kind: "message",
      id: "diff-error",
      label: "Could not load changes",
      description: snapshot.error,
    });
    return rows;
  }

  if (snapshot.files.length === 0) {
    rows.push({
      kind: "message",
      id: "no-changes",
      label: "No changes",
      description: `${snapshot.base}...HEAD`,
    });
    return rows;
  }

  const { reviewed, total } = countReviewedProgress(
    snapshot.files.map((f) => f.path),
    reviewedPaths,
  );
  rows.push({
    kind: "progress",
    id: "progress",
    label: "Review Progress",
    description: `${reviewed} / ${total} files reviewed`,
    reviewed,
    total,
  });

  for (const file of snapshot.files) {
    rows.push(fileRowFromChangedFile(file, reviewedSet.has(file.path)));
  }
  return rows;
}

export function fileRowFromChangedFile(
  file: ChangedFile,
  reviewed = false,
): Extract<ChangesTreeRow, { kind: "file" }> {
  const letter = statusLetter(file.status);
  const binary = file.binary === true;
  const openable = file.status !== "deleted";
  const check = reviewed ? "✓ " : "";
  return {
    kind: "file",
    id: `file:${file.path}`,
    path: file.path,
    status: file.status,
    label: `${check}${letter} ${file.path}`,
    description: formatFileStats(file),
    openable,
    binary,
    reviewed,
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
