import { expect, test } from "vite-plus/test";
import { formatHunkHoverMarkdown, hunkHoversFromHunks } from "../src/diff/hunkHover.ts";
import type { DiffHunk } from "../src/diff/types.ts";

test("formats a change hunk as a diff fence with old and new lines", () => {
  const hunk: DiffHunk = {
    oldStart: 3,
    oldLines: 1,
    newStart: 3,
    newLines: 2,
    changes: [
      { type: "delete", oldLine: 3, content: "const account = user.profile;" },
      { type: "add", newLine: 3, content: "const account = user.account;" },
      { type: "add", newLine: 4, content: "account.activate();" },
    ],
  };

  expect(formatHunkHoverMarkdown(hunk)).toBe(
    [
      "**BranchReview**",
      "",
      "```diff",
      "-const account = user.profile;",
      "+const account = user.account;",
      "+account.activate();",
      "```",
    ].join("\n"),
  );
});

test("formats a delete-only hunk so removed lines are readable", () => {
  const hunk: DiffHunk = {
    oldStart: 5,
    oldLines: 2,
    newStart: 4,
    newLines: 0,
    changes: [
      { type: "delete", oldLine: 5, content: "removed one" },
      { type: "delete", oldLine: 6, content: "removed two" },
    ],
  };

  expect(formatHunkHoverMarkdown(hunk)).toContain("-removed one");
  expect(formatHunkHoverMarkdown(hunk)).toContain("-removed two");
});

test("formats pure additions without inventing delete lines", () => {
  const hunk: DiffHunk = {
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: 1,
    changes: [{ type: "add", newLine: 1, content: "export const a = 1;" }],
  };

  expect(formatHunkHoverMarkdown(hunk)).toContain("+export const a = 1;");
  expect(formatHunkHoverMarkdown(hunk)).not.toContain("-");
});

test("shows a change hunk's diff anywhere across its new lines", () => {
  const hovers = hunkHoversFromHunks([
    {
      oldStart: 3,
      oldLines: 1,
      newStart: 3,
      newLines: 2,
      changes: [
        { type: "delete", oldLine: 3, content: "old" },
        { type: "add", newLine: 3, content: "new1" },
        { type: "add", newLine: 4, content: "new2" },
      ],
    },
  ]);

  expect(hovers).toHaveLength(1);
  expect(hovers[0]).toMatchObject({ startLine: 3, endLine: 4 });
  expect(hovers[0]!.markdown).toContain("-old");
  expect(hovers[0]!.markdown).toContain("+new2");
});

test("shows removed lines on the line next to a deletion", () => {
  const hovers = hunkHoversFromHunks([
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
  ]);

  expect(hovers).toHaveLength(1);
  expect(hovers[0]).toMatchObject({ startLine: 4, endLine: 4 });
  expect(hovers[0]!.markdown).toContain("-gone2");
});

test("keeps a large added file to one hover instead of one per line", () => {
  const lineCount = 2000;
  const hovers = hunkHoversFromHunks([
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lineCount,
      changes: Array.from({ length: lineCount }, (_, i) => ({
        type: "add" as const,
        newLine: i + 1,
        content: `line ${i + 1}`,
      })),
    },
  ]);

  expect(hovers).toHaveLength(1);
  expect(hovers[0]).toMatchObject({ startLine: 1, endLine: lineCount });
});
