import { expect, test } from "vite-plus/test";
import { extensionId, productName } from "../src/identity.ts";

test("product identity", () => {
  expect(productName()).toBe("SideDiff");
  expect(extensionId()).toBe("bbtit.sidediff");
});
