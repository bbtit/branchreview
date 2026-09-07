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

async function gitInitWithCommit(root: string, branch = "main"): Promise<string> {
  await git.exec(root, ["init", "-b", branch]);
  await git.exec(root, ["config", "user.email", "sidediff@example.com"]);
  await git.exec(root, ["config", "user.name", "SideDiff Test"]);
  await writeFile(join(root, "readme.txt"), "hello\n", "utf8");
  await git.exec(root, ["add", "readme.txt"]);
  await git.exec(root, ["commit", "-m", "init"]);
  return root;
}

test("accepts existing revisions and rejects unknown ones", async () => {
  const root = await createTempDir("sidediff-rev-");
  await gitInitWithCommit(root, "main");
  await git.exec(root, ["branch", "feature/x"]);

  expect(await git.revisionExists(root, "main")).toBe(true);
  expect(await git.revisionExists(root, "feature/x")).toBe(true);
  expect(await git.revisionExists(root, "no-such-ref")).toBe(false);
});

test("lists local branch names for Set Base candidates", async () => {
  const root = await createTempDir("sidediff-refs-");
  await gitInitWithCommit(root, "main");
  await git.exec(root, ["branch", "feature/x"]);

  const refs = await git.listBranchRefs(root);
  expect(refs).toContain("main");
  expect(refs).toContain("feature/x");
});

test("reports a clean tree as not dirty and a modified file as dirty", async () => {
  const root = await createTempDir("sidediff-dirty-");
  await gitInitWithCommit(root, "main");

  expect(await git.isWorkingTreeDirty(root)).toBe(false);

  await writeFile(join(root, "readme.txt"), "changed\n", "utf8");
  expect(await git.isWorkingTreeDirty(root)).toBe(true);
});
