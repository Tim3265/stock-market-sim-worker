// Catalyst and Breaking Market News Engine
export const CATALYSTS = [
  { symbol: '2330', type: 'BULL', title: '🚨 晶圓暴單：2330 獲得中東超算中心百億急單，外資瘋狂大舉掃單！', impact: '+4.8%' },
  { symbol: '2330', type: 'BEAR', title: '⚡ 突發黑天鵝：南科廠區驚傳電網跳脫意外，部分產線啟動緊急檢修！', impact: '-3.6%' },
  { symbol: '2317', type: 'SQUEEZE', title: '🔥 空頭血洗：2317 傳代工機器人量產提前，融券遭連環斷頭軋空！', impact: '+6.2%' },
  { symbol: '2454', type: 'WHALE', title: '🐋 神秘巨鯨現身：北美主權基金秘密建倉 2454，買盤連續吃穿三檔深度！', impact: '+5.1%' },
  { symbol: 'YZU', type: 'BULL', title: '🚀 產學核彈：YZU 宣佈室溫常壓超導材料獲國際認證，全球資本狂暴湧入！', impact: '+9.5%' },
  { symbol: 'YZU', type: 'BEAR', title: '📉 恐慌獲利了結：YZU 短線暴漲後引發散戶踩踏式獲利了結！', impact: '-7.2%' },
  { symbol: 'YOUJIAN', type: 'MEME', title: '💎 鑽石手狂歡：YOUJIAN 社交網絡熱度登頂，散戶大軍誓死捍衛漲停板！', impact: '+8.8%' },
  { symbol: '3711', type: 'BULL', title: '💰 暴利分紅：3711 董事會通過超額配發現金股利，高殖利率吸金狂飆！', impact: '+4.2%' }
];

export function getActiveEvents(tickCount) {
  const tick = Number(tickCount || 0);
  const events = [];
  for (let i = 0; i < 4; i++) {
    const eventTick = Math.max(0, tick - i);
    const cat = CATALYSTS[(eventTick * 3 + i * 5) % CATALYSTS.length];
    events.push({
      id: 'evt-' + eventTick + '-' + cat.symbol + '-' + i,
      tick: eventTick,
      symbol: cat.symbol,
      type: cat.type,
      title: cat.title,
      impact: cat.impact,
      timestamp: Date.now() - i * 35000
    });
  }
  return events;
}
