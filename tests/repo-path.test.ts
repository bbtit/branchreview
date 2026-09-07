import { expect, test } from "vite-plus/test";
import { repoRelativePath } from "../src/git/repoPath.ts";

test("converts an absolute file path to a repo-relative POSIX path", () => {
  expect(repoRelativePath("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
  expect(repoRelativePath("/repo", "/repo/a.ts")).toBe("a.ts");
});
