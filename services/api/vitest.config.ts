import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "src",
        replacement: resolve(__dirname, "src"),
      },
      {
        find: "@home-presence-monitor/contracts/api",
        replacement: resolve(
          __dirname,
          "../../packages/contracts/api/index.ts",
        ),
      },
      {
        find: /^@home-presence-monitor\/db\/(.*)$/,
        replacement: resolve(__dirname, "../../packages/db/src") + "/$1",
      },
    ],
  },
  test: {
    environment: "node",
  },
});
