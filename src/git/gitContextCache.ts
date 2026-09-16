import { GitError, type GitClient, type RepositoryHead } from "./gitClient.ts";
import {
  gitContextFromRepositoryHead,
  workingDirectoryFor,
  type GitContext,
} from "./repository.ts";

/**
 * Git context lookups that do not spawn Git on every tab switch (requirements §21).
 * Directory → repo root is kept for the session; HEAD / branch per repo are kept
 * until `invalidateRepositoryHeads` (git-dir watcher or window focus, D5 / D13).
 */
export class GitContextCache {
  /** Directory → owning repo root, or `null` when outside any repository. */
  private readonly rootByDirectory = new Map<string, string | null>();
  private readonly headByRoot = new Map<string, RepositoryHead>();
  /** Concurrent lookups share one `git rev-parse`, keyed by repo root when known. */
  private readonly inflight = new Map<string, Promise<GitContext | undefined>>();
  /** Bumped on invalidation so a read already in flight cannot cache a stale HEAD. */
  private generation = 0;

  constructor(private readonly git: GitClient) {}

  /**
   * Context for the repository owning `path` (file or directory).
   * `fresh` skips cached HEAD / branch — for commands that record review state.
   */
  async getContextForPath(
    path: string,
    options: { fresh?: boolean } = {},
  ): Promise<GitContext | undefined> {
    const directory = await workingDirectoryFor(path);
    const knownRoot = this.rootByDirectory.get(directory);
    if (!options.fresh) {
      if (knownRoot === null) {
        return undefined;
      }
      const cached = knownRoot === undefined ? undefined : this.headByRoot.get(knownRoot);
      if (cached) {
        return gitContextFromRepositoryHead(cached);
      }
    }

    const key = knownRoot ?? directory;
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }
    const promise = this.readRepositoryHead(directory, knownRoot ?? undefined).finally(() => {
      if (this.inflight.get(key) === promise) {
        this.inflight.delete(key);
      }
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Forget every repo's HEAD / branch, and directories that were outside a repository,
   * after a tip move, checkout, or `git init` may have happened.
   */
  invalidateRepositoryHeads(): void {
    this.generation += 1;
    this.headByRoot.clear();
    this.inflight.clear();
    for (const [directory, root] of this.rootByDirectory) {
      if (root === null) {
        this.rootByDirectory.delete(directory);
      }
    }
  }

  private async readRepositoryHead(
    directory: string,
    knownRoot: string | undefined,
  ): Promise<GitContext | undefined> {
    const generation = this.generation;
    try {
      const repository = await this.git.getRepositoryHead(knownRoot ?? directory);
      // Which repo owns a directory does not depend on HEAD; keep it across invalidation.
      this.rootByDirectory.set(directory, repository.root);
      if (generation === this.generation) {
        this.headByRoot.set(repository.root, repository);
      }
      return gitContextFromRepositoryHead(repository);
    } catch (error) {
      if (!(error instanceof GitError)) {
        throw error;
      }
      if (knownRoot !== undefined) {
        this.headByRoot.delete(knownRoot);
      }
      if (generation === this.generation) {
        this.rootByDirectory.set(directory, null);
      }
      return undefined;
    }
  }
}
