import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@home-presence-monitor\/config\/(.*)$/,
        replacement: resolve(__dirname, "../../packages/config") + "/$1",
      },
    ],
  },
  test: {
    environment: "node",
  },
});
