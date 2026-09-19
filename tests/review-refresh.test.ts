import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { GitOutputTooLargeError } from "../src/git/gitClient.ts";
import {
  FakeTextEditor,
  resetFakeVscode,
  saveDocument,
  shownMessages,
  switchToEditor,
} from "./fakes/vscode.ts";
import {
  createReviewSession,
  fireGitDirWatchers,
  isDirtyCheck,
  markedLines,
  plainGit,
  registerCleanup,
  runCleanups,
  sleep,
  startReview,
} from "./helpers/reviewHarness.ts";

const TIMEOUT_MS = 20_000;

afterEach(async () => {
  await runCleanups();
  resetFakeVscode();
});

function numberedLines(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}

/** main: a.ts + src/b.ts; feature/demo changes a.ts line 3 and appends b.ts line 11. */
async function createReviewRepo(): Promise<{ root: string; fileA: string; fileB: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "branchreview-refresh-")));
  registerCleanup(() => rm(root, { recursive: true, force: true }));
  await plainGit.exec(root, ["init", "-b", "main"]);
  await plainGit.exec(root, ["config", "user.email", "branchreview@example.com"]);
  await plainGit.exec(root, ["config", "user.name", "BranchReview Test"]);
  await mkdir(join(root, "src"));
  const fileA = join(root, "a.ts");
  const fileB = join(root, "src", "b.ts");
  await writeFile(fileA, `${numberedLines("a", 10).join("\n")}\n`, "utf8");
  await writeFile(fileB, `${numberedLines("b", 10).join("\n")}\n`, "utf8");
  await commitAll(root, "init");

  await plainGit.exec(root, ["checkout", "-b", "feature/demo"]);
  const aLines = numberedLines("a", 10);
  aLines[2] = "changed";
  await writeFile(fileA, `${aLines.join("\n")}\n`, "utf8");
  await writeFile(fileB, `${[...numberedLines("b", 10), "added"].join("\n")}\n`, "utf8");
  await commitAll(root, "feature");
  return { root, fileA, fileB };
}

async function commitAll(root: string, message: string): Promise<void> {
  await plainGit.exec(root, ["add", "."]);
  await plainGit.exec(root, ["commit", "-m", message]);
}

/** Two visible editors over the demo repo: a.ts is active, src/b.ts is beside it. */
function demoEditors(fileA: string, fileB: string): [FakeTextEditor, FakeTextEditor] {
  return [new FakeTextEditor(fileA), new FakeTextEditor(fileB)];
}

test(
  "switching tabs during a review runs no Git besides the dirty check",
  async () => {
    const { root, fileA, fileB } = await createReviewRepo();
    const [editorA, editorB] = demoEditors(fileA, fileB);
    const { calls, waitForGitIdle } = await startReview({ root, editors: [editorA, editorB] });
    expect(markedLines(editorA, "change")).toEqual([3]);
    expect(markedLines(editorB, "add")).toEqual([11]);

    const warmCalls = calls.length;
    for (let i = 0; i < 3; i++) {
      switchToEditor(editorB, [editorA, editorB]);
      await waitForGitIdle();
      switchToEditor(editorA, [editorA, editorB]);
      await waitForGitIdle();
    }

    const tabSwitchCalls = calls.slice(warmCalls);
    expect(tabSwitchCalls.filter((args) => !isDirtyCheck(args))).toEqual([]);
    expect(tabSwitchCalls.filter(isDirtyCheck)).toHaveLength(6);
    expect(markedLines(editorB, "add")).toEqual([11]);
  },
  TIMEOUT_MS,
);

test(
  "a new commit on the reviewed branch repaints gutters without a manual refresh",
  async () => {
    const { root, fileA, fileB } = await createReviewRepo();
    const [editorA, editorB] = demoEditors(fileA, fileB);
    const { waitForGitIdle } = await startReview({ root, editors: [editorA, editorB] });
    expect(markedLines(editorB, "add")).toEqual([11]);

    await writeFile(
      fileB,
      `${[...numberedLines("b", 10), "added", "added again"].join("\n")}\n`,
      "utf8",
    );
    await commitAll(root, "follow-up");
    fireGitDirWatchers();
    await waitForGitIdle();

    expect(markedLines(editorB, "add")).toEqual([11, 12]);
  },
  TIMEOUT_MS,
);

test(
  "checking out another branch stops the review and clears gutters",
  async () => {
    const { root, fileA, fileB } = await createReviewRepo();
    const [editorA, editorB] = demoEditors(fileA, fileB);
    const { manager, waitForGitIdle } = await startReview({ root, editors: [editorA, editorB] });
    expect(markedLines(editorA, "change")).toEqual([3]);

    await plainGit.exec(root, ["checkout", "main"]);
    fireGitDirWatchers();
    await waitForGitIdle();

    expect(manager.getSessionSnapshot(root).overlayActive).toBe(false);
    expect(markedLines(editorA, "change")).toEqual([]);
    expect(shownMessages.some((message) => message.includes("stopped after branch change"))).toBe(
      true,
    );
  },
  TIMEOUT_MS,
);

test(
  "tab switches run no Git at all while the review is off",
  async () => {
    const { root, fileA, fileB } = await createReviewRepo();
    const [editorA, editorB] = demoEditors(fileA, fileB);
    const { calls, waitForGitIdle } = createReviewSession({ root, editors: [editorA, editorB] });
    await waitForGitIdle();

    const warmCalls = calls.length;
    switchToEditor(editorB, [editorA, editorB]);
    await waitForGitIdle();
    switchToEditor(editorA, [editorA, editorB]);
    await waitForGitIdle();

    expect(calls.slice(warmCalls)).toEqual([]);
  },
  TIMEOUT_MS,
);

test(
  "a burst of saves checks the working tree once",
  async () => {
    const { root, fileA, fileB } = await createReviewRepo();
    const [editorA, editorB] = demoEditors(fileA, fileB);
    const { calls, waitForGitIdle } = await startReview({ root, editors: [editorA, editorB] });
    const warmCalls = calls.length;

    await writeFile(fileA, "locally edited\n", "utf8");
    // Spread out like Save All / autosave: undebounced, every save would check Git.
    for (let i = 0; i < 5; i++) {
      saveDocument();
      await sleep(50);
    }
    await waitForGitIdle();

    const savedCalls = calls.slice(warmCalls);
    expect(savedCalls.filter(isDirtyCheck)).toHaveLength(1);
    expect(savedCalls.filter((args) => args.includes("diff"))).toEqual([]);
  },
  TIMEOUT_MS,
);

test(
  "a diff that is too large reports the reason once instead of failing silently",
  async () => {
    const { root, fileA, fileB } = await createReviewRepo();
    const rejections: unknown[] = [];
    const recordRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", recordRejection);
    registerCleanup(() => {
      process.off("unhandledRejection", recordRejection);
    });

    const [editorA, editorB] = demoEditors(fileA, fileB);
    const { waitForGitIdle } = await startReview({
      root,
      editors: [editorA, editorB],
      diffError: () =>
        new GitOutputTooLargeError({
          args: ["diff"],
          cwd: root,
          limitBytes: 64 * 1024 * 1024,
        }),
    });
    switchToEditor(editorB, [editorA, editorB]);
    await waitForGitIdle();

    const failures = shownMessages.filter((message) => message.includes("could not load"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("larger than 64 MB");
    expect(markedLines(editorA, "change")).toEqual([]);
    expect(rejections).toEqual([]);
  },
  TIMEOUT_MS,
);
