/**
 * Persisted + runtime review session state per Git repository.
 * Overlay starts OFF on activation even when a base is remembered (D3).
 */

export type PersistedRepoReview = {
  /** Last successful base revision; absent after Clear Base. */
  base?: string;
  /**
   * Reviewed file paths keyed by `(base, branch)` within this repo (D10).
   * Clear Base must wipe this (D14).
   */
  reviewedBySession: Record<string, string[]>;
};

export type RuntimeRepoReview = {
  overlayActive: boolean;
  /** Branch name when overlay was turned on; used to auto-Stop on checkout (D5). */
  branchWhenStarted: string | null;
};

export type RepoReviewSnapshot = PersistedRepoReview & RuntimeRepoReview;

export const WORKSPACE_STATE_KEY = "sidediff.repoReviews";

export type PersistedReviewMap = Record<string, PersistedRepoReview>;

/** Stable storage key for reviewed paths under a repo (D10). */
export function reviewSessionKey(base: string, branch: string): string {
  return `${base}\0${branch}`;
}

export function emptyPersistedRepoReview(): PersistedRepoReview {
  return { reviewedBySession: {} };
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
    const base =
      typeof record.base === "string" && record.base.length > 0 ? record.base : undefined;
    result[root] = {
      base,
      reviewedBySession: loadReviewedBySession(record.reviewedBySession),
    };
  }
  return result;
}

function loadReviewedBySession(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [key, paths] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(paths)) {
      continue;
    }
    result[key] = paths.filter((p): p is string => typeof p === "string");
  }
  return result;
}

/** Reviewed paths for `(base, branch)`; empty when base/branch missing. */
export function getReviewedPaths(
  persisted: PersistedRepoReview,
  base: string | undefined,
  branch: string | null | undefined,
): string[] {
  if (!base || !branch) {
    return [];
  }
  return persisted.reviewedBySession[reviewSessionKey(base, branch)] ?? [];
}

/** Mark a path reviewed under `(base, branch)` (idempotent). */
export function markPathReviewed(
  persisted: PersistedRepoReview,
  base: string,
  branch: string,
  path: string,
): PersistedRepoReview {
  const key = reviewSessionKey(base, branch);
  const current = persisted.reviewedBySession[key] ?? [];
  if (current.includes(path)) {
    return persisted;
  }
  return {
    ...persisted,
    reviewedBySession: {
      ...persisted.reviewedBySession,
      [key]: [...current, path],
    },
  };
}

/** Mark a path unreviewed under `(base, branch)`. */
export function markPathUnreviewed(
  persisted: PersistedRepoReview,
  base: string,
  branch: string,
  path: string,
): PersistedRepoReview {
  const key = reviewSessionKey(base, branch);
  const current = persisted.reviewedBySession[key];
  if (!current || !current.includes(path)) {
    return persisted;
  }
  const next = current.filter((p) => p !== path);
  const reviewedBySession = { ...persisted.reviewedBySession };
  if (next.length === 0) {
    delete reviewedBySession[key];
  } else {
    reviewedBySession[key] = next;
  }
  return { ...persisted, reviewedBySession };
}

/** How many changed files are reviewed (progress numerator / denominator). */
export function countReviewedProgress(
  changedPaths: readonly string[],
  reviewedPaths: readonly string[],
): { reviewed: number; total: number } {
  const reviewedSet = new Set(reviewedPaths);
  let reviewed = 0;
  for (const path of changedPaths) {
    if (reviewedSet.has(path)) {
      reviewed += 1;
    }
  }
  return { reviewed, total: changedPaths.length };
}

/** Stop Review: overlay OFF, base kept (D4). */
export function stopOverlay(_runtime: RuntimeRepoReview): RuntimeRepoReview {
  return { overlayActive: false, branchWhenStarted: null };
}

/** Clear Base: drop base + reviewed progress; overlay OFF (D14). */
export function clearPersistedReview(_previous: PersistedRepoReview): PersistedRepoReview {
  return emptyPersistedRepoReview();
}

/** Clear All Review Progress for This Repository: drop all session progress; keep base (D22). */
export function clearReviewedProgress(previous: PersistedRepoReview): PersistedRepoReview {
  return { base: previous.base, reviewedBySession: {} };
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
