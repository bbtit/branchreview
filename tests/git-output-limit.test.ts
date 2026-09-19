import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { createGitRunner, GitClient, GitOutputTooLargeError } from "../src/git/gitClient.ts";

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

test("says the diff is too large instead of failing with a buffer error", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "branchreview-toolarge-")));
  cleanups.push(root);
  await git.exec(root, ["init", "-b", "main"]);
  await git.exec(root, ["config", "user.email", "branchreview@example.com"]);
  await git.exec(root, ["config", "user.name", "BranchReview Test"]);
  await writeFile(join(root, "big.txt"), "base\n", "utf8");
  await git.exec(root, ["add", "big.txt"]);
  await git.exec(root, ["commit", "-m", "base"]);

  await git.exec(root, ["checkout", "-b", "feature"]);
  const generated = Array.from({ length: 5000 }, (_, i) => `generated line ${i}`).join("\n");
  await writeFile(join(root, "big.txt"), `${generated}\n`, "utf8");
  await git.exec(root, ["add", "big.txt"]);
  await git.exec(root, ["commit", "-m", "generate"]);

  const limited = new GitClient(createGitRunner(4096));
  const failure = await limited
    .getChangedFiles(root, "main", "HEAD")
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(GitOutputTooLargeError);
  expect((failure as GitOutputTooLargeError).limitBytes).toBe(4096);
});

test("stays under the cap for an ordinary diff", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "branchreview-undercap-")));
  cleanups.push(root);
  await git.exec(root, ["init", "-b", "main"]);
  await git.exec(root, ["config", "user.email", "branchreview@example.com"]);
  await git.exec(root, ["config", "user.name", "BranchReview Test"]);
  await writeFile(join(root, "small.txt"), "one\n", "utf8");
  await git.exec(root, ["add", "small.txt"]);
  await git.exec(root, ["commit", "-m", "base"]);

  await git.exec(root, ["checkout", "-b", "feature"]);
  await writeFile(join(root, "small.txt"), "one\ntwo\n", "utf8");
  await git.exec(root, ["add", "small.txt"]);
  await git.exec(root, ["commit", "-m", "change"]);

  const limited = new GitClient(createGitRunner(4096));
  const files = await limited.getChangedFiles(root, "main", "HEAD");
  expect(files.map((file) => file.path)).toEqual(["small.txt"]);
});
