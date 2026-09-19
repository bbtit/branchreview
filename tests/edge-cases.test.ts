import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";
import { FakeTextEditor, openedDocuments, resetFakeVscode, shownMessages } from "./fakes/vscode.ts";
import {
  markedLines,
  plainGit,
  registerCleanup,
  runCleanups,
  startReview,
  statusBarText,
  treeRows,
} from "./helpers/reviewHarness.ts";

const TIMEOUT_MS = 20_000;

afterEach(async () => {
  await runCleanups();
  resetFakeVscode();
});

type EdgeCaseRepo = {
  root: string;
  addedFile: string;
  renamedFile: string;
  binaryFile: string;
  keptFile: string;
};

/**
 * `main` → `feature/demo` covering requirements §20: an added file, a deleted file,
 * a renamed file with an edit, a binary change, plus an untracked file and a local
 * edit that exist only in the working tree.
 */
async function createEdgeCaseRepo(): Promise<EdgeCaseRepo> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sidediff-edges-")));
  registerCleanup(() => rm(root, { recursive: true, force: true }));
  await plainGit.exec(root, ["init", "-b", "main"]);
  await plainGit.exec(root, ["config", "user.email", "sidediff@example.com"]);
  await plainGit.exec(root, ["config", "user.name", "SideDiff Test"]);
  await writeFile(join(root, "keep.txt"), "keep1\nkeep2\nkeep3\n", "utf8");
  await writeFile(join(root, "del.txt"), "gone1\ngone2\n", "utf8");
  await writeFile(join(root, "ren-old.txt"), "ren1\nren2\nren3\nren4\nren5\n", "utf8");
  await writeFile(join(root, "logo.bin"), Buffer.from([0, 1, 2, 3]));
  await plainGit.exec(root, ["add", "-A"]);
  await plainGit.exec(root, ["commit", "-m", "base"]);

  await plainGit.exec(root, ["checkout", "-b", "feature/demo"]);
  await writeFile(join(root, "added.txt"), "added1\nadded2\nadded3\n", "utf8");
  await rm(join(root, "del.txt"));
  await plainGit.exec(root, ["mv", "ren-old.txt", "ren-new.txt"]);
  await writeFile(join(root, "ren-new.txt"), "ren1\nCHANGED\nren3\nren4\nren5\n", "utf8");
  await writeFile(join(root, "keep.txt"), "keep1\nKEEP-CHANGED\nkeep3\n", "utf8");
  await writeFile(join(root, "logo.bin"), Buffer.from([9, 9, 9, 9, 9]));
  await plainGit.exec(root, ["add", "-A"]);
  await plainGit.exec(root, ["commit", "-m", "feature"]);

  // Working tree only — must stay out of base...HEAD (D2).
  await writeFile(join(root, "untracked.txt"), "not tracked\n", "utf8");
  await writeFile(join(root, "keep.txt"), "keep1\nKEEP-CHANGED\nkeep3\nLOCAL EDIT\n", "utf8");

  return {
    root,
    addedFile: join(root, "added.txt"),
    renamedFile: join(root, "ren-new.txt"),
    binaryFile: join(root, "logo.bin"),
    keptFile: join(root, "keep.txt"),
  };
}

test(
  "an added file opens in the normal editor with every line marked",
  async () => {
    const repo = await createEdgeCaseRepo();
    const added = new FakeTextEditor(repo.addedFile);
    await startReview({ root: repo.root, editors: [added] });

    expect(markedLines(added, "add")).toEqual([1, 2, 3]);
    expect(treeRows().some((row) => row.label === "A added.txt")).toBe(true);
  },
  TIMEOUT_MS,
);

test(
  "a renamed file is reviewed under its new path",
  async () => {
    const repo = await createEdgeCaseRepo();
    const renamed = new FakeTextEditor(repo.renamedFile);
    await startReview({ root: repo.root, editors: [renamed] });

    expect(markedLines(renamed, "change")).toEqual([2]);
    const row = treeRows().find((candidate) => candidate.label.includes("ren-new.txt"));
    expect(row?.label).toBe("R ren-new.txt");
    expect(row?.description).toContain("ren-old.txt →");
  },
  TIMEOUT_MS,
);

test(
  "a binary file gets no decorations and reports no failure",
  async () => {
    const repo = await createEdgeCaseRepo();
    const binary = new FakeTextEditor(repo.binaryFile);
    await startReview({ root: repo.root, editors: [binary] });

    expect(markedLines(binary, "add")).toEqual([]);
    expect(markedLines(binary, "change")).toEqual([]);
    expect(markedLines(binary, "delete")).toEqual([]);
    expect(treeRows().find((row) => row.label.includes("logo.bin"))?.description).toBe("binary");
    expect(shownMessages.filter((message) => message.includes("could not load"))).toEqual([]);
  },
  TIMEOUT_MS,
);

test(
  "a deleted file stays in the tree and opens nothing when chosen",
  async () => {
    const repo = await createEdgeCaseRepo();
    const kept = new FakeTextEditor(repo.keptFile);
    const { manager } = await startReview({ root: repo.root, editors: [kept] });
    expect(treeRows().some((row) => row.label === "D del.txt")).toBe(true);

    await manager.openTreeFile({ repoRoot: repo.root, path: "del.txt", status: "deleted" });

    expect(openedDocuments).toEqual([]);
    expect(shownMessages.some((message) => message.includes("was deleted on this branch"))).toBe(
      true,
    );
  },
  TIMEOUT_MS,
);

