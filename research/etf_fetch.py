# -*- coding: utf-8 -*-
"""연구용: 적립식(TQQQ·TLT·SCHD) 검증과 SOXL 중계표 분석용 자료"""
import json, os, sys
import pandas as pd, yfinance as yf

out = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(out, exist_ok=True)
res = {}


def bars(df, adj=False):
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.dropna(subset=["Close"])
    rows = []
    for i, r in df.iterrows():
        rows.append([pd.Timestamp(i).strftime("%Y-%m-%d %H:%M" if adj == "intra" else "%Y-%m-%d"), float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"]),
                     float(r["Adj Close"]) if "Adj Close" in r and pd.notna(r["Adj Close"]) else float(r["Close"]), float(r["Volume"]) if pd.notna(r["Volume"]) else 0])
    return rows


for sym in ["SOXL", "TQQQ", "QQQ", "TLT", "SCHD", "SPY", "SOXX", "^NDX", "^SOX", "^IRX", "KRW=X", "SHY", "VOO"]:
    try:
        df = yf.download(sym, start="1985-01-01", interval="1d", auto_adjust=False, progress=False, threads=False)
        res[sym] = bars(df); print(sym, len(res[sym]), res[sym][0][0], res[sym][-1])
    except Exception as e:
        print(sym, "실패", e)
# SOXL 5분봉 (최근 60일) — 장 마감 30분 전 VWAP 계산용
for iv, per in [("5m", "60d"), ("30m", "60d")]:
    try:
        df = yf.download("SOXL", period=per, interval=iv, auto_adjust=False, progress=False, threads=False, prepost=False)
        df.index = df.index.tz_convert("America/New_York")
        res["SOXL_" + iv] = bars(df, "intra"); print("SOXL", iv, len(res["SOXL_" + iv]), res["SOXL_" + iv][-1])
    except Exception as e:
        print("SOXL", iv, "실패", e)
json.dump(res, open(os.path.join(out, "etf.json"), "w"), separators=(",", ":"))
