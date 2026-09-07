import { expect, test } from "vite-plus/test";
import { formatHunkHoverMarkdown } from "../src/diff/hunkHover.ts";
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
      "**SideDiff**",
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
