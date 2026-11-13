# -*- coding: utf-8 -*-
"""
뉴스 감성 백테스트용 자료 수집 (연구용, 한 번만 실행)
GDELT DOC 2.0 API에서 종목별 하루 단위 기사 수(TimelineVolRaw)와 평균 논조(TimelineTone)를 받아 저장합니다.
  python research/news_gdelt.py --shard 0 --shards 8 --out research/out
"""
import argparse, json, os, re, time, urllib.parse
import requests

API = "https://api.gdeltproject.org/api/v2/doc/doc"
START, END = "20220901000000", "20261113000000"
SUFFIX = re.compile(r"\s*(\(Class [A-Z]\)|,? Inc\.?|,? Incorporated|,? Corporation|,? Corp\.?|,? Co\.,? Ltd\.?|,? Co\.?|,? Company|,? Ltd\.?|,? Limited|,? plc|,? PLC|,? N\.V\.|,? S\.A\.|,? Holdings?|,? Group|,? & Co\.?)\s*$")


def clean(name):
    n = name.replace("The ", "", 1) if name.startswith("The ") else name
    for _ in range(3):
        n = SUFFIX.sub("", n).strip()
    return n


def kr_english(code):
    import yfinance as yf
    for suf in (".KS", ".KQ"):
        try:
            info = yf.Ticker(code + suf).info
            nm = info.get("longName") or info.get("shortName")
            if nm and not nm.upper().startswith(code):
                return nm
        except Exception:
            pass
    return None


def gdelt(query, mode, tries=5):
    params = {"query": query, "mode": mode, "format": "json", "startdatetime": START, "enddatetime": END}
    for i in range(tries):
        try:
            r = requests.get(API, params=params, timeout=60, headers={"User-Agent": "samyeok-research/1.0"})
            if r.status_code == 200 and r.text.strip().startswith("{"):
                return r.json()
            if r.status_code == 200 and not r.text.strip():
                return {"timeline": []}
            print("  응답", r.status_code, r.text[:120].replace("\n", " "), flush=True)
        except Exception as e:
            print("  오류", e, flush=True)
        time.sleep(10 * (i + 1))
    return None


def series(js):
    out = {}
    for tl in (js or {}).get("timeline", []):
        for p in tl.get("data", []):
            d = p.get("date", "")[:8]
            out[d] = p.get("value")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--shards", type=int, default=1)
    ap.add_argument("--out", default="research/out")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    stocks = json.load(open(os.path.join(os.path.dirname(__file__), "news_stocks.json"), encoding="utf-8"))
    mine = [s for i, s in enumerate(stocks) if i % a.shards == a.shard]
    res = []
    for k, s in enumerate(mine, 1):
        eng = s["name"] if s["m"] == "US" else kr_english(s["sym"])
        if not eng:
            res.append({**s, "eng": None, "q": None}); continue
        nm = clean(eng)
        q = '"%s"' % nm
        if s["m"] == "US":
            q += " (stock OR shares OR earnings OR investors OR analyst)"
        vol = gdelt(q, "TimelineVolRaw"); time.sleep(6)
        tone = gdelt(q, "TimelineTone"); time.sleep(6)
        res.append({**s, "eng": eng, "q": q, "vol": series(vol), "tone": series(tone), "ok": vol is not None and tone is not None})
        print(f"[{a.shard}] {k}/{len(mine)} {s['m']} {s['sym']} {nm}: 날짜 {len(res[-1]['vol'])}개", flush=True)
    with open(os.path.join(a.out, f"news_{a.shard}.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
