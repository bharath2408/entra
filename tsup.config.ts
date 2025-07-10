import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  splitting: false,
  clean: true,
  target: "node18",
  outDir: "dist",
});
