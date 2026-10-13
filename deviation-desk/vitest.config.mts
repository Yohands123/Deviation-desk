import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const unitInclude = ["src/**/*.test.ts", "evals/**/*.test.ts", "scripts/**/*.test.ts"];
const dbTests = "**/*.db.test.ts";

export default defineConfig(({ mode }) => {
  // Load .env / .env.local into the main process too (global setup runs there); real env vars win.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
    process.env[key] ??= value;
  }

  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        // server-only throws outside a React Server Components build; tests are server code.
        "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
      },
    },
    test: {
      environment: "node",
      projects: [
        { extends: true, test: { name: "unit", include: unitInclude, exclude: [dbTests] } },
        {
          extends: true,
          test: {
            name: "db",
            include: [`src/${dbTests}`],
            globalSetup: ["src/db/test-setup.ts"],
            // One shared database: each file seeds its own company, but files run one at a time.
            fileParallelism: false,
            testTimeout: 30_000,
            hookTimeout: 60_000,
          },
        },
      ],
    },
  };
});
