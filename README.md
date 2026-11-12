# 삼역호전 스캐너

오늘 살 종목, 살 수량, 손절가·익절가를 정해진 규칙대로 계산하는 국장·미장 스캐너입니다.

- 사이트: https://kg4909-design.github.io/samyeok-scanner/
- 시세: GitHub Actions가 평일 15:50(국장)과 다음 날 06:40(미장, 한국시간)에 자동 수집
- 주문 기록: 비공개 저장소 `samyeok-records`에 저장 (사이트의 [내 주문 · 보유] → 여러 기기 기록 연동)

자세한 사용법은 사이트의 **[사용법 · 설치]** 탭이나 `GUIDE.html`을 보세요.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 스캐너 화면 |
| `GUIDE.html` | 사용설명서 |
| `scripts/fetch_data.py` | 시세 수집 (GitHub Actions가 실행) |
| `.github/workflows/update.yml` | 자동 실행 일정과 사이트 배포 |

받은 시세는 `data-store` 브랜치에 최신 1개만 보관하고, 사이트로 배포합니다.

> 이 도구는 입력된 일봉 데이터로 규칙을 기계적으로 계산할 뿐이며 투자 권유나 수익 보장이 아닙니다.
