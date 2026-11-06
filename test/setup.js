// 每個測試開始前，把 schema.sql 重新套用一次。
// schema.sql 的第一段就是 DROP TABLE / DROP TRIGGER，
// 所以每個測試都是乾淨的資料庫，測試之間不會互相污染。

import { beforeEach } from "vitest";
import { env } from "cloudflare:test";

const statements = env.TEST_MIGRATIONS[0].queries;

beforeEach(async () => {
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
});
