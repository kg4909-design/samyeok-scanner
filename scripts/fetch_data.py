# -*- coding: utf-8 -*-
"""
삼역호전 스캐너 - GitHub Actions 시세 수집
GitHub 서버가 매일 자동으로 실행합니다. 직접 실행할 필요는 없습니다.

  python scripts/fetch_data.py --market KR --out site/data
  python scripts/fetch_data.py --market US --out site/data
  python scripts/fetch_data.py --market ALL --out site/data

결과: <out>/KR.json, <out>/US.json, <out>/meta.json
"""
import argparse, json, os, sys, time, datetime as dt
from io import StringIO
from zoneinfo import ZoneInfo

import pandas as pd

KST = ZoneInfo("Asia/Seoul")
NY = ZoneInfo("America/New_York")
FALLBACK_US = ("AAPL MSFT NVDA AMZN GOOGL META AVGO TSLA BRK-B JPM LLY V UNH XOM MA COST HD PG JNJ WMT "
               "NFLX ABBV BAC CRM ORCL AMD KO PEP TMO MRK ADBE CSCO ACN LIN MCD WFC ABT DHR TXN QCOM "
               "INTU AMGN IBM GE CAT NOW ISRG PM UBER").split()


def log(msg):
    print(msg, flush=True)


def to_bars(df, kr):
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    out = []
    rnd = (lambda x: int(round(float(x)))) if kr else (lambda x: round(float(x), 2))   # 미장은 센트 단위(소수 둘째 자리)
    for idx, r in df.iterrows():
        v = r.get("Volume", 0)
        o, h, l, c = rnd(r["Open"]), rnd(r["High"]), rnd(r["Low"]), rnd(r["Close"])
        if min(o, h, l, c) <= 0:
            continue
        out.append([pd.Timestamp(idx).strftime("%Y-%m-%d"), o, h, l, c, 0 if pd.isna(v) else int(v)])
    return out


def drop_partial(bars, tz, hh, mm):
    """장이 아직 안 끝났으면 오늘 날짜의 미완성 봉을 뺀다"""
    if bars:
        now = dt.datetime.now(tz)
        if bars[-1][0] == now.strftime("%Y-%m-%d") and (now.hour, now.minute) < (hh, mm):
            return bars[:-1]
    return bars


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


# ---------------- 국장 ----------------
def kr_targets(n, out):
    """시가총액 상위 n개. 한국거래소 목록을 못 받으면 지난번 목록을 다시 씁니다."""
    try:
        import FinanceDataReader as fdr
        lst = fdr.StockListing("KRX")
        lst = lst[lst["Market"].isin(["KOSPI", "KOSDAQ", "KOSDAQ GLOBAL"])]
        if "Marcap" in lst.columns:
            lst = lst.sort_values("Marcap", ascending=False)
        lst = lst.head(n)
        mk = dict(zip(lst["Code"], lst["Market"]))
        log(f"[KR] 종목 목록: 한국거래소에서 {len(lst)}개")
        return list(lst["Code"]), dict(zip(lst["Code"], lst["Name"])), mk
    except Exception as e:
        log(f"[KR] 한국거래소 목록 실패: {e}")
    prev = read_json(os.path.join(out, "KR.json"), {}).get("stocks", [])
    if prev:
        log(f"[KR] 지난번 목록 {len(prev)}개를 다시 씁니다")
        return [s["symbol"] for s in prev], {s["symbol"]: s["name"] for s in prev}, {}
    raise RuntimeError("국장 종목 목록을 받지 못했습니다 (한국거래소 접속 실패, 지난 목록도 없음)")


