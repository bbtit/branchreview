import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { GitClient } from "./gitClient.ts";
import { GitError } from "./gitClient.ts";

/**
 * Git context for the repository that owns a given file (D9).
 * Detached HEAD is detectable and not reviewable (D15).
 */
export type GitContext = {
  /** Absolute repository root (`git rev-parse --show-toplevel`). */
  root: string;
  /** Current HEAD SHA. */
  head: string;
  /** Branch name, or `null` when detached. */
  branch: string | null;
  /** True when HEAD is detached. */
  detached: boolean;
  /**
   * Whether a SideDiff review session may start.
   * False when detached (D15); start UI refusal is MVP-03.
   */
  reviewable: boolean;
};

async function workingDirectoryFor(path: string): Promise<string> {
  try {
    const info = await stat(path);
    return info.isDirectory() ? path : dirname(path);
  } catch {
    return dirname(path);
  }
}

/**
 * Return repo / branch / HEAD for the Git repository that owns `path`
 * (file or directory). `undefined` when the path is not inside a repository.
 */
export async function getGitContextForFile(
  client: GitClient,
  path: string,
): Promise<GitContext | undefined> {
  const cwd = await workingDirectoryFor(path);
  try {
    const root = await client.getRepositoryRoot(cwd);
    const head = await client.getCurrentRevision(root);
    const branch = await client.getBranchName(root);
    const detached = branch === null;
    return {
      root,
      head,
      branch,
      detached,
      reviewable: !detached,
    };
  } catch (error) {
    if (error instanceof GitError) {
      return undefined;
    }
    throw error;
  }
}

export function formatGitContext(context: GitContext): string {
  const shortHead = context.head.slice(0, 12);
  if (context.detached) {
    return `detached ${shortHead} — review not available · ${context.root}`;
  }
  return `${context.branch} @ ${shortHead} · ${context.root}`;
}
