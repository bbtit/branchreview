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
  expect(diffCalls.length).toBe(2);
  expect(diffCalls.every((args) => args.includes("main...HEAD"))).toBe(true);
  expect(diffCalls.some((args) => args.includes("main..HEAD"))).toBe(false);
});
