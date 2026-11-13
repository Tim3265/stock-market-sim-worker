// 依最近 60 秒的請求數決定建議 poll 頻率（省讀取額度）。
// tick 固定 15 秒不變；D1 免費額度（每日 10 萬 rows寫入）是整個帳號共享的硬上限，
// 但市場是 lazy tick：沒人請求就完全不推進、不燒寫入額度。
const WINDOW_MS = 60000;
const stamps = [];

export function noteRequest(now = Date.now()) {
  stamps.push(now);
  const cutoff = now - WINDOW_MS;
  while (stamps.length && stamps[0] < cutoff) stamps.shift();
}

export function requestsPerMin(now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  let n = 0;
  for (let i = stamps.length - 1; i >= 0 && stamps[i] >= cutoff; i--) n++;
  return n;
}

// 效能不變：只要有玩家在看盤，tick 固定維持 15 秒。
// 市場本來就是 lazy tick —— 沒人發請求就完全不推進、不燒寫入額度。
export function tickIntervalMs() {
  return 15000;
}

export function pollMs(now = Date.now()) {
  const rpm = requestsPerMin(now);
  if (rpm === 0 || rpm <= 20) return 5000;
  return 10000;
}
