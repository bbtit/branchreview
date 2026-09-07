import { expect, test } from "vite-plus/test";
import { extensionId, productName } from "../src/identity.ts";

test("identifies as SideDiff (bbtit.sidediff)", () => {
  expect(productName()).toBe("SideDiff");
  expect(extensionId()).toBe("bbtit.sidediff");
});
