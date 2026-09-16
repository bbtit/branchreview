import type { GitClient } from "./gitClient.ts";

/**
 * Working-tree dirtiness per repository (D2 / D11 status bar hint).
 * Overlapping checks share one `git status` so refresh bursts cannot pile up
 * processes on a large repository (MVP-10b / requirements §21). A shared answer
 * may predate the caller by one run; the next refresh corrects it.
 */
export class WorkingTreeStatus {
  private readonly inflight = new Map<string, Promise<boolean>>();

  constructor(private readonly git: GitClient) {}

  async isDirty(repoRoot: string): Promise<boolean> {
    const pending = this.inflight.get(repoRoot);
    if (pending) {
      return pending;
    }

    const promise = this.git.isWorkingTreeDirty(repoRoot).finally(() => {
      if (this.inflight.get(repoRoot) === promise) {
        this.inflight.delete(repoRoot);
      }
    });
    this.inflight.set(repoRoot, promise);
    return promise;
  }
}
