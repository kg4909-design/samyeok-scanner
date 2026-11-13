# -*- coding: utf-8 -*-
"""연구용: 코스톨라니 원칙 검증에 쓸 장기 지수·금리 자료"""
import io, json, os, sys
import pandas as pd, requests

out = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(out, exist_ok=True)
res = {}


def bars(df):
    df = df.dropna(subset=["Close"])
    return [[pd.Timestamp(i).strftime("%Y-%m-%d"), float(r["Open"]) if pd.notna(r.get("Open")) else None, float(r["High"]) if pd.notna(r.get("High")) else None,
             float(r["Low"]) if pd.notna(r.get("Low")) else None, float(r["Close"]), float(r["Volume"]) if pd.notna(r.get("Volume")) else 0] for i, r in df.iterrows()]


try:
    import FinanceDataReader as fdr
    res["KS11"] = bars(fdr.DataReader("KS11", "1985-01-01")); print("KS11", len(res["KS11"]), res["KS11"][0][0])
except Exception as e:
    print("KS11 fdr 실패", e)
import yfinance as yf
for sym, key in [("^GSPC", "SPX"), ("^KS11", "KS11_Y")]:
    try:
        df = yf.download(sym, start="1950-01-01", interval="1d", auto_adjust=False, progress=False, threads=False)
        if isinstance(df.columns, pd.MultiIndex): df.columns = df.columns.get_level_values(0)
        res[key] = bars(df); print(key, len(res[key]), res[key][0][0])
    except Exception as e:
        print(sym, "실패", e)
# FRED (키 없이 CSV): 미국 실효 연방기금금리(일별), 목표 상단, 한국 중앙은행 금리(월별), 한국 콜금리(월별)
for sid in ["DFF", "DFEDTARU", "IRSTCB01KRM156N", "IRSTCI01KRM156N", "INTDSRKRM193N"]:
    try:
        r = requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": sid}, timeout=60)
        df = pd.read_csv(io.StringIO(r.text))
        df.columns = ["date", "v"]
        df = df[pd.to_numeric(df["v"], errors="coerce").notna()]
        res[sid] = [[d, float(v)] for d, v in zip(df["date"], df["v"])]
        print(sid, len(res[sid]), res[sid][0], res[sid][-1])
    except Exception as e:
        print(sid, "실패", e)
json.dump(res, open(os.path.join(out, "macro.json"), "w"), separators=(",", ":"))
