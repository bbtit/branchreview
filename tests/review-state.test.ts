import { expect, test } from "vite-plus/test";
import {
  clearPersistedReview,
  emptyPersistedRepoReview,
  emptyRuntimeRepoReview,
  formatStatusBarText,
  formatStatusBarTooltip,
  loadPersistedMap,
  stopOverlay,
} from "../src/review/reviewState.ts";

test("loads a saved base and reviewed paths from workspace state", () => {
  const map = loadPersistedMap({
    "/repo": { base: "origin/main", reviewedPaths: ["src/a.ts"] },
    "/broken": null,
  });

  expect(map["/repo"]).toEqual({
    base: "origin/main",
    reviewedPaths: ["src/a.ts"],
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

test("clearing a review drops base and reviewed progress", () => {
  const cleared = clearPersistedReview({
    base: "origin/main",
    reviewedPaths: ["src/a.ts"],
  });
  expect(cleared).toEqual(emptyPersistedRepoReview());
  expect(cleared.base).toBeUndefined();
  expect(cleared.reviewedPaths).toEqual([]);
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
