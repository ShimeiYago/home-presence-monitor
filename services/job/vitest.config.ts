import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@home-presence-monitor/config": path.resolve(
        __dirname,
        "../../packages/config",
      ),
      "@home-presence-monitor/db": path.resolve(
        __dirname,
        "../../packages/db/src",
      ),
    },
  },
});
