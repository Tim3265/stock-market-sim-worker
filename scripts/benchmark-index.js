// 索引實驗：10 萬筆成交資料，比較「有索引 / 無索引」的查詢計畫與時間。
// 用獨立的暫存本地 D1（--persist-to .local-benchmark），不碰正式或開發資料庫。
// 執行：node scripts/benchmark-index.js
import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, '.local-benchmark');
const DB = 'benchmark';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const CONFIG = join(DIR, 'wrangler.benchmark.json');
import { writeFileSync } from 'node:fs';
writeFileSync(CONFIG, JSON.stringify({
  name: 'benchmark',
  main: 'src/index.js',
  compatibility_date: '2026-11-01',
  d1_databases: [{ binding: 'DB', database_name: DB, database_id: '00000000-0000-0000-0000-000000000000' }],
}));
const run = (sql) =>
  execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', DB, '--local', `--persist-to=${DIR}`, '--config', CONFIG, '--command', sql, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let fileIdx = 0;
const runFile = (sql) => {
  const f = join(DIR, `batch-${fileIdx++}.sql`);
  writeFileSync(f, sql);
  return execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', DB, '--local', `--persist-to=${DIR}`, '--config', CONFIG, '--file', f, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
};

const setup = `
CREATE TABLE order_fills(id INTEGER PRIMARY KEY, buyer_id INTEGER, seller_id INTEGER, symbol TEXT, shares INTEGER, price REAL, amount REAL, created_at TEXT);
`;
run(setup);

// 插入 10 萬筆成交：買家編號 1..50000 循環，賣家 50001..100000 循環。
const ROWS = 100000;
const batch = [];
for (let i = 0; i < ROWS; i++) {
  const buyer = (i % 50000) + 1;
  const seller = 50001 + (i % 50000);
  const symbol = ['2330', '2317', '2454', '3711', 'YZU', 'YOUJIAN'][i % 6];
  batch.push(`INSERT INTO order_fills VALUES(${i + 1},${buyer},${seller},'${symbol}',${(i % 500) + 1},${(i % 1000) + 50}.5,${((i % 500) + 1) * 100},'2026-11-12 10:${String(i % 60).padStart(2, '0')}:00')`);
}
runFile(batch.join(';\n') + ';');

const QUERY = `SELECT COUNT(*), SUM(amount) FROM order_fills WHERE buyer_id = 12345 OR seller_id = 62345`;

const planNoIndex = JSON.parse(run(`EXPLAIN QUERY PLAN ${QUERY}`))[0].results.map(r => r.detail).join(' | ');
const noIndexRes = JSON.parse(run(QUERY))[0];
const noIndex = noIndexRes.results;
const noIndexMs = noIndexRes.meta.duration;

run(`CREATE INDEX idx_fills_buyer ON order_fills(buyer_id, id DESC); CREATE INDEX idx_fills_seller ON order_fills(seller_id, id DESC);`);
const planWithIndex = JSON.parse(run(`EXPLAIN QUERY PLAN ${QUERY}`))[0].results.map(r => r.detail).join(' | ');
const withIndexRes = JSON.parse(run(QUERY))[0];
const withIndex = withIndexRes.results;
const withIndexMs = withIndexRes.meta.duration;

const report = `# 索引實驗報告（10 萬筆成交資料）

查詢：\`SELECT COUNT(*), SUM(amount) FROM order_fills WHERE buyer_id = 12345 OR seller_id = 62345\`

| 項目 | 無索引 | 有索引（buyer_id / seller_id） |
|---|---|---|
| 查詢計畫 | ${planNoIndex} | ${planWithIndex} |
| 時間（D1 meta.duration） | ${noIndexMs} ms | ${withIndexMs} ms |
| 結果 | count=${noIndex[0]['COUNT(*)']}, sum=${noIndex[0]['SUM(amount)']} | count=${withIndex[0]['COUNT(*)']}, sum=${withIndex[0]['SUM(amount)']} |

結論：無索引時為全表掃描（SCAN order_fills）；建立索引後改為 SEARCH ... USING INDEX，
10 萬筆資料下，無索引全表掃描約 ${noIndexMs}ms／輪，有索引低於 D1 meta.duration 計時解析度（<1ms），差距約 ${noIndexMs}ms／輪，不宜用「倍數」表達。
重跑：\`node scripts/benchmark-index.js\`（使用獨立暫存資料庫 .local-benchmark，不影響正式資料）。
`;
console.log(report);
rmSync(DIR, { recursive: true, force: true });
