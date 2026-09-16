import { execFile } from "node:child_process";
import { isAbsolute, normalize, resolve } from "node:path";
import { promisify } from "node:util";
import { buildGitDiff } from "../diff/buildChangedFiles.ts";
import type { ChangedFile, GitDiff } from "../diff/types.ts";

const execFileAsync = promisify(execFile);

export type GitExecResult = {
  stdout: string;
  stderr: string;
};

export type GitRunner = (cwd: string, args: readonly string[]) => Promise<GitExecResult>;

/** Repository root with its HEAD SHA and branch (`null` when detached). */
export type RepositoryHead = {
  root: string;
  head: string;
  branch: string | null;
};

export class GitError extends Error {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stderr: string;
  readonly code: number | null;

  constructor(
    message: string,
    options: {
      args: readonly string[];
      cwd: string;
      stderr: string;
      code: number | null;
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GitError";
    this.args = options.args;
    this.cwd = options.cwd;
    this.stderr = options.stderr;
    this.code = options.code;
  }
}

async function defaultRunner(cwd: string, args: readonly string[]): Promise<GitExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (error) {
    const err = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const exitCode = typeof err.code === "number" ? err.code : null;
    throw new GitError(err.message || "git command failed", {
      args,
      cwd,
      stderr: typeof err.stderr === "string" ? err.stderr : "",
      code: exitCode,
      cause: error,
    });
  }
}

/**
 * All Git CLI execution goes through this client (requirements §17).
 */
export class GitClient {
  private readonly runner: GitRunner;

  constructor(runner: GitRunner = defaultRunner) {
    this.runner = runner;
  }

  async exec(cwd: string, args: readonly string[]): Promise<string> {
    const { stdout } = await this.runner(cwd, args);
    return stdout.replace(/\r?\n$/, "");
  }

  /**
   * Three-dot diff only: `git diff --unified=0 <base>...<head>`.
   * Compares merge-base(base, head)..head — never the working tree (D2).
   */
  async getUnifiedDiff(cwd: string, base: string, head = "HEAD"): Promise<string> {
    return this.exec(cwd, ["diff", "--unified=0", `${base}...${head}`]);
  }

  /** `git diff --name-status <base>...<head>`. */
  async getNameStatus(cwd: string, base: string, head = "HEAD"): Promise<string> {
    return this.exec(cwd, ["diff", "--name-status", `${base}...${head}`]);
  }

  /** Parsed `base...HEAD` diff model (requirements §17 / §18). */
  async getDiff(cwd: string, base: string, head = "HEAD"): Promise<GitDiff> {
    const headSha =
      head === "HEAD"
        ? await this.getCurrentRevision(cwd)
        : await this.exec(cwd, ["rev-parse", head]);
    const [nameStatus, unified] = await Promise.all([
      this.getNameStatus(cwd, base, head),
      this.getUnifiedDiff(cwd, base, head),
    ]);
    return buildGitDiff(base, headSha, nameStatus, unified);
  }

  async getChangedFiles(cwd: string, base: string, head = "HEAD"): Promise<ChangedFile[]> {
    return (await this.getDiff(cwd, base, head)).files;
  }

  async getRepositoryRoot(cwd: string): Promise<string> {
    return this.exec(cwd, ["rev-parse", "--show-toplevel"]);
  }

  /**
   * Absolute path to the Git directory (`rev-parse --git-dir`).
   * Resolves worktrees where `.git` is a file pointing at the real git dir.
   */
  async getGitDir(cwd: string): Promise<string> {
    const dir = await this.exec(cwd, ["rev-parse", "--git-dir"]);
    return isAbsolute(dir) ? normalize(dir) : resolve(cwd, dir);
  }

  /** Full SHA of HEAD. */
  async getCurrentRevision(cwd: string): Promise<string> {
    return this.exec(cwd, ["rev-parse", "HEAD"]);
  }

  /**
   * Current branch name, or `null` when HEAD is detached (D15).
   * `git rev-parse --abbrev-ref HEAD` prints `HEAD` when detached.
   */
  async getBranchName(cwd: string): Promise<string | null> {
    const name = await this.exec(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (name === "HEAD") {
      return null;
    }
    return name;
  }

  /**
   * Root, HEAD SHA, and branch of the repository owning `cwd` in one `rev-parse`,
   * so editor refreshes spawn a single process (requirements §21).
   */
  async getRepositoryHead(cwd: string): Promise<RepositoryHead> {
    const args = ["rev-parse", "--show-toplevel", "HEAD", "--abbrev-ref", "HEAD"];
    const [root, head, abbrevRef] = (await this.exec(cwd, args)).split(/\r?\n/);
    if (!root || !head || !abbrevRef) {
      throw new GitError("unexpected git rev-parse output", { args, cwd, stderr: "", code: null });
    }
    return { root, head, branch: abbrevRef === "HEAD" ? null : abbrevRef };
  }

  async isDetachedHead(cwd: string): Promise<boolean> {
    return (await this.getBranchName(cwd)) === null;
  }

  /**
   * True when `revision` resolves to a commit (D17).
   * Uses `rev^{commit}` so tags/branches that point at commits are accepted.
   */
  async revisionExists(cwd: string, revision: string): Promise<boolean> {
    try {
      await this.exec(cwd, ["rev-parse", "--verify", `${revision}^{commit}`]);
      return true;
    } catch (error) {
      if (error instanceof GitError) {
        return false;
      }
      throw error;
    }
  }

  /** Local and remote branch short names (`main`, `origin/main`, …). */
  async listBranchRefs(cwd: string): Promise<string[]> {
    const stdout = await this.exec(cwd, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads/",
      "refs/remotes/",
    ]);
    if (!stdout) {
      return [];
    }
    return stdout.split(/\r?\n/).filter((line) => line.length > 0);
  }

  /**
   * True when the working tree or index differs from HEAD
   * (untracked files count as dirty).
   */
  async isWorkingTreeDirty(cwd: string): Promise<boolean> {
    const stdout = await this.exec(cwd, ["status", "--porcelain"]);
    return stdout.length > 0;
  }
}
