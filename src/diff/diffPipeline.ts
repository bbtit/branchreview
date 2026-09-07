import type { GitClient } from "../git/gitClient.ts";
import type { ChangedFile } from "./types.ts";

export type DiffCacheKey = {
  repoRoot: string;
  base: string;
  head: string;
};

export type DiffQuery = {
  repoRoot: string;
  /** Remembered review base; required when overlay is on. */
  base: string | undefined;
  head: string;
  overlayActive: boolean;
};

type CacheEntry = DiffCacheKey & {
  files: ChangedFile[];
};

/**
 * Loads `base...HEAD` changed files with a (repo, base, HEAD) cache.
 * Does not run Git when overlay is off or base is unset (MVP-04).
 * Pure of VS Code UI — decorations / Tree subscribe later.
 */
export class DiffPipeline {
  private cache: CacheEntry | undefined;

  constructor(private readonly git: GitClient) {}

  /**
   * Returns changed files for the active review, or `undefined` when
   * computation is skipped (overlay off / no base).
   */
  async getChangedFiles(query: DiffQuery): Promise<ChangedFile[] | undefined> {
    if (!query.overlayActive || query.base === undefined || query.base === "") {
      return undefined;
    }

    const hit = this.cache;
    if (
      hit &&
      hit.repoRoot === query.repoRoot &&
      hit.base === query.base &&
      hit.head === query.head
    ) {
      return hit.files;
    }

    const files = await this.git.getChangedFiles(query.repoRoot, query.base, query.head);
    this.cache = {
      repoRoot: query.repoRoot,
      base: query.base,
      head: query.head,
      files,
    };
    return files;
  }

  /** Drop cached diff (e.g. Stop / Clear, or forced refresh). */
  clearCache(): void {
    this.cache = undefined;
  }

  /** Test/inspection helper — current cache key, if any. */
  getCacheKey(): DiffCacheKey | undefined {
    if (!this.cache) {
      return undefined;
    }
    return {
      repoRoot: this.cache.repoRoot,
      base: this.cache.base,
      head: this.cache.head,
    };
  }
}
