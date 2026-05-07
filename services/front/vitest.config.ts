import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@",
        replacement: resolve(__dirname, "src"),
      },
      {
        find: /^@home-presence-monitor\/config\/(.*)$/,
        replacement: resolve(__dirname, "../../packages/config") + "/$1",
      },
      {
        find: "@home-presence-monitor/contracts/api",
        replacement: resolve(
          __dirname,
          "../../packages/contracts/api/index.ts",
        ),
      },
    ],
  },
  test: {
    environment: "node",
  },
});
