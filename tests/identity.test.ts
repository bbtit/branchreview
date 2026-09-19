import { expect, test } from "vite-plus/test";
import { extensionId, productName } from "../src/identity.ts";

test("identifies as BranchReview (bbtit.branchreview)", () => {
  expect(productName()).toBe("BranchReview");
  expect(extensionId()).toBe("bbtit.branchreview");
});
