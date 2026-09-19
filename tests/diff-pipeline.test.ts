import { expect, test } from "vite-plus/test";
import { DiffPipeline } from "../src/diff/diffPipeline.ts";
import type { ChangedFile } from "../src/diff/types.ts";
import { GitClient, type GitRunner } from "../src/git/gitClient.ts";

function stubFiles(path: string): ChangedFile[] {
  return [
    {
      path,
      status: "modified",
      additions: 1,
      deletions: 0,
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          changes: [{ type: "add", newLine: 1, content: "x" }],
        },
      ],
    },
  ];
}

function createCountingClient(): { git: GitClient; diffCalls: () => number } {
  let calls = 0;
  const runner: GitRunner = async (_cwd, args) => {
    const joined = args.join(" ");
    if (joined.startsWith("rev-parse HEAD") || joined === "rev-parse HEAD") {
      return { stdout: "abc123\n", stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { stdout: "abc123\n", stderr: "" };
    }
    if (args.includes("diff")) {
      // One run carries the raw status lines and the patch (MVP-10c).
      calls += 1;
      return {
        stdout: `:100644 100644 1111111 2222222 M\tfile.ts

diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -0,0 +1 @@
+x
`,
        stderr: "",
      };
    }
    if (args[0] === "rev-parse") {
      return { stdout: `${args[args.length - 1]}\n`, stderr: "" };
    }
    throw new Error(`unexpected git args: ${joined}`);
  };
  return {
    git: new GitClient(runner),
    diffCalls: () => calls,
  };
}

test("skips Git when overlay is off or base is unset", async () => {
  const { git, diffCalls } = createCountingClient();
  const pipeline = new DiffPipeline(git);

  expect(
    await pipeline.getChangedFiles({
      repoRoot: "/repo",
      base: "main",
      head: "abc123",
      overlayActive: false,
    }),
  ).toBeUndefined();

  expect(
    await pipeline.getChangedFiles({
      repoRoot: "/repo",
      base: undefined,
      head: "abc123",
      overlayActive: true,
    }),
  ).toBeUndefined();

  expect(diffCalls()).toBe(0);
});

test("reuses cache for the same repo, base, and HEAD", async () => {
  const { git, diffCalls } = createCountingClient();
  const pipeline = new DiffPipeline(git);
  const query = {
    repoRoot: "/repo",
    base: "main",
    head: "abc123",
    overlayActive: true,
  };

  const first = await pipeline.getChangedFiles(query);
  const second = await pipeline.getChangedFiles(query);

  expect(first).toEqual(stubFiles("file.ts"));
  expect(second).toBe(first);
  expect(diffCalls()).toBe(1);
});

test("refetches when base or HEAD changes", async () => {
  const { git, diffCalls } = createCountingClient();
  const pipeline = new DiffPipeline(git);

  await pipeline.getChangedFiles({
    repoRoot: "/repo",
    base: "main",
    head: "abc123",
    overlayActive: true,
  });
  await pipeline.getChangedFiles({
    repoRoot: "/repo",
    base: "develop",
    head: "abc123",
    overlayActive: true,
  });
  await pipeline.getChangedFiles({
    repoRoot: "/repo",
    base: "develop",
    head: "def456",
    overlayActive: true,
  });

  expect(diffCalls()).toBe(3);
  expect(pipeline.getCacheKey("/repo")).toEqual({
    repoRoot: "/repo",
    base: "develop",
    head: "def456",
  });
});

test("keeps each repository's diff cached while switching between them", async () => {
  const { git, diffCalls } = createCountingClient();
  const pipeline = new DiffPipeline(git);
  const first = { repoRoot: "/repo1", base: "main", head: "abc123", overlayActive: true };
  const second = { repoRoot: "/repo2", base: "main", head: "abc123", overlayActive: true };

  for (let i = 0; i < 3; i++) {
    await pipeline.getChangedFiles(first);
    await pipeline.getChangedFiles(second);
  }

  expect(diffCalls()).toBe(2);
});

test("stopping one repository keeps other repositories cached", async () => {
  const { git, diffCalls } = createCountingClient();
  const pipeline = new DiffPipeline(git);
  const first = { repoRoot: "/repo1", base: "main", head: "abc123", overlayActive: true };
  const second = { repoRoot: "/repo2", base: "main", head: "abc123", overlayActive: true };
  await pipeline.getChangedFiles(first);
  await pipeline.getChangedFiles(second);

  pipeline.clearCache("/repo1");
  await pipeline.getChangedFiles(second);

  expect(pipeline.getCacheKey("/repo1")).toBeUndefined();
  expect(pipeline.getCacheKey("/repo2")).toBeDefined();
  expect(diffCalls()).toBe(2);
});

test("does not cache a fetch that finishes after the cache was cleared", async () => {
  const { git } = createCountingClient();
  const pipeline = new DiffPipeline(git);

  const pending = pipeline.getChangedFiles({
    repoRoot: "/repo",
    base: "main",
    head: "abc123",
    overlayActive: true,
  });
  pipeline.clearCache("/repo");

  expect(await pending).toEqual(stubFiles("file.ts"));
  expect(pipeline.getCacheKey("/repo")).toBeUndefined();
});
