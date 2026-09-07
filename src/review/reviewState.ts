/**
 * Persisted + runtime review session state per Git repository.
 * Overlay starts OFF on activation even when a base is remembered (D3).
 */

export type PersistedRepoReview = {
  /** Last successful base revision; absent after Clear Base. */
  base?: string;
  /**
   * Reviewed file paths for (repo, base, branch) — filled in MVP-09.
   * Clear Base must wipe this (D14); hook lives here early.
   */
  reviewedPaths: string[];
};

export type RuntimeRepoReview = {
  overlayActive: boolean;
  /** Branch name when overlay was turned on; used to auto-Stop on checkout (D5). */
  branchWhenStarted: string | null;
};

export type RepoReviewSnapshot = PersistedRepoReview & RuntimeRepoReview;

export const WORKSPACE_STATE_KEY = "sidediff.repoReviews";

export type PersistedReviewMap = Record<string, PersistedRepoReview>;

export function emptyPersistedRepoReview(): PersistedRepoReview {
  return { reviewedPaths: [] };
}

export function emptyRuntimeRepoReview(): RuntimeRepoReview {
  return { overlayActive: false, branchWhenStarted: null };
}

export function loadPersistedMap(raw: unknown): PersistedReviewMap {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result: PersistedReviewMap = {};
  for (const [root, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const record = value as Record<string, unknown>;
    const reviewedPaths = Array.isArray(record.reviewedPaths)
      ? record.reviewedPaths.filter((p): p is string => typeof p === "string")
      : [];
    const base =
      typeof record.base === "string" && record.base.length > 0 ? record.base : undefined;
    result[root] = { base, reviewedPaths };
  }
  return result;
}

/** Stop Review: overlay OFF, base kept (D4). */
export function stopOverlay(_runtime: RuntimeRepoReview): RuntimeRepoReview {
  return { overlayActive: false, branchWhenStarted: null };
}

/** Clear Base: drop base + reviewed progress; overlay OFF (D14). */
export function clearPersistedReview(_previous: PersistedRepoReview): PersistedRepoReview {
  return emptyPersistedRepoReview();
}

/**
 * Status bar label (D11, D2 dirty hint).
 * Examples: `SideDiff: origin/main`, `SideDiff: off`, `SideDiff: origin/main · local changes`
 */
export function formatStatusBarText(options: {
  overlayActive: boolean;
  base?: string;
  dirty: boolean;
}): string {
  if (!options.overlayActive) {
    return options.dirty ? "SideDiff: off · local changes" : "SideDiff: off";
  }
  const base = options.base ?? "(no base)";
  return options.dirty ? `SideDiff: ${base} · local changes` : `SideDiff: ${base}`;
}

export function formatStatusBarTooltip(options: {
  overlayActive: boolean;
  base?: string;
  branch: string | null;
  dirty: boolean;
  repoRoot?: string;
}): string {
  const lines: string[] = [];
  if (options.overlayActive) {
    lines.push(`Reviewing against ${options.base ?? "(none)"}`);
  } else if (options.base) {
    lines.push(`Overlay off · base remembered: ${options.base} (Resume Review)`);
  } else {
    lines.push("Overlay off · no base set");
  }
  if (options.branch) {
    lines.push(`Branch: ${options.branch}`);
  } else if (options.branch === null && options.repoRoot) {
    lines.push("Detached HEAD — check out a branch to review");
  }
  if (options.dirty) {
    lines.push("Working tree has local changes (gutter stays base…HEAD)");
  }
  if (options.repoRoot) {
    lines.push(options.repoRoot);
  }
  return lines.join("\n");
}
