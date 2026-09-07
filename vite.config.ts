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
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
