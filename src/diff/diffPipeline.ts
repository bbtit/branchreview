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

type InflightEntry = DiffCacheKey & {
  promise: Promise<ChangedFile[]>;
};

/**
 * Loads `base...HEAD` changed files with a (base, HEAD) cache per repository,
 * so multi-root reviews do not evict each other (D9 / requirements §21).
 * Does not run Git when overlay is off or base is unset (MVP-04).
 * Coalesces in-flight fetches for the same key so gutters + Tree refresh
 * do not double-hit Git (MVP-10).
 * Pure of VS Code UI — decorations / Tree subscribe later.
 */
export class DiffPipeline {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, InflightEntry>();

  constructor(private readonly git: GitClient) {}

  /**
   * Returns changed files for the active review, or `undefined` when
   * computation is skipped (overlay off / no base).
   */
  async getChangedFiles(query: DiffQuery): Promise<ChangedFile[] | undefined> {
    if (!query.overlayActive || query.base === undefined || query.base === "") {
      return undefined;
    }

    const hit = this.cache.get(query.repoRoot);
    if (hit && hit.base === query.base && hit.head === query.head) {
      return hit.files;
    }

    const pending = this.inflight.get(query.repoRoot);
    if (pending && pending.base === query.base && pending.head === query.head) {
      return pending.promise;
    }

    const key: DiffCacheKey = {
      repoRoot: query.repoRoot,
      base: query.base,
      head: query.head,
    };
    const promise = this.git.getChangedFiles(key.repoRoot, key.base, key.head).then(
      (files) => {
        // Only the latest fetch for this repo may populate; clearCache drops it.
        if (this.inflight.get(key.repoRoot)?.promise === promise) {
          this.inflight.delete(key.repoRoot);
          this.cache.set(key.repoRoot, { ...key, files });
        }
        return files;
      },
      (error: unknown) => {
        if (this.inflight.get(key.repoRoot)?.promise === promise) {
          this.inflight.delete(key.repoRoot);
        }
        throw error;
      },
    );

    this.inflight.set(key.repoRoot, { ...key, promise });
    return promise;
  }

  /** Drop one repository's cached diff (e.g. Stop / Clear, or forced refresh). */
  clearCache(repoRoot: string): void {
    this.cache.delete(repoRoot);
    this.inflight.delete(repoRoot);
  }

  /** Test/inspection helper — a repository's current cache key, if any. */
  getCacheKey(repoRoot: string): DiffCacheKey | undefined {
    const entry = this.cache.get(repoRoot);
    if (!entry) {
      return undefined;
    }
    return {
      repoRoot: entry.repoRoot,
      base: entry.base,
      head: entry.head,
    };
  }
}
