import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { GitClient } from "../src/git/gitClient.ts";
import { GitContextCache } from "../src/git/gitContextCache.ts";

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

async function commitAll(root: string, message: string): Promise<string> {
  await git.exec(root, ["add", "."]);
  await git.exec(root, ["commit", "-m", message]);
  return git.getCurrentRevision(root);
}

async function createRepo(prefix: string): Promise<{ root: string; fileA: string; fileB: string }> {
  const root = await createTempDir(prefix);
  await git.exec(root, ["init", "-b", "main"]);
  await git.exec(root, ["config", "user.email", "branchreview@example.com"]);
  await git.exec(root, ["config", "user.name", "BranchReview Test"]);
  await mkdir(join(root, "src"));
  const fileA = join(root, "a.ts");
  const fileB = join(root, "src", "b.ts");
  await writeFile(fileA, "a\n", "utf8");
  await writeFile(fileB, "b\n", "utf8");
  await commitAll(root, "init");
  return { root, fileA, fileB };
}

function createRecordingCache(): { cache: GitContextCache; gitRuns: () => number } {
  let runs = 0;
  const recording = new GitClient(async (cwd, args) => {
    runs += 1;
    return { stdout: `${await git.exec(cwd, args)}\n`, stderr: "" };
  });
  return { cache: new GitContextCache(recording), gitRuns: () => runs };
}

test("switches between files of a known repository without running Git", async () => {
  const { root, fileA, fileB } = await createRepo("branchreview-cache-warm-");
  const { cache, gitRuns } = createRecordingCache();

  await cache.getContextForPath(fileA);
  await cache.getContextForPath(fileB);
  const runsWhenWarm = gitRuns();

  for (let i = 0; i < 5; i++) {
    expect((await cache.getContextForPath(fileA))?.root).toBe(root);
    expect((await cache.getContextForPath(fileB))?.branch).toBe("main");
  }

  expect(runsWhenWarm).toBe(2);
  expect(gitRuns()).toBe(runsWhenWarm);
});

test("shares one Git run between lookups that start together", async () => {
  const { fileA } = await createRepo("branchreview-cache-concurrent-");
  const { cache, gitRuns } = createRecordingCache();

  const contexts = await Promise.all([
    cache.getContextForPath(fileA),
    cache.getContextForPath(fileA),
    cache.getContextForPath(fileA),
  ]);

  expect(gitRuns()).toBe(1);
  expect(contexts[1]).toEqual(contexts[0]);
  expect(contexts[2]).toEqual(contexts[0]);
});

test("shows a new commit once repository heads are invalidated", async () => {
  const { root, fileA } = await createRepo("branchreview-cache-commit-");
  const { cache } = createRecordingCache();
  const before = await cache.getContextForPath(fileA);

  await writeFile(fileA, "a2\n", "utf8");
  const newHead = await commitAll(root, "change");
  expect((await cache.getContextForPath(fileA))?.head).toBe(before?.head);

  cache.invalidateRepositoryHeads();
  expect((await cache.getContextForPath(fileA))?.head).toBe(newHead);
});

test("follows a branch checkout and a detached HEAD after invalidation", async () => {
  const { root, fileA } = await createRepo("branchreview-cache-checkout-");
  const { cache } = createRecordingCache();
  await cache.getContextForPath(fileA);

  await git.exec(root, ["checkout", "-b", "feature/x"]);
  cache.invalidateRepositoryHeads();
  expect((await cache.getContextForPath(fileA))?.branch).toBe("feature/x");

  await git.exec(root, ["checkout", "--detach"]);
  cache.invalidateRepositoryHeads();
  expect(await cache.getContextForPath(fileA)).toMatchObject({
    branch: null,
    detached: true,
    reviewable: false,
  });
});

test("reads Git directly when a fresh context is requested", async () => {
  const { root, fileA } = await createRepo("branchreview-cache-fresh-");
  const { cache } = createRecordingCache();
  await cache.getContextForPath(fileA);

  await writeFile(fileA, "a2\n", "utf8");
  const newHead = await commitAll(root, "change");

  expect((await cache.getContextForPath(fileA, { fresh: true }))?.head).toBe(newHead);
  expect((await cache.getContextForPath(fileA))?.head).toBe(newHead);
});

test("remembers a directory outside any repository until invalidation", async () => {
  const dir = await createTempDir("branchreview-cache-nongit-");
  const file = join(dir, "alone.txt");
  await writeFile(file, "no git\n", "utf8");
  const { cache, gitRuns } = createRecordingCache();

  expect(await cache.getContextForPath(file)).toBeUndefined();
  expect(await cache.getContextForPath(file)).toBeUndefined();
  expect(gitRuns()).toBe(1);

  await git.exec(dir, ["init", "-b", "main"]);
  await git.exec(dir, ["config", "user.email", "branchreview@example.com"]);
  await git.exec(dir, ["config", "user.name", "BranchReview Test"]);
  await commitAll(dir, "init");
  cache.invalidateRepositoryHeads();

  expect((await cache.getContextForPath(file))?.root).toBe(dir);
});

test("does not keep an answer that was being read when HEAD moved", async () => {
  let head = "old-sha";
  let runs = 0;
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cache = new GitContextCache(
    new GitClient(async () => {
      runs += 1;
      const answer = head;
      if (runs === 1) {
        await gate;
      }
      return { stdout: `/repo\n${answer}\nmain\n`, stderr: "" };
    }),
  );

  const first = cache.getContextForPath("/repo/src/a.ts");
  while (runs === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  head = "new-sha";
  cache.invalidateRepositoryHeads();
  release();

  expect((await first)?.head).toBe("old-sha");
  expect((await cache.getContextForPath("/repo/src/a.ts"))?.head).toBe("new-sha");
  expect(runs).toBe(2);
});
