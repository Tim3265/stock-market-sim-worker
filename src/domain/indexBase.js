// 大盤指數的連續基準：每天開盤沿用前一天最後一筆指數，圖表才會接著昨天走，而不是每天回到 1000。
export const taipeiDate = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);

export async function latestIndexValue(db) {
  const row = await db.prepare('SELECT value FROM index_history ORDER BY id DESC LIMIT 1').first();
  return Number(row?.value) > 0 ? Number(row.value) : 1000;
}

// state: market_state 那一列（需含 index_base / index_base_date）
export async function indexBaseFor(db, state, date) {
  if (state?.index_base_date === date && Number(state.index_base) > 0) return { value: Number(state.index_base), isNewDay: false };
  return { value: await latestIndexValue(db), isNewDay: true };
}
