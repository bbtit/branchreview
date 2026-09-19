import { expect, test } from "vite-plus/test";
import { buildChangedFiles, splitRawStatusAndPatch } from "../src/diff/buildChangedFiles.ts";
import { parseDiffStatus } from "../src/diff/parseDiffStatus.ts";
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

test("parses name-status lines including renames", () => {
  expect(
    parseDiffStatus(`A\tsrc/new.ts
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

test("parses raw status lines that carry mode and blob fields", () => {
  expect(
    parseDiffStatus(`:000000 100644 0000000 3e75765 A\tadd.txt
:100644 100644 0f49c4a a7e7e01 M\tbin.dat
:100644 000000 3367afd 0000000 D\tdel.txt
:100644 100644 0ec1772 0ec1772 R100\tren-old.txt\tren-new.txt
`),
  ).toEqual([
    { status: "added", path: "add.txt" },
    { status: "modified", path: "bin.dat" },
    { status: "deleted", path: "del.txt" },
    { status: "renamed", oldPath: "ren-old.txt", path: "ren-new.txt" },
  ]);
});

test("splits one diff run into status lines and patch", () => {
  const combined = `:100644 100644 f0f2307 7c30781 M\tsrc/edit.ts

${MODIFY_DIFF}`;
  const { status, patch } = splitRawStatusAndPatch(combined);

  expect(parseDiffStatus(status)).toEqual([{ status: "modified", path: "src/edit.ts" }]);
  expect(patch).toBe(MODIFY_DIFF);
  expect(parseUnifiedDiff(patch).hunksByPath.get("src/edit.ts")).toHaveLength(2);
});

test("treats output without a patch as status lines only", () => {
  const { status, patch } = splitRawStatusAndPatch(":100644 000000 3367afd 0000000 D\tgone.ts\n");
  expect(parseDiffStatus(status)).toEqual([{ status: "deleted", path: "gone.ts" }]);
  expect(patch).toBe("");
});

test("merges status lines and unified diff into ChangedFile models", () => {
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

// Real `git -c core.quotepath=false diff` output. Git appends a TAB to the
// `---` / `+++` lines when the path contains a space, and still C-quotes a
// path that contains `"` or a backslash.
const SPACE_NAME_DIFF = `diff --git a/sp ace.txt b/sp ace.txt
index 3582182..510ab2a 100644
--- a/sp ace.txt\t
+++ b/sp ace.txt\t
@@ -2 +2 @@ l1
-l2
+CHANGED
`;

const QUOTED_NAME_DIFF = `diff --git "a/qu\\"ote.txt" "b/qu\\"ote.txt"
index 3582182..510ab2a 100644
--- "a/qu\\"ote.txt"
+++ "b/qu\\"ote.txt"
@@ -2 +2 @@ l1
-l2
+CHANGED
`;

const SPACE_BINARY_DIFF = `diff --git a/bin ary.bin b/bin ary.bin
index eaf36c1..20c394d 100644
Binary files a/bin ary.bin and b/bin ary.bin differ
`;

const SPACE_DELETED_DIFF = `diff --git a/del sp.txt b/del sp.txt
deleted file mode 100644
index 3582182..0000000
--- a/del sp.txt\t
+++ /dev/null
@@ -1,2 +0,0 @@
-l1
-l2
`;

test("finds hunks for a path that contains spaces", () => {
  const hunks = parseUnifiedDiff(SPACE_NAME_DIFF).hunksByPath.get("sp ace.txt");
  expect(hunks).toHaveLength(1);
  expect(hunks![0]!.changes).toEqual([
    { type: "delete", oldLine: 2, content: "l2" },
    { type: "add", newLine: 2, content: "CHANGED" },
  ]);
});

test("finds hunks for a quoted path under its real name", () => {
  const hunks = parseUnifiedDiff(QUOTED_NAME_DIFF).hunksByPath.get('qu"ote.txt');
  expect(hunks).toHaveLength(1);
  expect(hunks![0]!.changes).toHaveLength(2);
});

test("finds hunks for a deleted file whose name contains spaces", () => {
  const hunks = parseUnifiedDiff(SPACE_DELETED_DIFF).hunksByPath.get("del sp.txt");
  expect(hunks).toHaveLength(1);
  expect(hunks![0]!.changes).toEqual([
    { type: "delete", oldLine: 1, content: "l1" },
    { type: "delete", oldLine: 2, content: "l2" },
  ]);
});

test("marks a binary file whose name contains spaces", () => {
  expect(parseUnifiedDiff(SPACE_BINARY_DIFF).binaryPaths.has("bin ary.bin")).toBe(true);
});

test("reads an octal-escaped non-ASCII path back as its real name", () => {
  expect(
    parseDiffStatus(
      ':100644 100644 3582182 510ab2a M\t"\\346\\227\\245\\346\\234\\254\\350\\252\\236.txt"\n',
    ),
  ).toEqual([{ status: "modified", path: "日本語.txt" }]);
});

test("reads a quoted path with an escaped quote back as its real name", () => {
  expect(parseDiffStatus(':100644 100644 3582182 510ab2a M\t"qu\\"ote.txt"\n')).toEqual([
    { status: "modified", path: 'qu"ote.txt' },
  ]);
});

test("treats an added line that looks like a file header as content", () => {
  const diff = `diff --git a/c.txt b/c.txt
index 1111111..2222222 100644
--- a/c.txt
+++ b/c.txt
@@ -1,0 +2 @@ x
+++ increment
`;
  const hunks = parseUnifiedDiff(diff).hunksByPath.get("c.txt");
  expect(hunks![0]!.changes).toEqual([{ type: "add", newLine: 2, content: "++ increment" }]);
});

test("merges spaced and non-ASCII names from status lines and patch", () => {
  const status = `:100644 100644 3582182 510ab2a M\tsp ace.txt
:100644 100644 eaf36c1 20c394d M\tbin ary.bin
:100644 100644 3582182 510ab2a M\t"qu\\"ote.txt"
`;
  const files = buildChangedFiles(
    status,
    `${SPACE_NAME_DIFF}${SPACE_BINARY_DIFF}${QUOTED_NAME_DIFF}`,
  );
  const byPath = new Map(files.map((file) => [file.path, file]));

  expect(byPath.get("sp ace.txt")).toMatchObject({ additions: 1, deletions: 1 });
  expect(byPath.get("bin ary.bin")).toMatchObject({ binary: true, hunks: [] });
  expect(byPath.get('qu"ote.txt')).toMatchObject({ additions: 1, deletions: 1 });
});
