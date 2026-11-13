# -*- coding: utf-8 -*-
"""
연구용: OpenDART 연간 재무제표·주식수·배당 수집 (기본적 지표 백테스트용)
결과: <out>/fs.json = {종목코드: {연도: {항목: 값}}}
"""
import io, json, os, sys, time, zipfile
import xml.etree.ElementTree as ET
import requests

KEY = os.environ.get("DART_API_KEY", "").strip()
BASE = "https://opendart.fss.or.kr/api"
YEARS = list(range(2019, 2026))
calls = 0

# IFRS 계정 ID 우선, 없으면 계정명으로
WANT = {
    "rev": (["ifrs-full_Revenue", "ifrs_Revenue"], ["매출액", "수익(매출액)", "영업수익", "매출", "순영업수익"]),
    "op": (["dart_OperatingIncomeLoss", "ifrs-full_ProfitLossFromOperatingActivities"], ["영업이익", "영업이익(손실)"]),
    "ni": (["ifrs-full_ProfitLossAttributableToOwnersOfParent"], ["지배기업의 소유주에게 귀속되는 당기순이익", "지배기업소유주지분"]),
    "ni_all": (["ifrs-full_ProfitLoss", "ifrs_ProfitLoss"], ["당기순이익", "당기순이익(손실)"]),
    "ocf": (["ifrs-full_CashFlowsFromUsedInOperatingActivities", "ifrs_CashFlowsFromUsedInOperatingActivities"], ["영업활동현금흐름", "영업활동으로 인한 현금흐름"]),
    "eq": (["ifrs-full_EquityAttributableToOwnersOfParent"], ["지배기업 소유주지분", "지배기업소유주지분"]),
    "eq_all": (["ifrs-full_Equity", "ifrs_Equity"], ["자본총계"]),
    "assets": (["ifrs-full_Assets", "ifrs_Assets"], ["자산총계"]),
    "liab": (["ifrs-full_Liabilities", "ifrs_Liabilities"], ["부채총계"]),
    "ca": (["ifrs-full_CurrentAssets", "ifrs_CurrentAssets"], ["유동자산"]),
    "cl": (["ifrs-full_CurrentLiabilities", "ifrs_CurrentLiabilities"], ["유동부채"]),
    "ltd": (["ifrs-full_NoncurrentLiabilities"], ["비유동부채"]),
    "gp": (["ifrs-full_GrossProfit"], ["매출총이익"]),
    "ppe": (["ifrs-full_PropertyPlantAndEquipment"], ["유형자산"]),
}
SJ = {"rev": ("IS", "CIS"), "op": ("IS", "CIS"), "ni": ("IS", "CIS"), "ni_all": ("IS", "CIS"), "gp": ("IS", "CIS"), "ocf": ("CF",),
      "eq": ("BS",), "eq_all": ("BS",), "assets": ("BS",), "liab": ("BS",), "ca": ("BS",), "cl": ("BS",), "ltd": ("BS",), "ppe": ("BS",)}


def get(path, **params):
    global calls
    params["crtfc_key"] = KEY
    for i in range(5):
        try:
            calls += 1
            r = requests.get(f"{BASE}/{path}", params=params, timeout=60)
            if path.endswith(".json"):
                j = r.json()
                if j.get("status") == "020":
                    print("  요청 제한, 60초 대기", flush=True); time.sleep(60); continue
                return j
            return r.content
        except Exception as e:
            print("  오류", e, flush=True); time.sleep(5 * (i + 1))
    return None


def num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return None


def pick(rows, key):
    ids, names = WANT[key]
    rs = [r for r in rows if r.get("sj_div") in SJ[key]]
    for i in ids:
        for r in rs:
            if r.get("account_id") == i and num(r.get("thstrm_amount")) is not None:
                return num(r["thstrm_amount"])
    for n in names:
        for r in rs:
            if r.get("account_nm", "").replace(" ", "") == n.replace(" ", "") and num(r.get("thstrm_amount")) is not None:
                return num(r["thstrm_amount"])
    return None


def fs_year(corp, y):
    for div in ("CFS", "OFS"):
        j = get("fnlttSinglAcntAll.json", corp_code=corp, bsns_year=str(y), reprt_code="11011", fs_div=div)
        if j and j.get("status") == "000":
            rows = j.get("list", [])
            out = {k: pick(rows, k) for k in WANT}
            out["fs"] = div
            return out
        time.sleep(0.1)
    return None


def shares_year(corp, y):
    j = get("stockTotqySttus.json", corp_code=corp, bsns_year=str(y), reprt_code="11011")
    if not j or j.get("status") != "000": return None
    for r in j.get("list", []):
        if r.get("se", "").strip() in ("보통주", "보통주식"):
            return {"shares": num(r.get("istc_totqy")), "treasury": num(r.get("tesstk_co")), "float": num(r.get("distb_stock_co"))}
    return None


def div_year(corp, y):
    j = get("alotMatter.json", corp_code=corp, bsns_year=str(y), reprt_code="11011")
    if not j or j.get("status") != "000": return None
    for r in j.get("list", []):
        if "주당 현금배당금" in r.get("se", "") and "보통" in (r.get("stock_knd") or "보통"):
            return num(r.get("thstrm"))
    return None


def main():
    if not KEY: sys.exit("DART_API_KEY 비밀값이 없습니다")
    out = sys.argv[1] if len(sys.argv) > 1 else "out"
    os.makedirs(out, exist_ok=True)
    z = zipfile.ZipFile(io.BytesIO(get("corpCode.xml")))
    root = ET.fromstring(z.read(z.namelist()[0]))
    codes = {el.findtext("stock_code").strip(): el.findtext("corp_code").strip() for el in root.iter("list") if (el.findtext("stock_code") or "").strip()}
    uni = json.load(open(os.path.join(os.path.dirname(__file__), "kr_universe.json"), encoding="utf-8"))
    res = {}
    for k, s in enumerate(uni, 1):
        corp = codes.get(s["sym"])
        if not corp: continue
        res[s["sym"]] = {}
        for y in YEARS:
            f = fs_year(corp, y) or {}
            sh = shares_year(corp, y) or {}
            dv = div_year(corp, y)
            if f or sh:
                res[s["sym"]][y] = {**f, **sh, "dps": dv}
            time.sleep(0.05)
        if k % 20 == 0 or k <= 2:
            print(f"{k}/{len(uni)} {s['name']} 연도 {len(res[s['sym']])} (호출 {calls})", flush=True)
    json.dump(res, open(os.path.join(out, "fs.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print("완료", len(res), "호출", calls)


if __name__ == "__main__":
    main()
