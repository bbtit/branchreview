import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      extension: "src/extension.ts",
    },
    format: ["cjs"],
    platform: "node",
    dts: false,
    exports: false,
    sourcemap: true,
    deps: {
      neverBundle: ["vscode"],
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // `vscode` only exists inside the extension host; ReviewManager tests use a fake.
    alias: {
      vscode: fileURLToPath(new URL("./tests/fakes/vscode.ts", import.meta.url)),
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
