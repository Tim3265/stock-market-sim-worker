// ============================================================
//  股市模擬 v2 — Cloudflare Worker + D1
//
//  對照課堂的 PHP 版本：
//    PHP 的 $conn = new mysqli(...)   →  這裡的 env.DB
//    PHP 的 $conn->query("...")       →  env.DB.prepare("...").all()
// ============================================================

const round2 = (n) => Math.round(n * 100) / 100;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/stocks") return await listStocks(env);
      if (url.pathname === "/api/account") return await getAccount(env, url);
      if (url.pathname === "/api/trades") return await getTrades(env, url);
      if (url.pathname === "/api/trade" && request.method === "POST") {
        return await trade(request, env);
      }

      // 未知的 /api/* 要回 404 JSON，不要回網頁
      // （否則舊版前端會拿到 HTML，解析失敗後卡在「處理中…」）
      if (url.pathname.startsWith("/api/")) {
        return Response.json(
          { ok: false, error: `找不到 API：${url.pathname}` },
          { status: 404 }
        );
      }

      return new Response(PAGE_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch (err) {
      return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
  },
};

// ---------- 查詢：所有股票 ----------
async function listStocks(env) {
  const { results } = await env.DB
    .prepare("SELECT symbol, name, price FROM stocks ORDER BY symbol")
    .all();

  return Response.json(results);
}

// ---------- 查詢：帳戶 + 持股 + 資產結算 ----------
async function getAccount(env, url) {
  const id = Number(url.searchParams.get("id") ?? 1);

  const account = await env.DB
    .prepare("SELECT id, name, initial_cash, cash FROM accounts WHERE id = ?")
    .bind(id)
    .first();

  if (!account) {
    return Response.json({ ok: false, error: "找不到帳戶" }, { status: 404 });
  }

  const { results: holdings } = await env.DB
    .prepare(
      `SELECT h.symbol, s.name, h.shares, s.price,
              ROUND(h.shares * s.price, 2) AS market_value
         FROM holdings h
         JOIN stocks s ON s.symbol = h.symbol
        WHERE h.account_id = ? AND h.shares > 0
        ORDER BY market_value DESC`
    )
    .bind(id)
    .all();

  const marketValue = round2(
    holdings.reduce((sum, h) => sum + Number(h.market_value), 0)
  );
  const cash = Number(account.cash);
  const totalAssets = round2(cash + marketValue);
  const profit = round2(totalAssets - Number(account.initial_cash));
  const profitPct =
    Number(account.initial_cash) > 0
      ? round2((profit / Number(account.initial_cash)) * 100)
      : 0;

  return Response.json({
    ok: true,
    account,
    holdings,
    summary: { cash, marketValue, totalAssets, profit, profitPct },
  });
}

// ---------- 查詢：交易紀錄（JOIN + 索引） ----------
async function getTrades(env, url) {
  const id = Number(url.searchParams.get("id") ?? 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20), 1), 100);

  const { results } = await env.DB
    .prepare(
      `SELECT t.id, t.symbol, s.name, t.side, t.shares, t.price, t.amount, t.created_at
         FROM trades t
         JOIN stocks s ON s.symbol = t.symbol
        WHERE t.account_id = ?
        ORDER BY t.id DESC
        LIMIT ?`
    )
    .bind(id, limit)
    .all();

  return Response.json({ ok: true, trades: results });
}

