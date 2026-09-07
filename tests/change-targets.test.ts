import { expect, test } from "vite-plus/test";
import type { ChangedFile, DiffHunk } from "../src/diff/types.ts";
import {
  changeTargetsFromFiles,
  findNextChangeTarget,
  findPreviousChangeTarget,
  hunkAnchorLine,
} from "../src/navigation/changeTargets.ts";

function hunk(newStart: number, changes: DiffHunk["changes"], oldStart = newStart): DiffHunk {
  return {
    oldStart,
    oldLines: changes.filter((c) => c.type === "delete").length,
    newStart,
    newLines: changes.filter((c) => c.type === "add").length,
    changes,
  };
}

function file(
  path: string,
  hunks: DiffHunk[],
  status: ChangedFile["status"] = "modified",
): ChangedFile {
  return { path, status, additions: 0, deletions: 0, hunks };
}

test("builds one target per hunk in file order", () => {
  const files = [
    file("a.ts", [
      hunk(2, [{ type: "add", newLine: 2, content: "x" }]),
      hunk(10, [{ type: "add", newLine: 10, content: "y" }]),
    ]),
    file("b.ts", [hunk(1, [{ type: "add", newLine: 1, content: "z" }])]),
  ];
  expect(changeTargetsFromFiles(files)).toEqual([
    { path: "a.ts", line: 2 },
    { path: "a.ts", line: 10 },
    { path: "b.ts", line: 1 },
  ]);
});

test("skips deleted files", () => {
  const files = [
    file("gone.ts", [hunk(0, [{ type: "delete", oldLine: 1, content: "x" }], 1)], "deleted"),
    file("kept.ts", [hunk(3, [{ type: "add", newLine: 3, content: "y" }])]),
  ];
  expect(changeTargetsFromFiles(files)).toEqual([{ path: "kept.ts", line: 3 }]);
});

test("anchors delete-only hunks on the adjacent remaining line", () => {
  expect(
    hunkAnchorLine(
      hunk(
        4,
        [
          { type: "delete", oldLine: 5, content: "a" },
          { type: "delete", oldLine: 6, content: "b" },
        ],
        5,
      ),
    ),
  ).toBe(4);
});

test("moves to the next hunk in the same file", () => {
  const targets = [
    { path: "a.ts", line: 2 },
    { path: "a.ts", line: 10 },
    { path: "b.ts", line: 1 },
  ];
  expect(findNextChangeTarget(targets, { path: "a.ts", line: 2 })).toEqual({
    path: "a.ts",
    line: 10,
  });
});

test("crosses to the next file after the last hunk", () => {
  const targets = [
    { path: "a.ts", line: 2 },
    { path: "a.ts", line: 10 },
    { path: "b.ts", line: 1 },
  ];
  expect(findNextChangeTarget(targets, { path: "a.ts", line: 10 })).toEqual({
    path: "b.ts",
    line: 1,
  });
  expect(findPreviousChangeTarget(targets, { path: "b.ts", line: 1 })).toEqual({
    path: "a.ts",
    line: 10,
  });
});

test("wraps from the last change to the first and back", () => {
  const targets = [
    { path: "a.ts", line: 2 },
    { path: "b.ts", line: 1 },
  ];
  expect(findNextChangeTarget(targets, { path: "b.ts", line: 1 })).toEqual({
    path: "a.ts",
    line: 2,
  });
  expect(findPreviousChangeTarget(targets, { path: "a.ts", line: 2 })).toEqual({
    path: "b.ts",
    line: 1,
  });
});

test("returns undefined when there are no targets", () => {
  expect(findNextChangeTarget([], { path: "a.ts", line: 1 })).toBeUndefined();
  expect(findPreviousChangeTarget([], { path: "a.ts", line: 1 })).toBeUndefined();
});
