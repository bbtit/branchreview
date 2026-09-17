import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as vscode from "vscode";
import { afterEach, expect, test } from "vite-plus/test";
import { GitClient, GitOutputTooLargeError } from "../src/git/gitClient.ts";
import { ReviewManager } from "../src/review/reviewManager.ts";
import { WORKSPACE_STATE_KEY } from "../src/review/reviewState.ts";
import {
  decorationTypes,
  FakeTextEditor,
  fileSystemWatchers,
  resetFakeVscode,
  saveDocument,
  shownMessages,
  switchToEditor,
  Uri,
  type Range,
} from "./fakes/vscode.ts";

const TIMEOUT_MS = 20_000;
const plainGit = new GitClient();
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
  resetFakeVscode();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberedLines(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}

/** main: a.ts + src/b.ts; feature/demo changes a.ts line 3 and appends b.ts line 11. */
async function createReviewRepo(): Promise<{ root: string; fileA: string; fileB: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sidediff-refresh-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await plainGit.exec(root, ["init", "-b", "main"]);
  await plainGit.exec(root, ["config", "user.email", "sidediff@example.com"]);
  await plainGit.exec(root, ["config", "user.name", "SideDiff Test"]);
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

/** Git client that records every run and can wait until Git has been quiet. */
function createRecordingGit(diffError?: () => Error): {
  git: GitClient;
  calls: string[][];
  waitForGitIdle: () => Promise<void>;
} {
  const calls: string[][] = [];
  let pending = 0;
  let lastActivity = Date.now();
  const git = new GitClient(async (cwd, args) => {
    calls.push([...args]);
    pending += 1;
    lastActivity = Date.now();
    try {
      if (diffError && args[0] === "diff") {
        throw diffError();
      }
      return { stdout: `${await plainGit.exec(cwd, args)}\n`, stderr: "" };
    } finally {
      pending -= 1;
      lastActivity = Date.now();
    }
  });

  // Longer than every debounce in ReviewManager, so scheduled work has started.
  const quietMs = 300;
  const waitForGitIdle = async (): Promise<void> => {
    const start = Date.now();
    while (pending > 0 || Date.now() - Math.max(lastActivity, start) < quietMs) {
      await sleep(20);
    }
  };
  return { git, calls, waitForGitIdle };
}

async function createManager(root: string, fileA: string, fileB: string, diffError?: () => Error) {
  const recording = createRecordingGit(diffError);
  const editorA = new FakeTextEditor(fileA);
  const editorB = new FakeTextEditor(fileB);
  switchToEditor(editorA, [editorA, editorB]);

  const context = {
    extensionUri: Uri.file("/extension"),
    workspaceState: {
      get: (key: string) =>
        key === WORKSPACE_STATE_KEY
          ? { [root]: { base: "main", reviewedBySession: {} } }
          : undefined,
      update: async () => {},
    },
  };
  const manager = new ReviewManager(context as unknown as vscode.ExtensionContext, recording.git);
  cleanups.push(() => manager.dispose());
  return { manager, editorA, editorB, ...recording };
}

async function startReview(root: string, fileA: string, fileB: string, diffError?: () => Error) {
  const session = await createManager(root, fileA, fileB, diffError);
  await session.manager.resumeReview();
  await session.waitForGitIdle();
  return session;
}

function markedLines(editor: FakeTextEditor, kind: "add" | "change" | "delete"): number[] {
  const type = decorationTypes.find((t) =>
    t.options.gutterIconPath?.fsPath.endsWith(`gutter-${kind}.svg`),
  );
  const ranges = (type ? editor.decorations.get(type.key) : undefined) ?? [];
  return (ranges as Range[]).map((range) => range.start.line + 1);
}

/** `git --no-optional-locks status --porcelain` — the working-tree dirty check. */
function isDirtyCheck(args: string[]): boolean {
  return args.includes("status");
}

function fireGitDirWatchers(): void {
  for (const watcher of fileSystemWatchers) {
    watcher.fireChange();
  }
}

test(
  "switching tabs during a review runs no Git besides the dirty check",
  async () => {
    const { root, fileA, fileB } = await createReviewRepo();
    const { editorA, editorB, calls, waitForGitIdle } = await startReview(root, fileA, fileB);
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
    const { editorB, waitForGitIdle } = await startReview(root, fileA, fileB);
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
    const { manager, editorA, waitForGitIdle } = await startReview(root, fileA, fileB);
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
    const { editorA, editorB, calls, waitForGitIdle } = await createManager(root, fileA, fileB);
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
    const { calls, waitForGitIdle } = await startReview(root, fileA, fileB);
    const warmCalls = calls.length;

    await writeFile(fileA, "locally edited\n", "utf8");
    // Spread out like Save All / autosave: undebounced, every save would check Git.
    for (let i = 0; i < 5; i++) {
      saveDocument();
      await sleep(50);
    }
    await waitForGitIdle();

    const savedCalls = calls.slice(warmCalls);
    expect(savedCalls.filter((args) => args.includes("status"))).toHaveLength(1);
    expect(savedCalls.filter((args) => args[0] === "diff")).toEqual([]);
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
    cleanups.push(() => {
      process.off("unhandledRejection", recordRejection);
    });

    const { editorA, editorB, waitForGitIdle } = await startReview(
      root,
      fileA,
      fileB,
      () =>
        new GitOutputTooLargeError({
          args: ["diff"],
          cwd: root,
          limitBytes: 64 * 1024 * 1024,
        }),
    );
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
