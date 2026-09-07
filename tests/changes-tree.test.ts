import { expect, test } from "vite-plus/test";
import type { ChangedFile } from "../src/diff/types.ts";
import {
  changesTreeRowsFromSnapshot,
  fileRowFromChangedFile,
  formatFileStats,
  statusLetter,
} from "../src/views/changeTreeModel.ts";

function file(partial: Partial<ChangedFile> & Pick<ChangedFile, "path" | "status">): ChangedFile {
  return {
    additions: 0,
    deletions: 0,
    hunks: [],
    ...partial,
  };
}

test("shows guidance when review overlay is off", () => {
  expect(
    changesTreeRowsFromSnapshot({
      overlayActive: false,
      base: "origin/main",
      files: [file({ path: "a.ts", status: "modified", additions: 1 })],
    }),
  ).toEqual([
    {
      kind: "message",
      id: "overlay-off",
      label: "Review is off",
      description: "Set Base or Resume Review",
    },
  ]);
});

test("lists base, progress, then change files when overlay is on", () => {
  const rows = changesTreeRowsFromSnapshot({
    overlayActive: true,
    base: "origin/main",
    reviewedPaths: ["src/a.ts", "src/old.ts"],
    files: [
      file({ path: "src/a.ts", status: "modified", additions: 12, deletions: 4 }),
      file({ path: "src/b.ts", status: "added", additions: 84 }),
      file({ path: "src/old.ts", status: "deleted", deletions: 42 }),
      file({
        path: "src/new.ts",
        status: "renamed",
        oldPath: "src/old-name.ts",
        additions: 1,
      }),
      file({ path: "img/logo.png", status: "modified", binary: true }),
    ],
  });

  expect(rows[0]).toEqual({
    kind: "base",
    id: "base:origin/main",
    label: "Base: origin/main",
  });
  expect(rows[1]).toEqual({
    kind: "progress",
    id: "progress",
    label: "Review Progress",
    description: "2 / 5 files reviewed",
    reviewed: 2,
    total: 5,
  });
  expect(rows.slice(2).map((r) => (r.kind === "file" ? r.label : r.kind))).toEqual([
    "✓ M src/a.ts",
    "A src/b.ts",
    "✓ D src/old.ts",
    "R src/new.ts",
    "M img/logo.png",
  ]);
  expect(rows[2]).toMatchObject({
    kind: "file",
    description: "+12 -4",
    openable: true,
    binary: false,
    reviewed: true,
  });
  expect(rows[4]).toMatchObject({
    kind: "file",
    path: "src/old.ts",
    openable: false,
    description: "-42",
    reviewed: true,
  });
  expect(rows[6]).toMatchObject({
    kind: "file",
    description: "binary",
    openable: true,
    binary: true,
    reviewed: false,
  });
});

test("shows empty changes row when overlay is on but diff is empty", () => {
  expect(
    changesTreeRowsFromSnapshot({
      overlayActive: true,
      base: "main",
      files: [],
    }),
  ).toEqual([
    { kind: "base", id: "base:main", label: "Base: main" },
    {
      kind: "message",
      id: "no-changes",
      label: "No changes",
      description: "main...HEAD",
    },
  ]);
});

test("marks deleted files as not openable", () => {
  const row = fileRowFromChangedFile(file({ path: "gone.ts", status: "deleted", deletions: 3 }));
  expect(row.openable).toBe(false);
  expect(row.reviewed).toBe(false);
  expect(statusLetter("deleted")).toBe("D");
});

test("formats rename and binary descriptions", () => {
  expect(
    formatFileStats(
      file({
        path: "new.ts",
        status: "renamed",
        oldPath: "old.ts",
        additions: 2,
        deletions: 1,
      }),
    ),
  ).toBe("old.ts → · +2 -1");
  expect(formatFileStats(file({ path: "a.bin", status: "modified", binary: true }))).toBe("binary");
});
