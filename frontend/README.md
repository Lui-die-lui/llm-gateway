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

로그인: **admin@example.com / test1234** (mock 계정). 다른 `@example.com` 주소 + test1234 → "관리자 아님", 그 밖의 값 → 실패, 5번 틀리면 잠김.
2단계 인증 화면은 설정 › 가입 · 로그인 › "관리자 2단계 인증"을 켜고 저장했을 때만 나옵니다 (아무 6자리, 000000은 실패).

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
| `/console/users` · `/settings` | 07 구성원 · 가입 승인 · 08 설정 |
| `/console/token` | 관리자 토큰 입력 (401일 때 자동 이동) |
| `/me` · `/me/history` · `/me/request` | U7 전체 보기 · U8 치환 기록 · U9 예외 요청 |

`/console/*`에는 로그인 가드가 있습니다. 포털(`/me/*`)은 확장에서 여는 화면이라 콘솔 로그인과 따로 두었고, 지금은 가짜 사용자(김민지)로 보입니다.

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
  api/          client(공통 fetch·오류), gateway(실제 API), console(서버에 없는 기능 → mocks), 타입
  mocks/        메모리 mock 서버(db.ts)와 가짜 데이터(seed.ts)
  styles/       tokens.css(디자인 토큰), global/layout/viz.css
```

화면은 `api/`만 부릅니다. mock을 실제 API로 바꿀 때는 `api/console.ts`에서 해당 함수 본문만 바꾸면 됩니다.
디자인 토큰(유리 카드, 배경 그라데이션, IBM Plex Sans KR / Mono, 처리 색 통과 `#A9B6C8` · 가림 `#2a78d6` · 차단 `#e34948`)은 `styles/tokens.css`에 CSS 변수로 있습니다. Tailwind는 쓰지 않았습니다.

## 실제 API vs mock

| 화면 | 실제 API | mock (서버에 아직 없음) |
|---|---|---|
| 사이드바 | `GET /health` (검사 서버 상태) | 회사 이름·코드·구성원 수, 대기 건수 배지 |
| 01 개요 | `/v1/stats/summary` (오늘·어제 비교), `/v1/stats/timeseries` (시간대·일별, 14일 스파크라인), `/v1/audit/events` (실시간 이벤트) | "확인 대기" 카드, 상단 알림 3개 |
| 02 실시간 | `/v1/audit/events` 이벤트 스트림 (5초/30초/일시정지), 분당 그래프 (`/v1/stats/timeseries?bucket=minute`), 이상 징후 (`/v1/anomalies`, 기록에서 계산) | |
| 03 기록 | 전송 기록 = `/v1/audit/events` (limit·offset·label·status), CSV는 받은 메타데이터로 브라우저에서 생성 | 관리자 작업 탭, 오탐 신고(이 탭에서만 유지) |
| 04 리포트 | 검사 수·차단률(`summary`), 일별 가림·차단(`timeseries`), 정보 종류별 집계(`summary.findings`), 규칙별 정확도(`/v1/eval`), 가림률·p95 (`summary`의 `redacted_requests`, `latency_p95_ms`) | 잘못 찾은 비율, 부서 × 정보 종류, 교육 대상 후보·Slack, 정기 리포트 |
| 05 정책 엔진 | 규칙 목록·편집·새 규칙·켜고 끄기·삭제·승인 적용 (`/v1/policy/*`), 미리 시험하기 = `POST /v1/analyze` (초안 포함) | 부서별 적용(저장만 됨), 검토 창·예외·알림 옵션(저장만 됨) |
| 05-2 기본 규칙 | 기본 규칙 목록 `GET /v1/rules/builtin`, 업종 규칙 `GET /v1/industries`, 켜고 끄기·적용 `GET/PUT /v1/policy/builtin`, 상태 `GET /health`·`/v1/config` | — |
| 06 · 07 · 08 | — | 전부 |
| P2 로그인 | — | 로그인·잠금·2단계 인증 |
| U7 · U8 · U9 | — | 전부 (포털에서 보낸 예외 요청은 06에 그대로 나타남) |

mock 숫자가 실제 숫자와 섞이는 카드에는 "예시 값" 배지를 달았습니다. mock 상태는 탭 메모리에만 있어 새로고침하면 처음으로 돌아갑니다 (설정만 localStorage에 남음).

오류는 `api/client.ts`에서 한 번에 처리합니다. 게이트웨이의 `{"error":{"type":...}}`와, 토큰 검사가 돌려주는 FastAPI 기본 형식 `{"detail":...}`을 둘 다 같은 `ApiError`로 바꾸고, 401이면 토큰 화면으로 보냅니다.

## 서버에 필요한 것

