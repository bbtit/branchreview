import { expect, test } from "vite-plus/test";
import { buildChangedFiles } from "../src/diff/buildChangedFiles.ts";
import { parseNameStatus } from "../src/diff/parseNameStatus.ts";
import { parseUnifiedDiff } from "../src/diff/parseUnifiedDiff.ts";

const ADD_DIFF = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;
`;

const MODIFY_DIFF = `diff --git a/src/edit.ts b/src/edit.ts
index 1111111..2222222 100644
--- a/src/edit.ts
+++ b/src/edit.ts
@@ -3 +3 @@
-old line
+new line
@@ -10,0 +11,1 @@
+inserted
`;

const DELETE_HUNK_DIFF = `diff --git a/src/keep.ts b/src/keep.ts
index 1111111..2222222 100644
--- a/src/keep.ts
+++ b/src/keep.ts
@@ -5,2 +4,0 @@
-removed one
-removed two
`;

test("parses an added-file hunk with new-side line numbers", () => {
  const hunks = parseUnifiedDiff(ADD_DIFF).hunksByPath.get("src/new.ts");
  expect(hunks).toHaveLength(1);
  expect(hunks![0]).toMatchObject({
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: 2,
  });
  expect(hunks![0]!.changes).toEqual([
    { type: "add", newLine: 1, content: "export const a = 1;" },
    { type: "add", newLine: 2, content: "export const b = 2;" },
  ]);
});

test("parses modify hunks as delete-plus-add and pure inserts", () => {
  const hunks = parseUnifiedDiff(MODIFY_DIFF).hunksByPath.get("src/edit.ts");
  expect(hunks).toHaveLength(2);
  expect(hunks![0]!.changes).toEqual([
    { type: "delete", oldLine: 3, content: "old line" },
    { type: "add", newLine: 3, content: "new line" },
  ]);
  expect(hunks![1]!.changes).toEqual([{ type: "add", newLine: 11, content: "inserted" }]);
});

test("parses a delete hunk with old-side line numbers only", () => {
  const hunks = parseUnifiedDiff(DELETE_HUNK_DIFF).hunksByPath.get("src/keep.ts");
  expect(hunks).toHaveLength(1);
  expect(hunks![0]).toMatchObject({
    oldStart: 5,
    oldLines: 2,
    newStart: 4,
    newLines: 0,
  });
  expect(hunks![0]!.changes).toEqual([
    { type: "delete", oldLine: 5, content: "removed one" },
    { type: "delete", oldLine: 6, content: "removed two" },
  ]);
});

test("parses name-status including renames", () => {
  expect(
    parseNameStatus(`A\tsrc/new.ts
M\tsrc/edit.ts
D\tsrc/gone.ts
R100\told.ts\tnew.ts
`),
  ).toEqual([
    { status: "added", path: "src/new.ts" },
    { status: "modified", path: "src/edit.ts" },
    { status: "deleted", path: "src/gone.ts" },
    { status: "renamed", oldPath: "old.ts", path: "new.ts" },
  ]);
});

test("merges name-status and unified diff into ChangedFile models", () => {
  const files = buildChangedFiles(
    `A\tsrc/new.ts
M\tsrc/edit.ts
`,
    `${ADD_DIFF}${MODIFY_DIFF}`,
  );

  expect(files).toHaveLength(2);
  expect(files[0]).toMatchObject({
    path: "src/new.ts",
    status: "added",
    additions: 2,
    deletions: 0,
  });
  expect(files[0]!.hunks).toHaveLength(1);
  expect(files[1]).toMatchObject({
    path: "src/edit.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
  });
  expect(files[1]!.hunks).toHaveLength(2);
});

const BINARY_DIFF = `diff --git a/img/logo.png b/img/logo.png
index 1111111..2222222 100644
Binary files a/img/logo.png and b/img/logo.png differ
`;

test("marks binary files without text hunks", () => {
  const parsed = parseUnifiedDiff(BINARY_DIFF);
  expect(parsed.binaryPaths.has("img/logo.png")).toBe(true);
  expect(parsed.hunksByPath.get("img/logo.png")).toEqual([]);

  const files = buildChangedFiles("M\timg/logo.png\n", BINARY_DIFF);
  expect(files).toEqual([
    {
      path: "img/logo.png",
      status: "modified",
      additions: 0,
      deletions: 0,
      hunks: [],
      binary: true,
    },
  ]);
});
