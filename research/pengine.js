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
  const holdOf = lots => lots.reduce((a, l) => a + l.q, 0);
  
  // 다음 거래일 주문 만들기
  function makeOrders(st, C) {
    const U = st.E0 / SPLIT, H = holdOf(st.lots), buy = [], sell = [];
    if (H === 0) {
      for (const [p, tag] of [[rd2(C * START_UP), 'start'], [fl2(C * NEAR), 'near']]) { const q = Math.min(Math.floor(U / p), Math.floor(st.cash / p)); if (q > 0) buy.push({ px: p, q, tag, approx: tag === 'near' }); }
      return { buy, sell };
    }
    const f = Math.max(0, 1 - st.cash / st.E0), B = fl2(st.lastFill * (1 - K * f)), A = fl2(C * NEAR), q = Math.floor(U / B);
    if (q > 0 && st.cash >= q * (A + B)) { buy.push({ px: B, q, tag: 'deep', approx: st.lossMode }); buy.push({ px: A, q, tag: 'near', approx: true }); }
    else { const qb = Math.min(q, Math.floor(st.cash / B)); if (qb > 0) buy.push({ px: B, q: qb, tag: 'deep', approx: st.lossMode, cashLimited: true }); }
    if (st.lots.length <= 2) sell.push({ px: ce2(st.avg * ALL_UP), q: H, all: true, approx: true });
    else for (const L of st.lots.slice(-3).reverse()) sell.push({ px: ce2(L.px * (LOT_UP - LOT_DECAY * L.age)), q: L.q, lot: L.id, approx: true });
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
    let orders = null, prevDate = null;
    for (const b of bars) {
      const [d, , , , C] = b;
      const day = { date: d, C, buys: [], sells: [], est: false, rough: false, recorded: rec.has(d), dayReal: 0 };
      if (orders) {
        for (const L of st.lots) L.age++;
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
        for (const x of fills.filter(x => x.side === 'sell')) {
          const H = holdOf(st.lots), q = Math.min(x.qty, H); if (q <= 0) continue;
          const r = q * (x.px - st.avg);   // 실현손익은 평단 기준 (매도해도 평단은 그대로)
          removeLots(st, q, x.px, orders.sell);
          st.cash += q * x.px; st.cycleReal += r; st.cumReal += r; day.dayReal += r; day.sells.push({ q, px: x.px, partial: x.partial });
          if (r < 0) st.lossMode = true;
        }
        for (const x of fills.filter(x => x.side === 'buy')) {
          const q = Math.min(x.qty, Math.floor(st.cash / x.px + 1e-9)); if (q <= 0) continue;
          if (holdOf(st.lots) === 0 && !st.cycleStart) st.cycleStart = d;
          const H0 = holdOf(st.lots); st.avg = (st.avg * H0 + q * x.px) / (H0 + q);
          // 묶음은 주문 줄별로 나눔 (같은 날 두 줄이 다 체결되면 묶음 2개)
          let r = q; for (const o of orders.buy.filter(o => o.px + 1e-9 >= x.px)) { if (r <= 0) break; const t = Math.min(r, o.q); st.lots.push({ id: ++st.seq, q: t, px: x.px, age: 0, date: d }); r -= t; }
          if (r > 0) st.lots.push({ id: ++st.seq, q: r, px: x.px, age: 0, date: d });
          st.cash -= q * x.px; day.buys.push({ q, px: x.px, partial: x.partial });
        }
        if (day.sells.length) st.lastFill = day.sells.at(-1).px; else if (day.buys.length) st.lastFill = day.buys.at(-1).px;
        if (holdOf(st.lots) === 0) st.avg = 0;
        if (hadPos && holdOf(st.lots) === 0) {   // 사이클 종료 → 다음 거래일 새 사이클
          cycles.push({ no: st.cycleNo, start: st.cycleStart, end: d, E0: st.E0, real: st.cycleReal });
          st.cycleNo++; st.E0 = st.cash; st.cycleReal = 0; st.cycleStart = null; st.lossMode = false; day.cycleEnd = true;
        }
      }
      if (!st.cycleStart && holdOf(st.lots) === 0) st.pendingStart = nextTradingDay(d);
      if (st.lastFill == null) st.lastFill = C;
      orders = makeOrders(st, C);
      const H = holdOf(st.lots);
      rows.push(Object.assign(day, { cycleNo: st.cycleNo, cycleStart: st.cycleStart || st.pendingStart, hold: H, avg: st.avg, cash: st.cash, E0: st.E0, cycleReal: st.cycleReal, cumReal: st.cumReal,
        net: day.buys.reduce((a, x) => a + x.q, 0) - day.sells.reduce((a, x) => a + x.q, 0), equity: st.cash + H * C, orders, lots: st.lots.map(L => Object.assign({}, L)), lossMode: st.lossMode }));
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
  function laoerPreset(n) {
    return { startDate: LAOER33.startDate, capital: rd2(LAOER33.capital * n), cycleNo: LAOER33.cycleNo, mult: n,
      fills: LAOER33.fills.map(([date, side, q, px]) => side === 'none' ? { date, none: true } : { date, side, qty: q * n, px }) };
  }
  return { replay, makeOrders, estFill, nextTradingDay, laoerPreset, LAOER33, SPLIT };
})();
if (typeof module !== 'undefined') module.exports = PENGINE;
