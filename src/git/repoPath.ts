import { relative } from "node:path";

/** Repo-relative POSIX path for matching `ChangedFile.path`. */
export function repoRelativePath(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).split("\\").join("/");
}
