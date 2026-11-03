# 프론트엔드 · 관리자 콘솔 + 사용자 포털

디자인 캔버스 "Gateway 콘솔 v2"의 ④ 관리자 콘솔(01~08, 05-2), ② P2 콘솔 로그인, ③ U7·U8·U9 포털을 옮긴 웹 화면입니다.
Vite + React 18 + TypeScript(strict) · react-router · TanStack Query · ESLint · Vitest. 그래프는 라이브러리 없이 SVG/HTML로 직접 그렸습니다.

확장 안에 뜨는 화면(U1~U6, 팝업, P1)과 설명용 보드(흐름 이해하기, P0, J1·J2·L1·L2, AuthScreen·StoryFrame)는 옮기지 않았습니다. 확장 화면은 다음 단계에서 `extension/` 작업으로 합니다.

## 실행

Node 20 이상이 필요합니다 (22에서 확인).

```bash
# 1) 게이트웨이 (저장소 루트, 루트 README "실행" 참고)
cp .env.example .env               # UPSTREAM_MODE=mock 이 기본값이라 키 없이 돌아갑니다
uvicorn app.main:app --reload --env-file .env      # http://localhost:8000

# 2) 프론트엔드
cd frontend
npm install
npm run dev                        # http://localhost:3000  (포트 고정, 5173은 extension/dev가 씀)
```

로그인: **admin@example.com / test1234** (콘솔 로그인은 서버에 관리자 계정이 없어 이 고정 계정으로 확인하는 시연용 관문입니다). 다른 `@example.com` 주소 + test1234 → "관리자 아님", 그 밖의 값 → 실패, 5번 틀리면 잠김.

화면에 숫자가 보이려면 게이트웨이로 요청을 몇 번 보내 두세요 (루트 README의 `curl` 예시). 감사 로그가 비어 있으면 그래프는 "이 기간에 기록이 없어요"로 나옵니다.

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 (3000) |
| `npm run build` | `tsc -b` + 프로덕션 빌드 (`dist/`, 커밋 안 함) |
| `npm run lint` | ESLint |
| `npm test` | Vitest (jsdom) |

| 경로 | 화면 |
|---|---|
| `/login` | P2 관리자 콘솔 로그인 |
| `/console` · `/live` · `/logs` · `/reports` | 01 개요 · 02 실시간 · 03 기록 · 04 분석 리포트 |
| `/console/policy` · `/policy/basic` · `/exceptions` | 05 정책 엔진 · 05-2 기본 규칙 · 06 예외 요청 |
| `/console/token` | 관리자 토큰 입력 (401일 때 자동 이동) |
| `/me` · `/me/request` | 내 예외 요청(+도움말) · 예외 요청하기 (확장의 "자세히 보기"와 막힘 안내에서 엽니다) |

`/console/*`에는 로그인 가드가 있습니다. 포털(`/me/*`)은 확장에서 여는 화면이라 콘솔 로그인과 따로 두었습니다. 이 브라우저가 보낸 요청만 보이고(확장과 같은 `?cid=`), 가짜 사용자나 가짜 기록은 없습니다.

### 서버 주소와 관리자 토큰

- 서버 주소: `VITE_GATEWAY_URL` (기본 `http://localhost:8000`). `.env.example` → `.env.local`.
- 개발 중에는 브라우저가 `/gw/*`로 부르고 Vite proxy가 게이트웨이로 넘깁니다. **`GATEWAY_ADMIN_TOKEN`을 설정한 셸에서 `npm run dev`를 실행하면 proxy가 서버 쪽에서 `X-Admin-Token`을 붙입니다.** 토큰은 번들에 들어가지 않습니다.
- 그렇지 않은데 서버가 401을 주면 `/console/token`으로 이동해 토큰을 입력받고 **sessionStorage에만** 둡니다 (탭을 닫으면 지워짐). 프로덕션 빌드는 이 방식만 씁니다.
- 서버에서 토큰을 비워 두면 열려 있어 둘 다 필요 없습니다. 세 경우 모두 확인했습니다 (아래 "확인한 것").

