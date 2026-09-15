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
 * Coalesces in-flight fetches for the same key so gutters + Tree refresh
 * do not double-hit Git (MVP-10 / requirements §21).
 * Pure of VS Code UI — decorations / Tree subscribe later.
 */
export class DiffPipeline {
  private cache: CacheEntry | undefined;
  private inflight:
    | {
        repoRoot: string;
        base: string;
        head: string;
        promise: Promise<ChangedFile[]>;
      }
    | undefined;
  /** Bumped on clearCache so a stale in-flight fetch cannot repopulate. */
  private generation = 0;

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

    const pending = this.inflight;
    if (
      pending &&
      pending.repoRoot === query.repoRoot &&
      pending.base === query.base &&
      pending.head === query.head
    ) {
      return pending.promise;
    }

    const generation = this.generation;
    const base = query.base;
    const promise = this.git.getChangedFiles(query.repoRoot, base, query.head).then(
      (files) => {
        if (this.inflight?.promise === promise) {
          this.inflight = undefined;
        }
        if (generation === this.generation) {
          this.cache = {
            repoRoot: query.repoRoot,
            base,
            head: query.head,
            files,
          };
        }
        return files;
      },
      (error: unknown) => {
        if (this.inflight?.promise === promise) {
          this.inflight = undefined;
        }
        throw error;
      },
    );

    this.inflight = {
      repoRoot: query.repoRoot,
      base,
      head: query.head,
      promise,
    };
    return promise;
  }

  /** Drop cached diff (e.g. Stop / Clear, or forced refresh). */
  clearCache(): void {
    this.cache = undefined;
    this.inflight = undefined;
    this.generation += 1;
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
