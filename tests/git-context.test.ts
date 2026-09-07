import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { GitClient } from "../src/git/gitClient.ts";
import { getGitContextForFile } from "../src/git/repository.ts";

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

async function gitInitWithCommit(
  root: string,
  branch = "main",
): Promise<{ filePath: string; head: string }> {
  await git.exec(root, ["init", "-b", branch]);
  await git.exec(root, ["config", "user.email", "sidediff@example.com"]);
  await git.exec(root, ["config", "user.name", "SideDiff Test"]);
  const filePath = join(root, "readme.txt");
  await writeFile(filePath, "hello\n", "utf8");
  await git.exec(root, ["add", "readme.txt"]);
  await git.exec(root, ["commit", "-m", "init"]);
  const head = await git.getCurrentRevision(root);
  return { filePath, head };
}

test("reports the owning repo, branch, and HEAD for a file on a branch", async () => {
  const root = await createTempDir("sidediff-git-");
  const { filePath, head } = await gitInitWithCommit(root, "feature/demo");

  const context = await getGitContextForFile(git, filePath);

  expect(context).toEqual({
    root,
    head,
    branch: "feature/demo",
    detached: false,
    reviewable: true,
  });
});

test("refuses review when HEAD is detached", async () => {
  const root = await createTempDir("sidediff-detached-");
  const { filePath, head } = await gitInitWithCommit(root, "main");
  await git.exec(root, ["checkout", "--detach", "HEAD"]);

  const context = await getGitContextForFile(git, filePath);

  expect(context).toEqual({
    root,
    head,
    branch: null,
    detached: true,
    reviewable: false,
  });
});

test("targets the repository that owns the active file", async () => {
  const workspace = await createTempDir("sidediff-multiroot-");
  const repoA = join(workspace, "repo-a");
  const repoB = join(workspace, "repo-b");
  await mkdir(repoA);
  await mkdir(repoB);

  const a = await gitInitWithCommit(repoA, "branch-a");
  const b = await gitInitWithCommit(repoB, "branch-b");

  const contextA = await getGitContextForFile(git, a.filePath);
  const contextB = await getGitContextForFile(git, b.filePath);

  expect(contextA?.root).toBe(repoA);
  expect(contextA?.branch).toBe("branch-a");
  expect(contextB?.root).toBe(repoB);
  expect(contextB?.branch).toBe("branch-b");
  expect(contextA?.root).not.toBe(contextB?.root);
});

test("has no context when the file is outside any repository", async () => {
  const dir = await createTempDir("sidediff-nongit-");
  const filePath = join(dir, "alone.txt");
  await writeFile(filePath, "no git\n", "utf8");

  const context = await getGitContextForFile(git, filePath);
  expect(context).toBeUndefined();
});

test("resolves context when given the repository root directory", async () => {
  const root = await createTempDir("sidediff-dir-");
  const { head } = await gitInitWithCommit(root, "main");

  const context = await getGitContextForFile(git, root);

  expect(context).toEqual({
    root,
    head,
    branch: "main",
    detached: false,
    reviewable: true,
  });
});

test("looks up context only through the shared Git client", async () => {
  const root = await createTempDir("sidediff-client-");
  const { filePath } = await gitInitWithCommit(root);

  const calls: string[][] = [];
  const real = new GitClient();
  const recording = new GitClient(async (cwd, args) => {
    calls.push([...args]);
    const stdout = await real.exec(cwd, args);
    return { stdout: `${stdout}\n`, stderr: "" };
  });

  await getGitContextForFile(recording, filePath);

  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((args) => args[0] === "rev-parse")).toBe(true);
  expect(calls.some((args) => args.includes("--show-toplevel"))).toBe(true);
  expect(calls.some((args) => args.includes("HEAD"))).toBe(true);
});
