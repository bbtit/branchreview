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
    if (args[0] === "diff" && args.includes("--name-status")) {
      calls += 1;
      return { stdout: "M\tfile.ts\n", stderr: "" };
    }
    if (args[0] === "diff" && args.includes("--unified=0")) {
      return {
        stdout: `diff --git a/file.ts b/file.ts
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
  expect(pipeline.getCacheKey()).toEqual({
    repoRoot: "/repo",
    base: "develop",
    head: "def456",
  });
});
