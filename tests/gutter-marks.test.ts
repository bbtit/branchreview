import { expect, test } from "vite-plus/test";
import { deleteAnchorLine, gutterMarksFromHunks } from "../src/diff/gutterMarks.ts";
import type { DiffHunk } from "../src/diff/types.ts";

test("marks pure additions as add", () => {
  const hunks: DiffHunk[] = [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
      changes: [
        { type: "add", newLine: 1, content: "a" },
        { type: "add", newLine: 2, content: "b" },
      ],
    },
  ];
  expect(gutterMarksFromHunks(hunks)).toEqual([
    { kind: "add", line: 1 },
    { kind: "add", line: 2 },
  ]);
});

test("marks delete-plus-add hunks as change on new lines", () => {
  const hunks: DiffHunk[] = [
    {
      oldStart: 3,
      oldLines: 1,
      newStart: 3,
      newLines: 1,
      changes: [
        { type: "delete", oldLine: 3, content: "old" },
        { type: "add", newLine: 3, content: "new" },
      ],
    },
  ];
  expect(gutterMarksFromHunks(hunks)).toEqual([{ kind: "change", line: 3 }]);
});

test("places a delete mark on the adjacent remaining line", () => {
  const hunks: DiffHunk[] = [
    {
      oldStart: 5,
      oldLines: 2,
      newStart: 4,
      newLines: 0,
      changes: [
        { type: "delete", oldLine: 5, content: "gone1" },
        { type: "delete", oldLine: 6, content: "gone2" },
      ],
    },
  ];
  expect(gutterMarksFromHunks(hunks)).toEqual([{ kind: "delete", line: 4 }]);
  expect(deleteAnchorLine(0)).toBe(1);
});
