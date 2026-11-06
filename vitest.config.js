import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

// 測試跑在真正的 Workers runtime（Miniflare）裡，
// 所以 `env.DB` 是真的 D1，`SELF.fetch()` 會打到真的 Worker。
//
// schema.sql 由 plugin 在 Node 端讀取並切成一句一句，
// 再透過 binding 傳進測試環境套用；不需要在測試裡複製一份 schema。
const migrations = await readD1Migrations({
  migrationsDir: ".",
  migrationsPattern: "schema.sql",
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.js"],
  },
});
