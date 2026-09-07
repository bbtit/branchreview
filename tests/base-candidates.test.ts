import { expect, test } from "vite-plus/test";
import { orderBaseCandidates } from "../src/review/baseCandidates.ts";

test("puts the previous base first, then the usual remote defaults", () => {
  const ordered = orderBaseCandidates(
    ["feature/x", "origin/main", "main", "origin/develop", "upstream/main"],
    "feature/x",
  );

  expect(ordered.slice(0, 5)).toEqual([
    "feature/x",
    "upstream/main",
    "origin/main",
    "main",
    "origin/develop",
  ]);
});

test("keeps a previous SHA base even when it is not a branch ref", () => {
  const ordered = orderBaseCandidates(["origin/main", "main"], "abc1234");

  expect(ordered[0]).toBe("abc1234");
  expect(ordered).toContain("origin/main");
  expect(ordered).toContain("main");
});

test("sorts remaining refs after develop-family names", () => {
  const ordered = orderBaseCandidates(["zzz", "develop", "origin/develop", "aaa", "origin/main"]);

  expect(ordered[0]).toBe("origin/main");
  const developIdx = ordered.indexOf("develop");
  const originDevelopIdx = ordered.indexOf("origin/develop");
  const aaaIdx = ordered.indexOf("aaa");
  const zzzIdx = ordered.indexOf("zzz");
  expect(developIdx).toBeGreaterThan(-1);
  expect(originDevelopIdx).toBeGreaterThan(-1);
  expect(Math.max(developIdx, originDevelopIdx)).toBeLessThan(aaaIdx);
  expect(aaaIdx).toBeLessThan(zzzIdx);
});

test("does not duplicate refs that appear in multiple priority buckets", () => {
  const ordered = orderBaseCandidates(["origin/main", "main"], "origin/main");
  expect(ordered.filter((r) => r === "origin/main")).toHaveLength(1);
});
