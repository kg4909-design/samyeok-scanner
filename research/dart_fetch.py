# -*- coding: utf-8 -*-
"""
연구용: OpenDART 공시 목록 수집 (뉴스 대신 공시로 긍정/부정 판단 백테스트)
환경변수 DART_API_KEY 필요 (GitHub 저장소 Secrets).  결과: <out>/dart.json = {종목코드: [[접수일, 공시명], ...]}
"""
import io, json, os, sys, time, zipfile, datetime as dt
import xml.etree.ElementTree as ET
import requests

KEY = os.environ.get("DART_API_KEY", "").strip()
BASE = "https://opendart.fss.or.kr/api"
calls = 0


def get(path, **params):
    global calls
    params["crtfc_key"] = KEY
    for i in range(5):
        try:
            calls += 1
            r = requests.get(f"{BASE}/{path}", params=params, timeout=60)
            if path.endswith(".json"):
                j = r.json()
                if j.get("status") == "020":   # 요청 제한 초과
                    print("  요청 제한, 60초 대기", flush=True); time.sleep(60); continue
                return j
            return r.content
        except Exception as e:
            print("  오류", e, flush=True); time.sleep(5 * (i + 1))
    return None


def corp_codes():
    z = zipfile.ZipFile(io.BytesIO(get("corpCode.xml")))
    root = ET.fromstring(z.read(z.namelist()[0]))
    m = {}
    for el in root.iter("list"):
        sc = (el.findtext("stock_code") or "").strip()
        if sc:
            m[sc] = el.findtext("corp_code").strip()
    return m


def ranges(a, b, months):
    cur = a
    while cur <= b:
        y, mo = cur.year + (cur.month - 1 + months) // 12, (cur.month - 1 + months) % 12 + 1
        nxt = dt.date(y, mo, 1) - dt.timedelta(days=1)
        yield cur, min(nxt, b)
        cur = nxt + dt.timedelta(days=1)


def fetch(corp, a, b):
    rows, page = [], 1
    while True:
        j = get("list.json", corp_code=corp, bgn_de=a.strftime("%Y%m%d"), end_de=b.strftime("%Y%m%d"), page_no=page, page_count=100)
        if not j: return None
        st = j.get("status")
        if st == "013": return rows
        if st != "000": return ("ERR", st, j.get("message"))
        rows += [[x["rcept_dt"], x["report_nm"].strip(), x.get("rcept_no", "")] for x in j.get("list", [])]
        if page >= int(j.get("total_page", 1)): return rows
        page += 1; time.sleep(0.15)


def main():
    if not KEY:
        sys.exit("DART_API_KEY 비밀값이 없습니다")
    out = sys.argv[1] if len(sys.argv) > 1 else "out"
    os.makedirs(out, exist_ok=True)
    codes = corp_codes()
    print("DART 회사 코드", len(codes), flush=True)
    stocks = [s for s in json.load(open(os.path.join(os.path.dirname(__file__), "news_stocks.json"), encoding="utf-8")) if s["m"] == "KR"]
    a, b = dt.date(2022, 8, 1), dt.date.today()
    res, miss = {}, []
    for k, s in enumerate(stocks, 1):
        corp = codes.get(s["sym"])
        if not corp:
            miss.append(s["sym"]); continue
        rows = []
        for x, y in ranges(a, b, 12):
            r = fetch(corp, x, y)
            if isinstance(r, tuple):   # 기간이 길어 거절되면 3개월씩
                print("  ", s["sym"], r, "→ 3개월 단위로", flush=True)
                for x2, y2 in ranges(x, y, 3):
                    r2 = fetch(corp, x2, y2)
                    if isinstance(r2, list): rows += r2
                    time.sleep(0.15)
            elif r: rows += r
            time.sleep(0.15)
        res[s["sym"]] = rows
        if k % 20 == 0 or k <= 3:
            print(f"{k}/{len(stocks)} {s['name']}: 공시 {len(rows)}건 (호출 {calls})", flush=True)
    json.dump({"generated": dt.datetime.utcnow().isoformat(), "missing": miss, "data": res}, open(os.path.join(out, "dart.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print("완료", len(res), "종목, 코드 없음", miss, "호출", calls)


if __name__ == "__main__":
    main()