// ---------- 交易：買進 / 賣出 ----------
// ★ 交易一致性：扣款（或入帳）、更新持股、寫紀錄
//   三件事放進同一個 batch，要嘛全部成功，要嘛全部失敗。
async function trade(request, env) {
  const body = await request.json();

  const accountId = Number(body.account_id ?? 1);
  const symbol = String(body.symbol ?? "");
  const side = String(body.side ?? "BUY").toUpperCase();
  const shares = Number(body.shares);

  if (!symbol || !Number.isInteger(shares) || shares <= 0) {
    return Response.json({ ok: false, error: "參數錯誤" }, { status: 400 });
  }
  if (side !== "BUY" && side !== "SELL") {
    return Response.json({ ok: false, error: "side 只能是 BUY 或 SELL" }, { status: 400 });
  }

  const stock = await env.DB
    .prepare("SELECT symbol, name, price FROM stocks WHERE symbol = ?")
    .bind(symbol)
    .first();

  if (!stock) {
    return Response.json({ ok: false, error: "沒有這檔股票" }, { status: 404 });
  }

  const account = await env.DB
    .prepare("SELECT cash FROM accounts WHERE id = ?")
    .bind(accountId)
    .first();

  if (!account) {
    return Response.json({ ok: false, error: "找不到帳戶" }, { status: 404 });
  }

  const amount = round2(stock.price * shares);

  // ---- 交易前的檢查 ----
  if (side === "BUY" && Number(account.cash) < amount) {
    return Response.json(
      { ok: false, error: `現金不足（需要 ${amount}，現有 ${account.cash}）` },
      { status: 400 }
    );
  }

  if (side === "SELL") {
    const holding = await env.DB
      .prepare("SELECT shares FROM holdings WHERE account_id = ? AND symbol = ?")
      .bind(accountId, symbol)
      .first();

    const held = holding ? Number(holding.shares) : 0;
    if (held < shares) {
      return Response.json(
        { ok: false, error: `持股不足（持有 ${held} 股，想賣 ${shares} 股）` },
        { status: 400 }
      );
    }
  }

  // ---- 交易本體：三件事一個 batch ----
  const statements = [];

  if (side === "BUY") {
    statements.push(
      env.DB.prepare(
        "UPDATE accounts SET cash = ROUND(cash - ?, 2) WHERE id = ? AND cash >= ?"
      ).bind(amount, accountId, amount)
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO holdings (account_id, symbol, shares)
         VALUES (?, ?, ?)
         ON CONFLICT(account_id, symbol)
         DO UPDATE SET shares = shares + excluded.shares`
      ).bind(accountId, symbol, shares)
    );
  } else {
    statements.push(
      env.DB.prepare(
        "UPDATE accounts SET cash = ROUND(cash + ?, 2) WHERE id = ?"
      ).bind(amount, accountId)
    );
    statements.push(
      env.DB.prepare(
        `UPDATE holdings SET shares = shares - ?
          WHERE account_id = ? AND symbol = ? AND shares >= ?`
      ).bind(shares, accountId, symbol, shares)
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO trades (account_id, symbol, side, shares, price, amount)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(accountId, symbol, side, shares, stock.price, amount)
  );

  await env.DB.batch(statements);

  return Response.json({
    ok: true,
    side,
    symbol,
    name: stock.name,
    shares,
    price: stock.price,
    amount,
  });
}

// ---------- 前端頁面 ----------
const PAGE_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>股市模擬 — Worker + D1</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif;
         background:#0f1115; color:#e7e9ee; margin:0; padding:24px; }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size:21px; margin:0 0 4px; }
  h2 { font-size:14px; color:#8b93a7; font-weight:500; margin:28px 0 10px; }
  .sub { color:#8b93a7; font-size:13px; margin-bottom:22px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
           gap:12px; margin-bottom:8px; }
  .card { background:#171a21; border:1px solid #252a35; border-radius:10px; padding:14px 16px; }
  .card .label { font-size:12px; color:#8b93a7; }
  .card .value { font-size:20px; font-weight:600; margin-top:4px; font-variant-numeric:tabular-nums; }
  table { width:100%; border-collapse:collapse; background:#171a21;
          border:1px solid #252a35; border-radius:10px; overflow:hidden; }
  th, td { padding:10px 12px; text-align:left; font-size:13.5px;
           border-bottom:1px solid #252a35; }
  th { color:#8b93a7; font-weight:500; font-size:12px; }
  tr:last-child td { border-bottom:none; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  button { border:0; border-radius:6px; padding:5px 10px; cursor:pointer;
           font-size:12.5px; margin-right:6px; color:#fff; }
  .buy { background:#2563eb; } .buy:hover { background:#1d4ed8; }
  .sell { background:#dc2626; } .sell:hover { background:#b91c1c; }
  .tag { font-size:11px; padding:2px 7px; border-radius:999px; }
  .tag.BUY { background:#1e3a8a; color:#bfdbfe; }
  .tag.SELL { background:#7f1d1d; color:#fecaca; }
  .pos { color:#4ade80; } .neg { color:#f87171; }
  #msg { position:fixed; left:50%; bottom:24px; transform:translateX(-50%);
         padding:10px 18px; border-radius:8px; font-size:13.5px; opacity:0;
         transition:opacity .2s; pointer-events:none; }
  #msg.show { opacity:1; }
  #msg.ok { background:#14532d; color:#dcfce7; }
  #msg.err { background:#7f1d1d; color:#fee2e2; }
  .empty { color:#5b6478; font-size:13px; padding:14px 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>股市模擬</h1>
  <div class="sub">Cloudflare Worker + D1（SQLite）</div>

  <div class="cards">
    <div class="card"><div class="label">現金</div><div class="value" id="cash">—</div></div>
    <div class="card"><div class="label">持股市值</div><div class="value" id="mv">—</div></div>
    <div class="card"><div class="label">總資產</div><div class="value" id="total">—</div></div>
    <div class="card"><div class="label">報酬率</div><div class="value" id="pct">—</div></div>
  </div>

  <h2>行情</h2>
  <table>
    <thead><tr>
      <th>代號</th><th>名稱</th><th class="num">股價</th><th>操作</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>

  <h2>持股</h2>
  <table>
    <thead><tr>
      <th>代號</th><th>名稱</th><th class="num">股數</th>
      <th class="num">股價</th><th class="num">市值</th>
    </tr></thead>
    <tbody id="holdings"></tbody>
  </table>

  <h2>交易紀錄</h2>
  <table>
    <thead><tr>
      <th>時間</th><th>動作</th><th>代號</th><th>名稱</th>
      <th class="num">股數</th><th class="num">成交價</th><th class="num">金額</th>
    </tr></thead>
    <tbody id="trades"></tbody>
  </table>
</div>

<div id="msg"></div>

<script>
const fmt = n => Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const ACCOUNT = 1;

function toast(text, ok) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = 'show ' + (ok ? 'ok' : 'err');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = ''; }, 2200);
}

async function load() {
  const [stocks, acc, tr] = await Promise.all([
    fetch('/api/stocks').then(r => r.json()),
    fetch('/api/account?id=' + ACCOUNT).then(r => r.json()),
    fetch('/api/trades?id=' + ACCOUNT + '&limit=20').then(r => r.json())
  ]);

  document.getElementById('rows').innerHTML = stocks.map(s => \`
    <tr>
      <td>\${s.symbol}</td>
      <td>\${s.name}</td>
      <td class="num">\${fmt(s.price)}</td>
      <td>
        <button class="buy" onclick="act('\${s.symbol}','BUY')">買 10 股</button>
        <button class="sell" onclick="act('\${s.symbol}','SELL')">賣 10 股</button>
      </td>
    </tr>\`).join('');

  const s = acc.summary;
  document.getElementById('cash').textContent = fmt(s.cash);
  document.getElementById('mv').textContent = fmt(s.marketValue);
  document.getElementById('total').textContent = fmt(s.totalAssets);
  const pct = document.getElementById('pct');
  pct.textContent = (s.profit >= 0 ? '+' : '') + fmt(s.profit) +
                    '（' + (s.profitPct >= 0 ? '+' : '') + fmt(s.profitPct) + '%）';
  pct.className = 'value ' + (s.profit >= 0 ? 'pos' : 'neg');

  document.getElementById('holdings').innerHTML = acc.holdings.length
    ? acc.holdings.map(h => \`
        <tr>
          <td>\${h.symbol}</td><td>\${h.name}</td>
          <td class="num">\${fmt(h.shares)}</td>
          <td class="num">\${fmt(h.price)}</td>
          <td class="num">\${fmt(h.market_value)}</td>
        </tr>\`).join('')
    : '<tr><td colspan="5" class="empty">還沒有持股</td></tr>';

  document.getElementById('trades').innerHTML = tr.trades.length
    ? tr.trades.map(t => \`
        <tr>
          <td>\${new Date(t.created_at.replace(' ', 'T') + 'Z')
                .toLocaleString('zh-TW', { hour12: false })}</td>
          <td><span class="tag \${t.side}">\${t.side === 'BUY' ? '買進' : '賣出'}</span></td>
          <td>\${t.symbol}</td><td>\${t.name}</td>
          <td class="num">\${fmt(t.shares)}</td>
          <td class="num">\${fmt(t.price)}</td>
          <td class="num">\${fmt(t.amount)}</td>
        </tr>\`).join('')
    : '<tr><td colspan="7" class="empty">還沒有交易</td></tr>';
}

async function act(symbol, side) {
  const res = await fetch('/api/trade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account_id: ACCOUNT, symbol, side, shares: 10 })
  });
  const data = await res.json();
  if (data.ok) {
    toast((side === 'BUY' ? '買進 ' : '賣出 ') + data.name + ' ' +
          data.shares + ' 股，' + (side === 'BUY' ? '花費 ' : '入帳 ') + fmt(data.amount), true);
    load();
  } else {
    toast(data.error, false);
  }
}

load();
</script>
</body>
</html>`;
