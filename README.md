# 실시간 시세 대시보드

코스피·코스닥·나스닥·다우·엔비디아·비트코인·원/달러·국제 금·은 시세를 한 화면에서 보는 정적 웹페이지입니다.
서버 없이 브라우저에서 무료 공개 API를 직접 호출해 **30초마다 자동 갱신**합니다.

## 보는 법

- 배포 주소: https://dannyyoon7.github.io/market-live/
- 모바일 카카오톡 인앱 브라우저에서도 가로 스크롤 없이 보입니다.
- 상단 **📋 단톡방 공유 문구 복사** 버튼을 누르면 지금 시세가 브리핑 텍스트로 복사됩니다.

## 데이터 출처

| 항목 | 1순위 | 폴백 |
| --- | --- | --- |
| 코스피·코스닥·나스닥·다우·엔비디아·원/달러 | CNBC Quote API (CORS 허용) | Yahoo Finance (r.jina.ai 프록시), 환율은 open.er-api.com |
| 비트코인(원) | 업비트 Open API | – |
| 비트코인(달러) · 김치프리미엄 | Coinbase Spot → Binance | – |
| 국제 금·은(현물 $/oz) | gold-api.com | 등락은 COMEX 선물(CNBC) 기준 |

- 김치프리미엄 = (업비트 원화가 ÷ (달러가 × 원/달러 환율) − 1) × 100
- 1g 환산 = ($/oz × 원/달러) ÷ 31.1034768, 1돈 = 3.75g 기준

## 표기 규칙

- 상승 **빨강 ▲**, 하락 **파랑 ▼** (국내 증시 관례)
- 카드 하단에 출처와 시세 시각, 지연된 시세는 `n분 지연` 표시
- 국내 지수는 무료 공급원 특성상 15~20분 지연될 수 있습니다.

## 파일

- `index.html` — 화면 구조
- `styles.css` — 다크 금융 터미널 스타일, 반응형
- `app.js` — 시세 조회·렌더링·공유 문구 생성

## 배포

GitHub Pages (branch `main`, root). 별도 빌드 없음.

```bash
bash projects/market-live/deploy.sh
```

`deploy.sh` 는 저장소 push → GitHub Pages 활성화 → URL 출력까지 합니다. 전제 조건:

1. github.com 에 빈 **Public** 저장소 `market-live` 가 있어야 합니다.
2. Pickle의 GitHub 연결이 그 저장소에 쓰기 권한을 가져야 합니다.

> 2026-11-25 현재 이 계정의 GitHub 연결(@dannyyoon7)은 **저장소 생성 권한이 없습니다**
> (`GraphQL: Resource not accessible by integration (createRepository)`).
> 저장소를 만든 뒤 위 스크립트를 실행하면 `https://dannyyoon7.github.io/market-live/` 로 배포됩니다.

## 검증

```bash
LD_LIBRARY_PATH=/workspace/.chromeruntime/lib python3 tests/verify_local.py   # 3개 화면 크기·콘솔·자동갱신·공유문구
LD_LIBRARY_PATH=/workspace/.chromeruntime/lib python3 tests/verify_offline.py # API 전면 차단 시 실패 UI
LD_LIBRARY_PATH=/workspace/.chromeruntime/lib python3 tests/verify_widths.py  # 320/360/390px 레이아웃
```
