import type * as vscode from "vscode";
import { GitClient } from "../../src/git/gitClient.ts";
import { ReviewManager } from "../../src/review/reviewManager.ts";
import { WORKSPACE_STATE_KEY } from "../../src/review/reviewState.ts";
import {
  decorationTypes,
  fileSystemWatchers,
  statusBarItems,
  switchToEditor,
  treeDataProviders,
  Uri,
  type FakeTextEditor,
  type Range,
} from "../fakes/vscode.ts";

/** Real Git for building fixtures; never counted in a session's recorded calls. */
export const plainGit = new GitClient();

const cleanups: (() => Promise<void> | void)[] = [];

export function registerCleanup(cleanup: () => Promise<void> | void): void {
  cleanups.push(cleanup);
}

export async function runCleanups(): Promise<void> {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ReviewSession = {
  manager: ReviewManager;
  calls: string[][];
  waitForGitIdle: () => Promise<void>;
};

export type ReviewSessionOptions = {
  root: string;
  /** Visible editors; the first one is active. */
  editors: FakeTextEditor[];
  base?: string;
  /** Makes every `git diff` fail, for error-path tests. */
  diffError?: () => Error;
};

/** Git client that records every run and can wait until Git has been quiet. */
export function createRecordingGit(diffError?: () => Error): {
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
      if (diffError && args.includes("diff")) {
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

/** Build a ReviewManager over the fake `vscode`, with the overlay still off. */
export function createReviewSession(options: ReviewSessionOptions): ReviewSession {
  const recording = createRecordingGit(options.diffError);
  const active = options.editors[0];
  if (active) {
    switchToEditor(active, options.editors);
  }

  const base = options.base ?? "main";
  const context = {
    extensionUri: Uri.file("/extension"),
    workspaceState: {
      get: (key: string) =>
        key === WORKSPACE_STATE_KEY
          ? { [options.root]: { base, reviewedBySession: {} } }
          : undefined,
      update: async () => {},
    },
  };
  const manager = new ReviewManager(context as unknown as vscode.ExtensionContext, recording.git);
  registerCleanup(() => manager.dispose());
  return { manager, ...recording };
}

/** Build a ReviewManager and resume the remembered review (overlay on). */
export async function startReview(options: ReviewSessionOptions): Promise<ReviewSession> {
  const session = createReviewSession(options);
  await session.manager.resumeReview();
  await session.waitForGitIdle();
  return session;
}

/** 1-based lines carrying a given gutter mark in an editor. */
export function markedLines(editor: FakeTextEditor, kind: "add" | "change" | "delete"): number[] {
  const type = decorationTypes.find((t) =>
    t.options.gutterIconPath?.fsPath.endsWith(`gutter-${kind}.svg`),
  );
  const ranges = (type ? editor.decorations.get(type.key) : undefined) ?? [];
  return (ranges as Range[]).map((range) => range.start.line + 1);
}

/** `git --no-optional-locks status --porcelain` — the working-tree dirty check. */
export function isDirtyCheck(args: string[]): boolean {
  return args.includes("status");
}

export function fireGitDirWatchers(): void {
  for (const watcher of fileSystemWatchers) {
    watcher.fireChange();
  }
}

export type RenderedTreeRow = { kind: string; label: string; description?: string };

/** Rows the Changes view would render right now. */
export function treeRows(): RenderedTreeRow[] {
  const provider = treeDataProviders[0];
  return provider ? (provider.getChildren() as RenderedTreeRow[]) : [];
}

export function statusBarText(): string {
  return statusBarItems[0]?.text ?? "";
}
