import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@raycast/api": resolve(__dirname, "src/test/raycast-api.ts"),
    },
  },
});