## 구조

```
src/
  app/          라우터, 콘솔 레이아웃(사이드바 + 본문), Provider
  pages/        console/*, portal/*  — 화면 하나에 파일 하나
  components/   Sidebar, 차트(StackedBars·LineChart·Sparkline·RankBars), Seg·Toggle·Help, QueryState, Icon
  features/     auth(세션·가드·자동 로그아웃), feedback(토스트·확인 모달), queries(쿼리 키), format, chart, slots, catalog
  api/          client(공통 fetch·오류), gateway(실제 API), console(콘솔 로그인만 mocks), 타입
  mocks/        콘솔 로그인 시연용 관문(db.ts) 하나뿐. 다른 가짜 데이터는 없습니다
  styles/       tokens.css(디자인 토큰), global/layout/viz.css
```

화면은 `api/`만 부릅니다.
디자인 토큰(유리 카드, 배경 그라데이션, IBM Plex Sans KR / Mono, 처리 색 통과 `#A9B6C8` · 가림 `#2a78d6` · 차단 `#e34948`)은 `styles/tokens.css`에 CSS 변수로 있습니다. Tailwind는 쓰지 않았습니다.

## 어디서 오는 데이터인가

화면의 숫자·목록은 모두 게이트웨이가 실제로 저장한 것입니다. 가짜 데이터(예시 값, 가짜 구성원·부서·Slack 등)는 지웠습니다. 남은 시뮬레이션은 **콘솔 로그인 한 곳**(`mocks/db.ts`)뿐입니다.

| 화면 | 데이터 |
|---|---|
| 사이드바 | `GET /health`, 예외 요청·이상 징후 대기 건수 |
| 01 개요 | `/v1/stats/summary`, `/v1/stats/timeseries`, `/v1/audit/events`, 예외 요청·이상 징후 |
| 02 실시간 | `/v1/audit/events`, 분당 그래프, 이상 징후 `/v1/anomalies` (기록에서 계산) |
| 03 기록 | `/v1/audit/events`, 기록 비우기 `DELETE /v1/audit/events` |
| 04 리포트 | `summary`, `timeseries`, `summary.findings`, `/v1/eval` |
| 05 정책 엔진 · 05-2 기본 규칙 | `/v1/policy/*`, `/v1/rules/builtin`, `/v1/industries`, `/v1/analyze` |
| 06 예외 요청 | `/v1/exceptions` (승인·반려·회수·비우기) |
| 포털 `/me` | `/v1/exceptions/mine?client_id=` (이 브라우저가 보낸 요청과 남은 시간) |

발표용 데이터는 `scripts/seed_presentation.py`로 넣습니다 (`docs/PRESENTATION.md`).

오류는 `api/client.ts`에서 한 번에 처리합니다. 게이트웨이의 `{"error":{"type":...}}`와, 토큰 검사가 돌려주는 FastAPI 기본 형식 `{"detail":...}`을 둘 다 같은 `ApiError`로 바꾸고, 401이면 토큰 화면으로 보냅니다.

## 서버에 아직 없는 것 (그래서 화면도 없는 것)

구성원·가입 승인, 설정(2단계 인증·보관 기간·Slack), 관리자 작업 기록, 부서별 집계, 교육 대상 후보, 정기 리포트, 사용자별 보호 현황. 모두 서버에 사용자 식별과 해당 API가 생기면 다시 만듭니다. 가짜 화면으로 두지 않기로 했습니다.

## 개인정보 원칙

- 프롬프트 원문과 원래 값은 어떤 화면에도 표시·저장하지 않습니다. 감사 로그에 없는 값이라 표시할 수도 없습니다.
- 예외: 05 "미리 시험하기"는 관리자가 직접 입력한 시험 문장에서 찾은 부분을 보여 줍니다 (`/v1/analyze`는 아무것도 저장하지 않음). 실제 직원 프롬프트가 아닙니다.
- 포털의 치환 기록은 디자인대로 "홍*동"처럼 일부만 보이는 값입니다. 화면·테스트의 이름·메일·코드는 모두 가짜(example.com, HANBIT-7Q2K)입니다.

