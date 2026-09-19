import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { DiffPipeline } from "../src/diff/diffPipeline.ts";
import type { ChangedFile } from "../src/diff/types.ts";
import { GitClient, type GitRunner } from "../src/git/gitClient.ts";
import { orderEditorsActiveFirst } from "../src/review/editorOrder.ts";
import { debounce } from "../src/util/debounce.ts";

const realGit = new GitClient();
const cleanups: string[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

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

function createSlowCountingClient(delayMs: number): {
  git: GitClient;
  diffCalls: () => number;
} {
  let calls = 0;
  const runner: GitRunner = async (_cwd, args) => {
    const joined = args.join(" ");
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { stdout: "abc123\n", stderr: "" };
    }
    if (args.includes("diff")) {
      // One run carries the raw status lines and the patch (MVP-10c).
      calls += 1;
      await new Promise((r) => setTimeout(r, delayMs));
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

test("coalesces concurrent fetches for the same repo, base, and HEAD", async () => {
  const { git, diffCalls } = createSlowCountingClient(40);
  const pipeline = new DiffPipeline(git);
  const query = {
    repoRoot: "/repo",
    base: "main",
    head: "abc123",
    overlayActive: true,
  };

  const [a, b] = await Promise.all([
    pipeline.getChangedFiles(query),
    pipeline.getChangedFiles(query),
  ]);

  expect(a).toEqual(stubFiles("file.ts"));
  expect(b).toBe(a);
  expect(diffCalls()).toBe(1);
});

test("puts the active editor before other visible editors", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };

  expect(orderEditorsActiveFirst([a, b, c], b)).toEqual([b, a, c]);
  expect(orderEditorsActiveFirst([a, b], undefined)).toEqual([a, b]);
  expect(orderEditorsActiveFirst([a], a)).toEqual([a]);
});

test("debounce runs once after quiet period", async () => {
  let calls = 0;
  const run = debounce(() => {
    calls += 1;
  }, 30);

  run();
  run();
  run();
  expect(calls).toBe(0);

  await new Promise((r) => setTimeout(r, 50));
  expect(calls).toBe(1);

  run();
  run.cancel();
  await new Promise((r) => setTimeout(r, 50));
  expect(calls).toBe(1);
});

test("resolves an absolute git directory for tip watching", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "branchreview-gitdir-")));
  cleanups.push(root);
  await realGit.exec(root, ["init", "-b", "main"]);
  await realGit.exec(root, ["config", "user.email", "branchreview@example.com"]);
  await realGit.exec(root, ["config", "user.name", "BranchReview Test"]);
  await writeFile(join(root, "a.txt"), "a\n", "utf8");
  await realGit.exec(root, ["add", "a.txt"]);
  await realGit.exec(root, ["commit", "-m", "init"]);

  const gitDir = await realGit.getGitDir(root);
  expect(gitDir.endsWith(".git")).toBe(true);
  expect(gitDir.startsWith(root)).toBe(true);
});
