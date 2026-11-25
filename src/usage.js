// D1 用量計：記錄這個網站讀、寫了資料庫幾列（Cloudflare D1 免費額度就是用「列數」計算）。
//
// 每次查詢的結果都附有 meta.rows_read / meta.rows_written，這裡把它們加總，
// 每 10 秒以「每分鐘一列」寫進 usage_minutes，後台再加總成今天的用量。
// 免費額度每天 UTC 0 點（台灣時間早上 8 點）歸零，是整個 Cloudflare 帳號共用的。

export const FREE_ROWS_READ = 5000000;
export const FREE_ROWS_WRITTEN = 100000;
const FLUSH_MS = 10000;

let buckets = new Map(); // 分鐘編號 → { read, written, requests }
let lastFlush = 0;

const minuteOf = (now) => Math.floor(now / 60000);
function bucket(now = Date.now()) {
  const m = minuteOf(now);
  let b = buckets.get(m);
  if (!b) buckets.set(m, (b = { read: 0, written: 0, requests: 0 }));
  return b;
}
function add(meta) {
  if (!meta) return;
  const b = bucket();
  b.read += Number(meta.rows_read) || 0;
  b.written += Number(meta.rows_written) || 0;
}
export function noteUsageRequest(now = Date.now()) { bucket(now).requests++; }

// 包一層 D1：用法和原本完全一樣，只是順便記下每次查詢讀寫了幾列。
class MeteredStatement {
  constructor(stmt) { this.stmt = stmt; }
  bind(...values) { return new MeteredStatement(this.stmt.bind(...values)); }
  // D1 的 first() 不回傳 meta，改用 all() 取第一列；D1 的 first() 本來就會執行整句查詢，讀取列數相同。
  async first(column) {
    const result = await this.stmt.all();
    add(result.meta);
    const row = result.results[0];
    if (row === undefined) return null;
    return column === undefined ? row : (row[column] ?? null);
  }
  async all() { const result = await this.stmt.all(); add(result.meta); return result; }
  async run() { const result = await this.stmt.run(); add(result.meta); return result; }
  raw(options) { return this.stmt.raw(options); }
}
export function meter(db) {
  return {
    prepare: (sql) => new MeteredStatement(db.prepare(sql)),
    async batch(statements) {
      const results = await db.batch(statements.map(s => (s instanceof MeteredStatement ? s.stmt : s)));
      for (const r of results) add(r.meta);
      return results;
    },
    exec: (sql) => db.exec(sql),
    dump: () => db.dump(),
  };
}

const UPSERT = `INSERT INTO usage_minutes(minute,rows_read,rows_written,requests) VALUES(?,?,?,?)
  ON CONFLICT(minute) DO UPDATE SET rows_read=rows_read+excluded.rows_read,
    rows_written=rows_written+excluded.rows_written, requests=requests+excluded.requests`;

// 把累積的用量寫進資料庫。寫入本身也算用量，會記到下一次。
// 執行個體被回收時，最後不到 10 秒的數字會遺失，所以後台顯示的是「約略值」（偏低一點點）。
export async function flushUsage(db, now = Date.now(), force = false) {
  if (!buckets.size || (!force && now - lastFlush < FLUSH_MS)) return;
  lastFlush = now;
  const entries = [...buckets];
  buckets = new Map();
  const statements = entries.map(([m, b]) => db.prepare(UPSERT).bind(m, b.read, b.written, b.requests));
  // 偶爾清掉 3 天前的紀錄（依主鍵範圍刪除，很便宜）。
  if (Math.random() < 0.02) statements.push(db.prepare('DELETE FROM usage_minutes WHERE minute<?').bind(minuteOf(now) - 3 * 1440));
  try {
    const results = await db.batch(statements);
    for (const r of results) add(r.meta);
  } catch (err) {
    // 還沒套用 0017 遷移時沒有這張表：不影響玩家，只是沒有用量紀錄。
    console.error('usage flush failed', String(err));
  }
}

// 後台用：今天（UTC 日）累計、最近 30 分鐘每分鐘的用量、照最近 5 分鐘速度推算多久用完。
export async function usageReport(db, now = Date.now()) {
  const dayStartMs = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const dayStart = minuteOf(dayStartMs), current = minuteOf(now);
  const [totals, recent] = await db.batch([
    db.prepare('SELECT COALESCE(SUM(rows_read),0) AS rows_read, COALESCE(SUM(rows_written),0) AS rows_written, COALESCE(SUM(requests),0) AS requests FROM usage_minutes WHERE minute>=?').bind(dayStart),
    db.prepare('SELECT minute, rows_read, rows_written, requests FROM usage_minutes WHERE minute>=? ORDER BY minute').bind(Math.max(dayStart, current - 29)),
  ]);
  const t = totals.results[0];
  const pending = [...buckets].filter(([m]) => m >= dayStart).reduce((s, [, b]) => ({ read: s.read + b.read, written: s.written + b.written, requests: s.requests + b.requests }), { read: 0, written: 0, requests: 0 });
  const read = Number(t.rows_read) + pending.read, written = Number(t.rows_written) + pending.written;
  // 最近 5 分鐘（不含還沒過完的這一分鐘）的平均每分鐘用量
  const last5 = recent.results.filter(r => r.minute >= current - 5 && r.minute < current);
  const perMin = (k) => last5.reduce((s, r) => s + Number(r[k]), 0) / 5;
  const readRate = perMin('rows_read'), writeRate = perMin('rows_written'), requestRate = perMin('requests');
  const minutesLeft = (left, rate) => (rate > 0 ? Math.max(0, Math.floor(left / rate)) : null);
  return {
    day: new Date(dayStartMs).toISOString().slice(0, 10),
    resetAt: dayStartMs + 86400000,
    limits: { rowsRead: FREE_ROWS_READ, rowsWritten: FREE_ROWS_WRITTEN },
    used: { rowsRead: read, rowsWritten: written, requests: Number(t.requests) + pending.requests },
    perMinute: { rowsRead: Math.round(readRate), rowsWritten: Math.round(writeRate), requests: Math.round(requestRate) },
    minutesLeft: {
      rowsRead: minutesLeft(FREE_ROWS_READ - read, readRate),
      rowsWritten: minutesLeft(FREE_ROWS_WRITTEN - written, writeRate),
    },
    recent: recent.results,
  };
}

// 選用：設定 CF_API_TOKEN（權限 Account Analytics:Read）與 CF_ACCOUNT_ID 後，
// 另外向 Cloudflare 查官方統計（整個帳號所有資料庫加總，約有幾分鐘延遲）。結果快取 60 秒。
let official = null;
export async function officialUsage(env, now = Date.now()) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return null;
  if (official && now - official.at < 60000) return official.value;
  const day = new Date(now).toISOString().slice(0, 10);
  const query = 'query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){d1AnalyticsAdaptiveGroups(limit:100,filter:{date:$d}){sum{rowsRead rowsWritten}}}}}';
  let value;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.CF_API_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { a: env.CF_ACCOUNT_ID, d: day } }),
    });
    const data = await res.json();
    const groups = data?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
    if (!groups) throw new Error(data?.errors?.[0]?.message || 'HTTP ' + res.status);
    value = { ok: true, rowsRead: groups.reduce((s, g) => s + g.sum.rowsRead, 0), rowsWritten: groups.reduce((s, g) => s + g.sum.rowsWritten, 0) };
  } catch (err) {
    value = { ok: false, message: String(err.message || err).slice(0, 200) };
  }
  official = { at: now, value };
  return value;
}