## 확인한 것

- `npm run build` / `npm run lint` / `npm test`(18개) 통과. 루트 `python -m pytest`(116개)와 `python -m app.check_templates` 통과 (서버 코드는 바꾸지 않음).
- 게이트웨이를 `UPSTREAM_MODE=mock`으로 띄우고 요청 10건을 보낸 뒤 Playwright(Chromium)로 모든 화면을 1280px·1440px에서 열어 확인: 가로 스크롤 없음, 사이드바가 페이지 끝까지 이어짐, 콘솔 오류 없음. 1440px 스크린샷을 디자인과 나란히 비교했습니다.
- 동작 확인: 로그인 가드 → 로그인 후 원래 페이지로 복귀, 비밀번호 틀림·관리자 아님, 2단계 인증(켰을 때만, 000000 실패), `/v1/analyze` 미리 시험하기, 규칙 켜고 끄기 → "변경 n건 승인하고 적용" → 확인 모달 → 버전 15, 새 규칙 추가, 기본 규칙 체크 → "변경 n건 적용", 가입 승인(사이드바 배지 감소), 포털 예외 요청 → 06에 나타남 → 24시간 승인 → 관리자 작업 기록, 기록 화면 status 필터, Slack 보내기, 차트 키보드 툴팁(←/→/Home/End).
- 토큰: 서버에 `GATEWAY_ADMIN_TOKEN`을 설정했을 때 ① dev proxy가 붙이는 경우 200, ② 붙이지 않으면 401 → `/console/token` → 입력 후 데이터 표시, 토큰은 sessionStorage에만 있고 `dist/`·소스에 없음.

## 확인하지 못한 것 · 한계

- Safari·Firefox, 실제 화면 낭독기(VoiceOver·NVDA)는 확인하지 못했습니다. 키보드 조작은 Tab/Enter/Space/화살표로 확인했습니다.
- 실제 외부 LLM(OpenAI·Claude)으로 쌓인 데이터, 수천 건 이상 감사 로그에서의 성능은 확인하지 못했습니다.
- 프로덕션 배포 구성(정적 호스팅, CORS 원본, HTTPS)은 정하지 않았습니다. `npm run preview`도 3000 포트를 씁니다.
- mock은 새로고침하면 초기화됩니다. 자동 로그아웃은 설정의 시간(기본 30분)을 따르지만 실제로 30분을 기다려 보지는 않았습니다 (세션 만료 화면은 `/login?expired=1`로 확인).
- 디자인과 다르게 한 곳: 로그인 화면의 "화면 상태" 전환 버튼(디자인 확인용)은 넣지 않고 실제 동작으로 각 상태가 나오게 했습니다. "회사가 아직 없나요?"와 U7의 "채팅으로 돌아가기", U8 경로의 "미니 패널"은 확장 화면이라 링크 없이 두었습니다. 사용자·부서 열은 감사 로그에 없어 "—"로 보입니다. 05-2 기본 규칙 목록은 디자인 예시(계좌·카드·주소) 대신 서버에 실제로 있는 규칙(주민번호는 서버에서 "가림")으로 맞췄습니다.

## 도움말(!) 규칙

흐름이 있거나 바꾸는 화면(정책 엔진, 기본 규칙, 예외 요청, 기록, 실시간 모니터링)은 머리글 오른쪽 끝에 같은 `!` 도움말(`components/Controls.tsx`의 `Help`)을 둡니다. 새 화면에 흐름이 생기면 같은 자리에 같은 방식으로 붙이세요. 읽기만 하는 화면(개요, 분석 리포트)과 설정에는 두지 않았습니다.
