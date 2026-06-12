import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: false,
  entry: [
    "core/src/index.ts",
    "core/src/client.ts",
    "core/src/server.ts",
    "core/src/project-config.ts",
    "cli/bin.ts",
  ],
  format: "esm",
  outDir: "dist",
  sourcemap: true,
  target: "esnext",
});
