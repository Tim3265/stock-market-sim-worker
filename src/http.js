// HTTP 層的共用工具：統一 JSON 格式與錯誤碼 → 狀態碼。
// 這裡只做「回應長相」，不含任何商業規則。

export const ERROR_STATUS = {
  INVALID_INPUT: 400,
  INSUFFICIENT_CASH: 400,
  INSUFFICIENT_SHARES: 400,
  PRICE_LIMIT: 400,
  INVALID_SIDE: 400,
  NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  NOT_YOUR_ORDER: 403,
  UNAUTHENTICATED: 401,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  INTERNAL: 500,
};

export function json(data, status = 200) {
  return Response.json(data, { status });
}

export function ok(data = {}) {
  return json({ ok: true, ...data });
}

export function fail(code, message) {
  return json(
    { ok: false, code, message },
    ERROR_STATUS[code] ?? 400
  );
}

export function statusOf(code) {
  return ERROR_STATUS[code] ?? 400;
}
