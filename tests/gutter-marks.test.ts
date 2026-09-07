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
  const marks = gutterMarksFromHunks(hunks);
  expect(marks.map(({ kind, line }) => ({ kind, line }))).toEqual([
    { kind: "add", line: 1 },
    { kind: "add", line: 2 },
  ]);
  expect(marks[0]!.hoverMarkdown).toContain("+a");
  expect(marks[0]!.hoverMarkdown).toContain("+b");
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
  const marks = gutterMarksFromHunks(hunks);
  expect(marks).toHaveLength(1);
  expect(marks[0]!.kind).toBe("change");
  expect(marks[0]!.line).toBe(3);
  expect(marks[0]!.hoverMarkdown).toContain("-old");
  expect(marks[0]!.hoverMarkdown).toContain("+new");
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
  const marks = gutterMarksFromHunks(hunks);
  expect(marks).toHaveLength(1);
  expect(marks[0]!.kind).toBe("delete");
  expect(marks[0]!.line).toBe(4);
  expect(marks[0]!.hoverMarkdown).toContain("-gone1");
  expect(marks[0]!.hoverMarkdown).toContain("-gone2");
  expect(deleteAnchorLine(0)).toBe(1);
});
