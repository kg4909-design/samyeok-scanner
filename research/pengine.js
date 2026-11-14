// ===== P 사이클 (SOXL) 계산 엔진 =====
// 라오어 'Privacy' 중계표 30~33차를 실제 시세와 대조해 추정한 규칙. 사이클 시작 1줄·깊은 매수 줄·수량은 오차 0.1% 이내,
// 얕은 매수 줄·매도 줄은 근사. 체결은 장 마감 30분 Limit VWAP(그 30분 VWAP가 지정가보다 유리하면 체결)로 추정.
const PENGINE = (() => {
  const SPLIT = 13, K = 0.0395, START_UP = 1.06973, NEAR = 0.999, LOT_UP = 1.00155, LOT_DECAY = 0.001, ALL_UP = 1.004;
  const fl2 = x => Math.floor(x * 100 + 1e-7) / 100, ce2 = x => Math.ceil(x * 100 - 1e-7) / 100, rd2 = x => Math.round(x * 100) / 100;
  const HOLI = new Set(['2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24']);
  function nextTradingDay(d) {
    const t = new Date(d + 'T12:00:00Z');
    for (let i = 0; i < 10; i++) { t.setUTCDate(t.getUTCDate() + 1); const w = t.getUTCDay(), s = t.toISOString().slice(0, 10); if (w !== 0 && w !== 6 && !HOLI.has(s)) return s; }
    return null;
  }
  // 묶음 매도가가 내려가는 날 수: 한국 날짜(미국 날짜+1일) 기준 평일 수 (라오어 33차 112.56·107.40·77.36 묶음에서 10일 연속 일치)
  function kstWeekdays(d1, d2) { let n = 0; const t = new Date(d1 + 'T12:00:00Z'), e = new Date(d2 + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); e.setUTCDate(e.getUTCDate() + 1);
    while (t < e) { t.setUTCDate(t.getUTCDate() + 1); const w = t.getUTCDay(); if (w >= 1 && w <= 5) n++; } return n; }
  const holdOf = lots => lots.reduce((a, l) => a + l.q, 0);
  
  // 다음 거래일 주문 만들기
  // P 규칙판: 라오어 표 30~33차·28차·8차·1차와 대조해 확정·고정한 규칙 (중계표 없이 매일 같은 숫자가 나오도록)
  function makeOrders(st, C) {
    const U = st.E0 / SPLIT, H = holdOf(st.lots), buy = [], sell = [], lf = st.lastFill;
    const near = rd2(Math.min(C * NEAR, lf - 0.01));
    if (H === 0) {
      const p1 = rd2(C * (st.retry ? 1.05 : 1.07) - 0.04);
      for (const [p, tag] of [[p1, 'start'], [near, 'near']]) { const q = Math.min(Math.floor(U / p), Math.floor(st.cash / p)); if (q > 0) buy.push({ px: p, q, tag }); }
      return { buy, sell };
    }
    const T = Math.max(0, (st.E0 - st.cash) / U), B = fl2(lf * (1 - 0.003 * T)), q = Math.floor(U / B);
    if (q > 0 && st.cash >= q * (B + near)) { buy.push({ px: B, q, tag: 'deep' }); buy.push({ px: near, q, tag: 'near' }); }
    else { const qb = Math.min(q, Math.floor(st.cash / B)); if (qb > 0) buy.push({ px: B, q: qb, tag: 'deep', cashLimited: true }); }
    if (H * C <= U * 1.2) sell.push({ px: ce2(lf * 1.006), q: H, all: true });
    else st.lots.slice(-3).reverse().forEach((L, i) => { let px = ce2(L.px * (LOT_UP - LOT_DECAY * L.age)); if (i === 2) px = Math.min(px, ce2(lf * 1.007)); sell.push({ px, q: L.q, lot: L.id }); });
    return { buy, sell };
  }

  // 마감 30분 Limit VWAP 체결 추정. bars30: [[대표가, 거래량] ...] (없으면 종가로 근사)
  function estFill(o, side, bars30, C) {
    if (!bars30 || !bars30.length) { const ok = side === 'buy' ? C <= o.px : C >= o.px; return ok ? { q: o.q, px: C, rough: true } : null; }
    let pv = 0, v = 0; for (const [p, w] of bars30) { pv += p * w; v += w; }
    const vw = pv / v;
    if (side === 'buy' ? vw <= o.px : vw >= o.px) return { q: o.q, px: rd2(vw) };
    let qv = 0, qpv = 0; for (const [p, w] of bars30) if (side === 'buy' ? p <= o.px : p >= o.px) { qv += w; qpv += p * w; }
    const q = Math.round(o.q * qv / v);
    return q > 0 ? { q, px: rd2(qpv / qv), partial: true } : null;
  }

  // 매도 체결을 어느 묶음에서 뺄지: 그날 매도 주문 중 지정가 이하로 팔린 묶음부터, 나머지는 최근 묶음부터
  function removeLots(st, qty, px, sellOrders) {
    let r = qty;
    const cand = (sellOrders || []).filter(o => o.lot != null && o.px <= px + 1e-9).sort((a, b) => a.px - b.px);
    for (const o of cand) { if (r <= 0) break; const L = st.lots.find(x => x.id === o.lot); if (!L) continue; const t = Math.min(r, L.q); L.q -= t; r -= t; }
    for (let i = st.lots.length - 1; i >= 0 && r > 0; i--) { const L = st.lots[i]; const t = Math.min(r, L.q); L.q -= t; r -= t; }
    st.lots = st.lots.filter(L => L.q > 0);
  }

  // cfg: { startDate, capital, cycleNo, fills: [{date, side, qty, px} | {date, none:true}], auto }
  function replay(data, cfg) {
    const bars = data.bars.filter(b => b[0] >= cfg.startDate);
    if (!bars.length) return null;
    const rec = new Map(); for (const x of cfg.fills || []) { if (!rec.has(x.date)) rec.set(x.date, []); rec.get(x.date).push(x); }
    const st = { avg: 0, cash: cfg.capital, lots: [], E0: cfg.capital, cycleNo: cfg.cycleNo || 1, cycleStart: null, cycleReal: 0, cumReal: 0, lastFill: null, lossMode: false, seq: 0 };
    const rows = [], cycles = [];
    let orders = null, prevDate = null, wasStartG = false;
    for (const b of bars) {
      const [d, , , , C] = b;
      const day = { date: d, C, buys: [], sells: [], est: false, rough: false, recorded: rec.has(d), dayReal: 0 };
      for (const x of (cfg.deposits || []).filter(x => x.date === d)) { st.cash += x.amt; if (holdOf(st.lots) === 0) st.E0 = st.cash; day.deposit = (day.deposit || 0) + x.amt; }
      if (orders) {
        const step = kstWeekdays(prevDate, d); for (const L of st.lots) L.age += step;
        let fills;
        if (rec.has(d)) fills = rec.get(d).filter(x => !x.none);
        else if (cfg.auto !== false) {
          fills = []; day.est = true;
          const b30 = data.last30 && data.last30[d];
          for (const o of orders.sell) { const e = estFill(o, 'sell', b30, C); if (e) { fills.push({ side: 'sell', qty: o.all ? holdOf(st.lots) : e.q, px: e.px, partial: e.partial }); if (e.rough) day.rough = true; } }
          let cashLeft = st.cash + fills.reduce((a, x) => a + x.qty * x.px, 0);
          for (const o of orders.buy) { const e = estFill(o, 'buy', b30, C); if (e) { const q = Math.min(e.q, Math.floor(cashLeft / e.px)); if (q > 0) { fills.push({ side: 'buy', qty: q, px: e.px, partial: e.partial || q < o.q }); cashLeft -= q * e.px; } if (e.rough) day.rough = true; } }
        } else fills = [];
        const hadPos = holdOf(st.lots) > 0;
        wasStartG = !hadPos;
        const seq = rec.has(d) ? fills : fills.filter(x => x.side === 'sell').concat(fills.filter(x => x.side === 'buy'));   // 직접 기록한 날은 적은 순서대로
        for (const x of seq) {
          if (x.side === 'sell') {
          const H = holdOf(st.lots), q = Math.min(x.qty, H); if (q <= 0) continue;
          const r = q * (x.px - st.avg);   // 실현손익은 평단 기준 (매도해도 평단은 그대로)
          removeLots(st, q, x.px, orders.sell);
          st.cash += q * x.px; st.cycleReal += r; st.cumReal += r; day.dayReal += r; day.sells.push({ q, px: x.px, partial: x.partial });
          if (r < 0) st.lossMode = true;
        
            if (holdOf(st.lots) === 0) st.avg = 0;
          } else {
          const q = Math.min(x.qty, Math.floor(st.cash / x.px + 1e-9)); if (q <= 0) continue;
          if (holdOf(st.lots) === 0 && !st.cycleStart) st.cycleStart = d;
          const H0 = holdOf(st.lots); st.avg = (st.avg * H0 + q * x.px) / (H0 + q);
          // 묶음은 주문 줄별로 나눔 (같은 날 두 줄이 다 체결되면 묶음 2개)
          let r = q; for (const o of orders.buy.filter(o => o.px + 1e-9 >= x.px)) { if (r <= 0) break; const t = Math.min(r, o.q); st.lots.push({ id: ++st.seq, q: t, px: x.px, age: 0, date: d }); r -= t; }
          if (r > 0) st.lots.push({ id: ++st.seq, q: r, px: x.px, age: 0, date: d });
          st.cash -= q * x.px; day.buys.push({ q, px: x.px, partial: x.partial });
        
          }
        }
        if (day.sells.length) st.lastFill = day.sells.at(-1).px; else if (day.buys.length) st.lastFill = day.buys.at(-1).px;
        if (holdOf(st.lots) === 0) st.avg = 0;
        if (hadPos && holdOf(st.lots) === 0) {   // 사이클 종료 → 다음 거래일 새 사이클
          cycles.push({ no: st.cycleNo, start: st.cycleStart, end: d, E0: st.E0, real: st.cycleReal });
          st.cycleNo++; st.E0 = st.cash; st.cycleReal = 0; st.cycleStart = null; st.lossMode = false; day.cycleEnd = true;
        }
      }
      st.retry = !!(orders && typeof wasStartG !== 'undefined' && wasStartG && holdOf(st.lots) === 0 && !day.cycleEnd);
      if (!st.cycleStart && holdOf(st.lots) === 0) st.pendingStart = nextTradingDay(d);
      if (st.lastFill == null) st.lastFill = C;
      const pred = makeOrders(st, C), rl = cfg.relay && cfg.relay[d];
      if (rl) { const m = cfg.mult || 1; orders = { relay: true, buy: (rl.buy || []).map(([px, q]) => ({ px, q: q * m })), sell: (rl.sell || []).map(([px, q]) => q === 'all' ? { px, q: holdOf(st.lots), all: true } : { px, q: q * m }) }; }
      else orders = pred;
      const H = holdOf(st.lots);
      rows.push(Object.assign(day, { cycleNo: st.cycleNo, cycleStart: st.cycleStart || st.pendingStart, hold: H, avg: st.avg, cash: st.cash, E0: st.E0, cycleReal: st.cycleReal, cumReal: st.cumReal,
        net: day.buys.reduce((a, x) => a + x.q, 0) - day.sells.reduce((a, x) => a + x.q, 0), equity: st.cash + H * C, orders, pred, lots: st.lots.map(L => Object.assign({}, L)), lossMode: st.lossMode }));
      prevDate = d;
    }
    const last = rows.at(-1);
    return { rows, cycles, last, nextDate: nextTradingDay(last.date), capital: cfg.capital };
  }

  // 라오어 33차(2026-10-02 시작) 체결 기록 — 블로그 메모의 VWAP 체결가. N배로 곱해 이어받기용
  const LAOER33 = { startDate: '2026-10-01', capital: 14434.58, cycleNo: 33, fills: [
    ['2026-10-02', 'buy', 6, 164.22], ['2026-10-05', 'buy', 6, 163.77], ['2026-10-06', 'sell', 6, 164.67], ['2026-10-06', 'buy', 6, 163.75], ['2026-10-07', 'buy', 12, 158.78],
    ['2026-10-08', 'buy', 14, 140.82], ['2026-10-09', 'buy', 7, 140.01], ['2026-10-12', 'buy', 16, 128.7], ['2026-10-13', 'buy', 8, 126.3], ['2026-10-14', 'buy', 18, 112.56],
    ['2026-10-15', 'buy', 20, 107.40], ['2026-10-16', 'buy', 3, 95.20], ['2026-10-19', 'sell', 8, 100.28], ['2026-10-20', 'none'], ['2026-10-21', 'sell', 8, 103.41], ['2026-10-22', 'buy', 10, 83.41],
    ['2026-10-23', 'none'], ['2026-10-26', 'sell', 9, 91.99], ['2026-10-27', 'sell', 9, 100.64], ['2026-10-28', 'sell', 19, 105.98], ['2026-10-29', 'buy', 20, 101.49], ['2026-10-30', 'buy', 22, 74.29],
    ['2026-11-02', 'buy', 13, 69.11], ['2026-11-03', 'sell', 11, 73.21], ['2026-11-04', 'buy', 12, 65.43], ['2026-11-05', 'buy', 1, 44.5], ['2026-11-06', 'sell', 6, 46.16], ['2026-11-09', 'sell', 6, 57.11],
    ['2026-11-10', 'buy', 3, 55.14], ['2026-11-11', 'sell', 12, 66.39], ['2026-11-12', 'buy', 4, 64.33]] };
  const LAOER33_RELAY = {"2026-10-01":{"buy":[[164.41,6],[154.52,7]],"sell":[]},"2026-10-02":{"buy":[[163.78,6],[163.54,6]],"sell":[[164.83,"all"]]},"2026-10-05":{"buy":[[162.89,6],[163.75,6]],"sell":[[164.67,"all"]]},"2026-10-07":{"buy":[[157.11,7],[158.75,7]],"sell":[[159.02,6],[160.44,6]]},"2026-10-08":{"buy":[[138.58,8],[141.8,7]],"sell":[[158.86,6],[142.04,7],[143.54,7]]},"2026-10-09":{"buy":[[137.45,8],[139.62,8]],"sell":[[158.86,6],[141.04,7],[141.34,7]]},"2026-10-12":{"buy":[[125.61,8],[128.27,8]],"sell":[[140.75,7],[128.9,8],[129.9,8]]},"2026-10-13":{"buy":[[122.93,9],[126.28,9]],"sell":[[140.61,7],[128.77,8],[128.59,9]]},"2026-10-14":{"buy":[[108.95,10],[110.42,10]],"sell":[[128.64,8],[112.73,9],[113.04,10]]},"2026-10-15":{"buy":[[103.31,3]],"sell":[[112.62,9],[107.57,10],[108.46,10]]},"2026-10-16":{"buy":[],"sell":[[112.62,9],[107.57,10],[95.75,8]]},"2026-10-19":{"buy":[[96.67,9]],"sell":[[112.4,9],[107.35,10],[100.83,8]]},"2026-10-20":{"buy":[[96.67,9]],"sell":[[112.28,9],[107.24,10],[100.46,8]]},"2026-10-21":{"buy":[[101.1,10]],"sell":[[112.17,9],[107.14,10],[104.49,9]]},"2026-10-22":{"buy":[[80.46,10]],"sell":[[112.06,9],[107.03,10],[84.06,9]]},"2026-10-23":{"buy":[[80.46,10]],"sell":[[112.06,9],[107.03,10],[84.58,9]]},"2026-10-26":{"buy":[[88.01,12]],"sell":[[111.83,9],[106.81,10],[92.62,9]]},"2026-10-27":{"buy":[[98.17,11],[100.62,11]],"sell":[[111.72,9],[106.71,10],[102.1,9]]},"2026-10-28":{"buy":[[103.97,10],[105.46,10]],"sell":[[127.35,8],[111.61,9],[108.37,9]]},"2026-10-29":{"buy":[[99.1,11],[100.97,11]],"sell":[[111.5,9],[102.65,10],[103.41,9]]},"2026-10-30":{"buy":[[74.17,13]],"sell":[[101.65,10],[77.48,11],[78.07,10]]},"2026-11-02":{"buy":[[66.02,1]],"sell":[[101.44,10],[77.33,11],[69.87,11]]},"2026-11-03":{"buy":[[71.25,12]],"sell":[[101.34,10],[77.26,11],[74.29,11]]},"2026-11-04":{"buy":[[63.57,1]],"sell":[[101.24,10],[77.18,11],[68.2,11]]},"2026-11-05":{"buy":[[41.5,1]],"sell":[[101.14,10],[77.11,11],[44.35,6]]},"2026-11-06":{"buy":[[44.41,7]],"sell":[[101.14,10],[77.11,11],[47.17,6]]},"2026-11-09":{"buy":[[55.14,11]],"sell":[[65.43,6],[76.96,11],[57.9,6]]},"2026-11-10":{"buy":[[54.21,9]],"sell":[[65.42,6],[76.89,11],[57.28,6]]},"2026-11-11":{"buy":[[64.33,14]],"sell":[[76.81,11],[67.4,11]]},"2026-11-12":{"buy":[[63.29,16]],"sell":[[73.74,11],[67.05,11]]},"2026-11-13":{"buy":[[56.6,1]],"sell":[[73.74,11],[60.04,13]]}};
  function laoerPreset(n) {
    return { startDate: LAOER33.startDate, capital: rd2(LAOER33.capital * n), cycleNo: LAOER33.cycleNo, mult: n, relay: JSON.parse(JSON.stringify(LAOER33_RELAY)),
      fills: LAOER33.fills.map(([date, side, q, px]) => side === 'none' ? { date, none: true } : { date, side, qty: q * n, px }) };
  }
  return { replay, kstWeekdays, makeOrders, estFill, nextTradingDay, laoerPreset, LAOER33, SPLIT };
})();
if (typeof module !== 'undefined') module.exports = PENGINE;
