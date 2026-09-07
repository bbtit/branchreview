/** Internal diff model (requirements §18). */

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export type DiffChangeType = "add" | "delete" | "context";

export type DiffChange = {
  type: DiffChangeType;
  oldLine?: number;
  newLine?: number;
  content: string;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: DiffChange[];
};

export type ChangedFile = {
  path: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  /** Set when `status` is `renamed` (old path before rename). */
  oldPath?: string;
  /** True when Git reports a binary diff (no text hunks; skip decorations). */
  binary?: boolean;
};

export type GitDiff = {
  base: string;
  head: string;
  files: ChangedFile[];
};
