import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { GitClient } from "../src/git/gitClient.ts";

const git = new GitClient();
const cleanups: string[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  cleanups.push(dir);
  return dir;
}

async function gitInit(root: string, branch = "main"): Promise<void> {
  await git.exec(root, ["init", "-b", branch]);
  await git.exec(root, ["config", "user.email", "sidediff@example.com"]);
  await git.exec(root, ["config", "user.name", "SideDiff Test"]);
}

test("compares base...HEAD and ignores uncommitted working tree edits", async () => {
  const root = await createTempDir("sidediff-threedot-");
  await gitInit(root, "main");
  await writeFile(join(root, "app.ts"), "v1\n", "utf8");
  await git.exec(root, ["add", "app.ts"]);
  await git.exec(root, ["commit", "-m", "base"]);

  await git.exec(root, ["checkout", "-b", "feature"]);
  await writeFile(join(root, "app.ts"), "v1\ncommitted\n", "utf8");
  await git.exec(root, ["add", "app.ts"]);
  await git.exec(root, ["commit", "-m", "feature change"]);

  // Dirty working tree must not appear in base...HEAD (D2).
  await writeFile(join(root, "app.ts"), "v1\ncommitted\nDIRTY\n", "utf8");
  await writeFile(join(root, "untracked.ts"), "nope\n", "utf8");

  const files = await git.getChangedFiles(root, "main", "HEAD");
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({
    path: "app.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
  });
  expect(files[0]!.hunks[0]!.changes).toEqual([{ type: "add", newLine: 2, content: "committed" }]);
  expect(files.some((f) => f.path === "untracked.ts")).toBe(false);
});

test("classifies added, deleted, renamed, and binary files from one diff run", async () => {
  const root = await createTempDir("sidediff-statuses-");
  await gitInit(root, "main");
  await writeFile(join(root, "mod.txt"), "l1\nl2\nl3\n", "utf8");
  await writeFile(join(root, "del.txt"), "old\n", "utf8");
  await writeFile(join(root, "ren-old.txt"), "keep\n", "utf8");
  await writeFile(join(root, "logo.bin"), Buffer.from([0, 1, 2, 3]));
  await git.exec(root, ["add", "."]);
  await git.exec(root, ["commit", "-m", "base"]);

  await git.exec(root, ["checkout", "-b", "feature"]);
  await writeFile(join(root, "mod.txt"), "l1\nCHANGED\nl3\n", "utf8");
  await rm(join(root, "del.txt"));
  await git.exec(root, ["mv", "ren-old.txt", "ren-new.txt"]);
  await writeFile(join(root, "added.txt"), "new\n", "utf8");
  await writeFile(join(root, "logo.bin"), Buffer.from([9, 9, 9, 9, 9]));
  await git.exec(root, ["add", "-A"]);
  await git.exec(root, ["commit", "-m", "feature"]);

  const files = await git.getChangedFiles(root, "main", "HEAD");
  const byPath = new Map(files.map((file) => [file.path, file]));

  expect(byPath.get("added.txt")).toMatchObject({ status: "added", additions: 1 });
  expect(byPath.get("del.txt")).toMatchObject({ status: "deleted", deletions: 1 });
  expect(byPath.get("mod.txt")).toMatchObject({ status: "modified", additions: 1, deletions: 1 });
  expect(byPath.get("ren-new.txt")).toMatchObject({
    status: "renamed",
    oldPath: "ren-old.txt",
  });
  expect(byPath.get("logo.bin")).toMatchObject({ status: "modified", binary: true, hunks: [] });
});

test("passes a three-dot revision range to git diff", async () => {
  const calls: string[][] = [];
  const real = new GitClient();
  const client = new GitClient(async (cwd, args) => {
    calls.push([...args]);
    const stdout = await real.exec(cwd, args);
    return { stdout: stdout.length > 0 ? `${stdout}\n` : "", stderr: "" };
  });

  const root = await createTempDir("sidediff-args-");
  await gitInit(root, "main");
  await writeFile(join(root, "a.txt"), "a\n", "utf8");
  await git.exec(root, ["add", "a.txt"]);
  await git.exec(root, ["commit", "-m", "init"]);
  await git.exec(root, ["checkout", "-b", "feature"]);
  await writeFile(join(root, "a.txt"), "b\n", "utf8");
  await git.exec(root, ["add", "a.txt"]);
  await git.exec(root, ["commit", "-m", "change"]);

  await client.getChangedFiles(root, "main", "HEAD");

  const diffCalls = calls.filter((args) => args[0] === "diff");
  // One process carries both the status lines and the patch (MVP-10c).
  expect(diffCalls).toEqual([["diff", "--unified=0", "--raw", "main...HEAD"]]);
  expect(diffCalls.some((args) => args.includes("main..HEAD"))).toBe(false);
});