def kr_bars_yahoo(code, start, market):
    import yfinance as yf
    suffixes = [".KQ", ".KS"] if str(market).startswith("KOSDAQ") else [".KS", ".KQ"]
    for suf in suffixes:
        df = yf.download(code + suf, start=start, interval="1d", auto_adjust=False, progress=False, threads=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        if len(df) > 0:
            return df
    return None


def fetch_kr(n, years, out):
    start = (dt.date.today() - dt.timedelta(days=int(365.25 * years))).isoformat()
    codes, names, mk = kr_targets(n, out)
    try:
        import FinanceDataReader as fdr
    except Exception:
        fdr = None
    stocks, fails, via_yahoo = [], 0, 0
    fdr_ok = fdr is not None
    for i, code in enumerate(codes, 1):
        bars = []
        if fdr_ok:
            try:
                bars = to_bars(fdr.DataReader(code, start), True)
            except Exception as e:
                if i <= 3:
                    log(f"[KR] FinanceDataReader 실패({code}): {e}")
                if i == 3 and not stocks:
                    fdr_ok = False   # 처음 3개가 모두 실패하면 야후로 전환
                    log("[KR] 야후 파이낸스로 전환합니다")
        if not bars:
            try:
                df = kr_bars_yahoo(code, start, mk.get(code, ""))
                if df is not None:
                    bars = to_bars(df, True)
                    via_yahoo += 1
            except Exception:
                pass
        bars = drop_partial(bars, KST, 15, 40)
        if len(bars) >= 60:
            stocks.append({"symbol": code, "name": names.get(code, code), "bars": bars})
        else:
            fails += 1
        if i % 50 == 0:
            log(f"[KR] {i}/{len(codes)}")
    if not stocks:
        raise RuntimeError("국장 시세를 한 종목도 받지 못했습니다")
    write_json(os.path.join(out, "KR.json"), {"generated": dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "market": "KR", "stocks": stocks})
    log(f"[KR] 완료: {len(stocks)}종목 (야후 대체 {via_yahoo}, 실패 {fails})")
    return len(stocks)


# ---------------- 미장 ----------------
def sp500():
    import requests
    try:
        html = requests.get("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
                            headers={"User-Agent": "Mozilla/5.0 (samyeok-scanner)"}, timeout=30).text
        t = pd.read_html(StringIO(html))[0]
        syms = [s.replace(".", "-") for s in t["Symbol"]]
        return syms, dict(zip(syms, t["Security"]))
    except Exception as e:
        log(f"[US] S&P 500 목록 실패, 대형주 50개로 대체: {e}")
        return FALLBACK_US, {}


def fetch_us(years, out):
    import yfinance as yf
    start = (dt.date.today() - dt.timedelta(days=int(365.25 * years))).isoformat()
    syms, names = sp500()
    stocks, fails = [], 0
    for k in range(0, len(syms), 50):
        chunk = syms[k:k + 50]
        data = yf.download(chunk, start=start, interval="1d", auto_adjust=True, group_by="ticker", threads=True, progress=False)
        for s in chunk:
            try:
                df = data[s] if isinstance(data.columns, pd.MultiIndex) else data
                bars = drop_partial(to_bars(df, False), NY, 16, 10)
                if len(bars) >= 60:
                    stocks.append({"symbol": s, "name": names.get(s, s), "bars": bars})
                else:
                    fails += 1
            except Exception:
                fails += 1
        log(f"[US] {min(k + 50, len(syms))}/{len(syms)}")
    if not stocks:
        raise RuntimeError("미장 시세를 한 종목도 받지 못했습니다")
    write_json(os.path.join(out, "US.json"), {"generated": dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "market": "US", "stocks": stocks})
    log(f"[US] 완료: {len(stocks)}종목 (실패 {fails})")
    return len(stocks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", default="ALL", choices=["KR", "US", "ALL"])
    ap.add_argument("--out", default="site/data")
    ap.add_argument("--kr-count", type=int, default=int(os.environ.get("KR_COUNT", 300)))
    ap.add_argument("--years", type=float, default=float(os.environ.get("YEARS", 5)))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    meta = read_json(os.path.join(a.out, "meta.json"), {})
    errors = []
    for m in (["KR", "US"] if a.market == "ALL" else [a.market]):
        try:
            cnt = fetch_kr(a.kr_count, a.years, a.out) if m == "KR" else fetch_us(a.years, a.out)
            meta[m] = {"generated": dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "count": cnt, "ok": True}
        except Exception as e:
            log(f"[{m}] 실패: {e}")
            errors.append(m)
            old = meta.get(m, {})
            meta[m] = dict(old, ok=False, error=str(e)[:300], tried=dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M"))
    write_json(os.path.join(a.out, "meta.json"), meta)
    if errors and len(errors) == (2 if a.market == "ALL" else 1):
        sys.exit(1)   # 전부 실패하면 GitHub에 실패로 표시 (메일 알림)


if __name__ == "__main__":
    main()
