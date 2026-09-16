import { expect, test } from "vite-plus/test";
import { GitClient, type GitRunner } from "../src/git/gitClient.ts";
import { WorkingTreeStatus } from "../src/git/workingTreeStatus.ts";

function createRecordingGit(delayMs = 0): { git: GitClient; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = async (_cwd, args) => {
    calls.push([...args]);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { stdout: " M file.ts\n", stderr: "" };
  };
  return { git: new GitClient(runner), calls };
}

test("asks Git for dirtiness without taking the optional index lock", async () => {
  const { git, calls } = createRecordingGit();

  expect(await new WorkingTreeStatus(git).isDirty("/repo")).toBe(true);
  expect(calls).toEqual([["--no-optional-locks", "status", "--porcelain"]]);
});

test("overlapping checks share one run instead of piling up", async () => {
  const { git, calls } = createRecordingGit(20);
  const workingTree = new WorkingTreeStatus(git);

  const answers = await Promise.all([
    workingTree.isDirty("/repo"),
    workingTree.isDirty("/repo"),
    workingTree.isDirty("/repo"),
  ]);

  expect(answers).toEqual([true, true, true]);
  expect(calls).toHaveLength(1);
});

test("checks again once the previous run has finished", async () => {
  const { git, calls } = createRecordingGit();
  const workingTree = new WorkingTreeStatus(git);

  await workingTree.isDirty("/repo");
  await workingTree.isDirty("/repo");

  expect(calls).toHaveLength(2);
});

test("checks each repository separately", async () => {
  const { git, calls } = createRecordingGit(20);
  const workingTree = new WorkingTreeStatus(git);

  await Promise.all([workingTree.isDirty("/repo1"), workingTree.isDirty("/repo2")]);

  expect(calls).toHaveLength(2);
});
