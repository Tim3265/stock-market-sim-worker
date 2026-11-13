// 依最近 60 秒的請求數決定 tick 間隔與建議 poll 頻率。
// D1 免費額度（每日 10 萬 rows寫入）是整個帳號共享的硬上限，
// 人少時放慢市場節奏，避免一個人玩一整天就把額度燒光。
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

// 無請求資料時維持 15 秒預設；有資料時依人數分級（規格允許「至少 15 秒才動一次」）。
export function tickIntervalMs(now = Date.now()) {
  const rpm = requestsPerMin(now);
  if (rpm === 0) return 15000;
  if (rpm <= 20) return 60000;
  if (rpm <= 90) return 30000;
  return 15000;
}

export function pollMs(now = Date.now()) {
  const rpm = requestsPerMin(now);
  if (rpm === 0 || rpm <= 20) return 5000;
  return 10000;
}
