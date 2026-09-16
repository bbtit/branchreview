import { expect, test } from "vite-plus/test";
import {
  clearPersistedReview,
  clearReviewedProgress,
  countReviewedProgress,
  emptyPersistedRepoReview,
  emptyRuntimeRepoReview,
  formatStatusBarText,
  formatStatusBarTooltip,
  getReviewedPaths,
  loadPersistedMap,
  markPathReviewed,
  markPathUnreviewed,
  reviewSessionKey,
  stopOverlay,
} from "../src/review/reviewState.ts";

test("loads a saved base and session-keyed reviewed paths from workspace state", () => {
  const key = reviewSessionKey("origin/main", "feature/x");
  const map = loadPersistedMap({
    "/repo": {
      base: "origin/main",
      reviewedBySession: { [key]: ["src/a.ts"] },
    },
    "/broken": null,
  });

  expect(map["/repo"]).toEqual({
    base: "origin/main",
    reviewedBySession: { [key]: ["src/a.ts"] },
  });
  expect(map["/broken"]).toBeUndefined();
});

test("treats missing or empty storage as no remembered reviews", () => {
  expect(loadPersistedMap(undefined)).toEqual({});
  expect(loadPersistedMap("nope")).toEqual({});
});

test("stopping a review turns overlay off without touching persisted base", () => {
  const stopped = stopOverlay({
    overlayActive: true,
    branchWhenStarted: "feature/x",
  });
  expect(stopped).toEqual({ overlayActive: false, branchWhenStarted: null });
});

test("clearing a review drops base and all reviewed progress (D14)", () => {
  const key = reviewSessionKey("origin/main", "feature/x");
  const cleared = clearPersistedReview({
    base: "origin/main",
    reviewedBySession: { [key]: ["src/a.ts"] },
  });
  expect(cleared).toEqual(emptyPersistedRepoReview());
  expect(cleared.base).toBeUndefined();
  expect(cleared.reviewedBySession).toEqual({});
});

test("clearing review progress drops all sessions but keeps base (D22)", () => {
  const keyA = reviewSessionKey("origin/main", "feature/x");
  const keyB = reviewSessionKey("develop", "feature/x");
  const cleared = clearReviewedProgress({
    base: "origin/main",
    reviewedBySession: {
      [keyA]: ["src/a.ts"],
      [keyB]: ["src/b.ts"],
    },
  });
  expect(cleared).toEqual({ base: "origin/main", reviewedBySession: {} });
});

test("reviewed paths are keyed by (base, branch) and survive HEAD-only advances (D10)", () => {
  let state = emptyPersistedRepoReview();
  state = { ...state, base: "origin/main" };
  state = markPathReviewed(state, "origin/main", "feature/x", "src/a.ts");
  state = markPathReviewed(state, "origin/main", "feature/x", "src/b.ts");

  expect(getReviewedPaths(state, "origin/main", "feature/x")).toEqual(["src/a.ts", "src/b.ts"]);
  // Same key after more commits on the same branch — progress kept.
  expect(getReviewedPaths(state, "origin/main", "feature/x")).toEqual(["src/a.ts", "src/b.ts"]);
  // Different branch → separate key.
  expect(getReviewedPaths(state, "origin/main", "other")).toEqual([]);
  // Different base → separate key.
  expect(getReviewedPaths(state, "main", "feature/x")).toEqual([]);
});

test("mark unreviewed removes a path; clear empties the session entry", () => {
  let state = markPathReviewed(emptyPersistedRepoReview(), "origin/main", "feature/x", "a.ts");
  state = markPathReviewed(state, "origin/main", "feature/x", "b.ts");
  state = markPathUnreviewed(state, "origin/main", "feature/x", "a.ts");
  expect(getReviewedPaths(state, "origin/main", "feature/x")).toEqual(["b.ts"]);
  state = markPathUnreviewed(state, "origin/main", "feature/x", "b.ts");
  expect(getReviewedPaths(state, "origin/main", "feature/x")).toEqual([]);
  expect(state.reviewedBySession).toEqual({});
});

test("progress counts intersection of changed files and reviewed paths", () => {
  expect(countReviewedProgress(["a.ts", "b.ts", "c.ts"], ["a.ts", "c.ts", "gone.ts"])).toEqual({
    reviewed: 2,
    total: 3,
  });
});

test("status bar shows base when overlay is on and off when it is not", () => {
  expect(formatStatusBarText({ overlayActive: true, base: "origin/main", dirty: false })).toBe(
    "SideDiff: origin/main",
  );
  expect(formatStatusBarText({ overlayActive: false, base: "origin/main", dirty: false })).toBe(
    "SideDiff: off",
  );
});

test("status bar mentions local changes while overlay is on", () => {
  expect(formatStatusBarText({ overlayActive: true, base: "origin/main", dirty: true })).toBe(
    "SideDiff: origin/main · local changes",
  );
});

test("status bar stays plain off because dirtiness is not tracked then", () => {
  expect(formatStatusBarText({ overlayActive: false, base: "origin/main", dirty: true })).toBe(
    "SideDiff: off",
  );
});

test("tooltip remembers base while overlay is off so Resume is discoverable", () => {
  const tip = formatStatusBarTooltip({
    overlayActive: false,
    base: "origin/main",
    branch: "feature/x",
    dirty: false,
    repoRoot: "/repo",
  });
  expect(tip).toContain("origin/main");
  expect(tip).toContain("Resume Review");
  expect(tip).toContain("feature/x");
});

test("fresh runtime state starts with overlay off", () => {
  expect(emptyRuntimeRepoReview()).toEqual({
    overlayActive: false,
    branchWhenStarted: null,
  });
});