프론트엔드 코드는 `app/`을 건드리지 않았습니다. 아래는 mock을 실제로 바꾸려면 서버에 필요한 것들의 초안입니다.

**지금 API를 조금 고치면 되는 것** (1~6번은 서버에 반영했습니다. 응답 형식은 `docs/API.md`, 남은 일은 `docs/REVIEW.md`)
1. 토큰 검사 실패 응답 형식 통일: `require_admin`이 `HTTPException`이라 `{"detail": ...}`가 옵니다. 다른 오류처럼 `{"error":{"type":"unauthorized"}}`이면 좋겠습니다 (지금도 둘 다 처리함).
2. `GET /v1/stats/timeseries`에 `redacted_requests`(가린 항목이 1개 이상인 요청 수). 지금은 가린 *항목* 수만 있어 개요의 가림 막대는 `min(가린 항목, 요청 - 차단)`으로 근사합니다.
3. `GET /v1/stats/timeseries?tz=Asia/Seoul` 또는 `tz_offset`. 일 단위 버킷이 UTC 자정 기준이라 한국 시간과 9시간 어긋납니다.
4. `GET /v1/audit/events`에 `since`·`until`, 결과 총건수(`X-Total-Count` 헤더나 `{items,total}`), `site`(chatgpt.com 등)·`client`(확장 버전). 기록 화면의 기간·사이트 필터와 "n건 중" 표시에 필요합니다.
5. `GET /v1/stats/summary`에 `redacted_requests`, `latency_p95_ms`. 지금 리포트의 가림률·p95는 최근 500건 표본입니다.
6. 기본 규칙 목록 API (`GET /v1/rules/builtin` → label·action·설명). 지금은 `features/catalog.ts`에 고정 목록으로 맞춰 두었습니다.
7. `/v1/eval`에 규칙(라벨)별 행. 지금은 업종별 재현율만 있어 "규칙별 정확도"를 업종 단위로 보여 줍니다.

**새로 필요한 것** (모두 관리자 토큰 대신 콘솔 세션 인증이 전제)

| 기능 | 엔드포인트 초안 |
|---|---|
| 콘솔 로그인 | `POST /v1/console/login {email,password}` → `{ok}` / `{otp_required, ticket}` / 401 `{error:{type:"invalid_credentials", remaining}}` / 423 `locked` / 403 `not_admin`; `POST /v1/console/login/otp {ticket,code}`; `POST /v1/console/logout`; 세션 쿠키(HttpOnly) |
| 회사 | `GET/PATCH /v1/company` (이름·업종·메일 도메인), `POST /v1/company/code:rotate` |
| 구성원·가입 승인 | `GET /v1/members?dept=&q=`, `PATCH /v1/members/{id} {role|status}`, `GET /v1/join-requests`, `POST /v1/join-requests/{id}:approve|reject {reason}` |
| 감사 로그의 사용자·부서 | 요청에 사용자 식별(확장 로그인 토큰)과 부서 저장 → 부서별 집계 `GET /v1/stats/by-dept?since=` |
| 정책 규칙 | `GET /v1/policy` (버전·규칙), `POST /v1/policy/drafts` (생성·편집·켜고 끄기·삭제를 초안으로), `POST /v1/policy/apply`, `GET /v1/policy/versions`, `POST /v1/policy/versions/{v}:rollback`; `/v1/analyze`가 초안 규칙도 적용하는 옵션 |
| 기본 규칙 선택 | `GET/PUT /v1/policy/builtin {enabled: {label: bool}}` |
| 예외 요청 | `POST /v1/exceptions` (직원), `GET /v1/exceptions?status=`, `POST /v1/exceptions/{id}:approve {ttl,memo}` / `:reject {memo}` / `:request-info`, 허용 기간 동안 sanitize가 해당 사용자·항목·대상만 통과 |
| 교육 대상·Slack | `GET /v1/training-candidates?since=`, `POST /v1/slack/messages {member_id, template}`, Slack 연동 설정 |
| 관리자 작업 기록 | `GET /v1/admin-audit?since=` (로그인·승인·규칙 적용·설정 변경, 삭제 불가) |
| 설정 | `GET/PATCH /v1/settings` (메일 제한, 잠금, 2단계 인증, 자동 로그아웃, 보호 사이트, 보관 기간), `POST /v1/protection:pause {minutes}`, `DELETE /v1/company` (30일 유예) |
| 실시간 | 분 단위 버킷 `GET /v1/stats/timeseries?bucket=minute` (이상 징후 `GET /v1/anomalies`는 이미 연결됨) |
| 포털 | `GET /v1/me/summary`, `GET /v1/me/events`, `POST /v1/me/events/{id}:flag`, `GET /v1/me/exceptions` (치환 기록 자세히는 확장의 기기 저장소에서 읽는 것이 맞음) |

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