test(
  "local edits and untracked files stay out of the review but show in the status bar",
  async () => {
    const repo = await createEdgeCaseRepo();
    const kept = new FakeTextEditor(repo.keptFile);
    await startReview({ root: repo.root, editors: [kept] });

    // Line 2 changed in the commit; line 4 exists only in the working tree.
    expect(markedLines(kept, "change")).toEqual([2]);
    expect(treeRows().some((row) => row.label.includes("untracked.txt"))).toBe(false);
    expect(statusBarText()).toBe("SideDiff: main · local changes");
  },
  TIMEOUT_MS,
);

type TrickyNameRepo = {
  root: string;
  spacedFile: string;
  japaneseFile: string;
  quotedFile: string;
};

/**
 * `main` → `feature/names` where every path needs quoting or splitting care:
 * a space, non-ASCII characters, and a literal `"` (issue #17), plus a rename,
 * a delete, an add, and a binary change carrying the same kinds of names.
 */
async function createTrickyNameRepo(): Promise<TrickyNameRepo> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sidediff-names-")));
  registerCleanup(() => rm(root, { recursive: true, force: true }));
  await plainGit.exec(root, ["init", "-b", "main"]);
  await plainGit.exec(root, ["config", "user.email", "sidediff@example.com"]);
  await plainGit.exec(root, ["config", "user.name", "SideDiff Test"]);
  await writeFile(join(root, "sp ace.txt"), "l1\nl2\n", "utf8");
  await writeFile(join(root, "日本語.txt"), "l1\nl2\n", "utf8");
  await writeFile(join(root, 'qu"ote.txt'), "l1\nl2\n", "utf8");
  await writeFile(join(root, "画像.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(join(root, "旧 name.txt"), "keep1\nkeep2\nkeep3\n", "utf8");
  await writeFile(join(root, "削除 file.txt"), "gone\n", "utf8");
  await plainGit.exec(root, ["add", "-A"]);
  await plainGit.exec(root, ["commit", "-m", "base"]);

  await plainGit.exec(root, ["checkout", "-b", "feature/names"]);
  await writeFile(join(root, "sp ace.txt"), "l1\nCHANGED\n", "utf8");
  await writeFile(join(root, "日本語.txt"), "l1\nCHANGED\n", "utf8");
  await writeFile(join(root, 'qu"ote.txt'), "l1\nCHANGED\n", "utf8");
  await writeFile(join(root, "画像.bin"), Buffer.from([9, 9, 9, 9, 9]));
  // Content stays identical so Git reports a rename rather than add + delete.
  await plainGit.exec(root, ["mv", "旧 name.txt", "新 name.txt"]);
  await rm(join(root, "削除 file.txt"));
  await writeFile(join(root, "追加 file.txt"), "new1\nnew2\n", "utf8");
  await plainGit.exec(root, ["add", "-A"]);
  await plainGit.exec(root, ["commit", "-m", "names"]);

  return {
    root,
    spacedFile: join(root, "sp ace.txt"),
    japaneseFile: join(root, "日本語.txt"),
    quotedFile: join(root, 'qu"ote.txt'),
  };
}

test(
  "a file name with a space gets gutters, and every tricky name lists under its real name",
  async () => {
    const repo = await createTrickyNameRepo();
    const spaced = new FakeTextEditor(repo.spacedFile);
    await startReview({ root: repo.root, editors: [spaced] });

    expect(markedLines(spaced, "change")).toEqual([2]);

    const rows = new Map(treeRows().map((row) => [row.label, row.description]));
    expect(rows.get("M sp ace.txt")).toBe("+1 -1");
    expect(rows.get("M 日本語.txt")).toBe("+1 -1");
    expect(rows.get('M qu"ote.txt')).toBe("+1 -1");
    expect(rows.get("A 追加 file.txt")).toBe("+2");
    expect(rows.get("D 削除 file.txt")).toBe("-1");
    expect(rows.get("M 画像.bin")).toBe("binary");
    expect(rows.get("R 新 name.txt")).toBe("旧 name.txt →");
  },
  TIMEOUT_MS,
);

test(
  "a non-ASCII file name gets gutters",
  async () => {
    const repo = await createTrickyNameRepo();
    const japanese = new FakeTextEditor(repo.japaneseFile);
    await startReview({ root: repo.root, editors: [japanese] });

    expect(markedLines(japanese, "change")).toEqual([2]);
  },
  TIMEOUT_MS,
);

test(
  "a file name containing a quote gets gutters",
  async () => {
    const repo = await createTrickyNameRepo();
    const quoted = new FakeTextEditor(repo.quotedFile);
    await startReview({ root: repo.root, editors: [quoted] });

    expect(markedLines(quoted, "change")).toEqual([2]);
  },
  TIMEOUT_MS,
);

test("no source file opens a Diff Editor", async () => {
  const sourceDir = fileURLToPath(new URL("../src", import.meta.url));
  const entries = await readdir(sourceDir, { recursive: true });
  const sources = entries.filter((entry) => entry.endsWith(".ts"));
  expect(sources.length).toBeGreaterThan(0);

  for (const relativePath of sources) {
    const source = await readFile(join(sourceDir, relativePath), "utf8");
    expect(source).not.toContain("vscode.diff");
    expect(source).not.toContain("createDiffEditor");
  }
});
