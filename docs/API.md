# API 명세 (프론트엔드용)

기본 주소는 `http://localhost:8000`입니다. 서버를 띄우면 `http://localhost:8000/docs`에서 직접 호출해 볼 수도 있습니다.
모든 응답은 JSON이고, 실패는 `{"error": {"type": "...", ...}}` 형태입니다. 원본 민감값은 어떤 응답에도 들어가지 않습니다.

개발 중에는 `.env`에 `UPSTREAM_MODE=mock`을 넣으세요. API 키 없이 "가린 프롬프트를 그대로 되돌려주는" 가짜 LLM이 답합니다.

## 1. 채팅 프록시 `POST /v1/chat/completions`

OpenAI 호환입니다. 요청 본문은 OpenAI chat.completions와 같습니다 (텍스트 대화만 지원).

| 요청 헤더 | 설명 |
|---|---|
| `X-Gateway-Industry` | 적용할 산업 템플릿. 쉼표로 여러 개 (`cosmetics,medical`). 생략하면 기본 PII 규칙만 |
| `X-Gateway-Use-Case` | 활용처 (`translation` 등). 템플릿의 `applies_to.use_cases`에 없으면 그 템플릿은 건너뜀 |
| `X-Gateway-Flow` | 데이터 흐름. 템플릿의 `applies_to.flow`와 다르면 건너뜀 |
| `X-Admin-Token` | 이 엔드포인트에는 필요 없음 |

| 응답 헤더 | 설명 |
|---|---|
| `X-Gateway-Redacted` | 가린 항목 수 |
| `X-Gateway-Route` | `external` 외부 LLM으로 보냄 / `internal` 내부 모델로 처리 |

**스트리밍** (`"stream": true`): OpenAI와 같은 SSE(`data: {...}\n\n`, 마지막에 `data: [DONE]`)입니다. 복원된 텍스트가 조각으로 옵니다.

```js
const res = await fetch("http://localhost:8000/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Gateway-Industry": "cosmetics" },
  body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "..." }] }),
});
if (!res.ok) throw await res.json(); // 요청 단계에서 차단되면 스트림이 아니라 403 JSON
const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
// 읽은 조각을 줄 단위로 나눠 "data: " 뒤의 JSON을 파싱. choices[0].delta.content 를 이어붙이면 됩니다.
// 스트림 도중 {"error": {...}} 이벤트가 오면 중단 (응답 차단 또는 업스트림 오류).
```

**오류**

| 상태 | `error.type` | 의미 |
|---|---|---|
| 400 | `invalid_request` / `unknown_industry` | 형식 오류 / 없는 산업 이름 |
| 403 | `gateway_blocked` | 차단. `direction`이 `request`(프롬프트에 차단 대상) 또는 `response`(응답에 차단 대상). `findings`는 `{"시크릿": 1}` 형태의 유형별 건수 |
| 502 | `upstream_error` | 외부 LLM 호출 실패 |

## 2. 미리보기 `POST /v1/analyze`

"이 문장을 보내면 무엇이 가려지나"를 보여주는 플레이그라운드용입니다. 아무것도 저장하지 않고 감사 로그에도 남지 않습니다.

```json
// 요청
{ "text": "고객 홍길동 메일 kim@corp.co.kr", "industries": ["cosmetics"], "use_case": null, "flow": null }
// 응답
{
  "sanitized": "고객 [사람_1] 메일 [이메일_1]",
  "route": "external",
  "spans": [{"start": 3, "end": 6, "label": "사람", "action": "redact"}, {"start": 10, "end": 24, "label": "이메일", "action": "redact"}],
  "findings": {"사람": 1, "이메일": 1}
}
```

`route`는 `external` / `internal` / `block`입니다. `spans`의 위치는 파이썬 문자열 인덱스(유니코드 코드포인트)라서, 이모지가 섞인 텍스트는 JS에서 `Array.from(text)` 기준으로 잘라야 맞습니다.

## 3. 정보 조회

| 엔드포인트 | 설명 |
|---|---|
| `GET /health` | `{"status":"ok"}` |
| `GET /v1/config` | `provider`, `mock`, `internal_route`, `response_scan`, `local_llm_detector`, `streaming`, `admin_protected`. 상태 패널용 (비밀 값 없음) |
| `GET /v1/industries` | 산업 목록. 각 항목에 `entities`(id, label, sensitivity, action, regulation), `applies_to`, `test_cases` |
| `GET /v1/industries/{name}` | 템플릿 전체 |
| `GET /v1/eval` | 범용 탐지 vs 템플릿 탐지 비교. 템플릿의 `tests`를 정답으로 계산 (발표용 비교표/차트) |

`GET /v1/eval` 응답 예: `{"industries":[{"industry":"cosmetics","expected":4,"generic_recall":0.0,"template_recall":1.0,"negative_cases":1,"template_false_positives":0, ...}], "overall":{"expected":7,"generic_recall":0.0,"template_recall":1.0}}`

## 4. 대시보드용 통계 (메타데이터만)

`GATEWAY_ADMIN_TOKEN`이 설정되어 있으면 `X-Admin-Token` 헤더가 필요하고, 없으면 401입니다. 비어 있으면 열려 있습니다.
`since`는 유닉스 초이고 생략하면 전체 기간입니다.

**`GET /v1/stats/summary?since=`**

```json
{
  "requests": 120,
  "by_status": {"ok": 100, "blocked": 15, "response_blocked": 2, "upstream_error": 3},
  "by_route": {"external": 110, "internal": 6, "block": 4},
  "by_industry": {"cosmetics": 70, "(none)": 50},
  "findings": [{"direction": "request", "label": "조성비", "action": "redact", "count": 41}],
  "redacted_items": 96,
  "response_redacted_items": 3
}
```

**`GET /v1/stats/timeseries?bucket=hour|day&since=`** → `[{"bucket":"2026-10-27T09:00:00Z","requests":12,"blocked":1,"redacted_items":9}]` (UTC)

**`GET /v1/audit/events?limit=50&offset=0&label=이메일&status=blocked`** → 최근 요청 목록(최신순, 최대 500). 각 항목: `id, ts, endpoint, provider, route, status, industries, use_case, stream, latency_ms, findings[]`. 프롬프트 내용과 값은 저장하지 않습니다.

`status`는 `ok`, `blocked`(요청 차단), `response_blocked`(응답 차단), `upstream_error` 중 하나입니다.

## 5. 브라우저 확장 등 직접 LLM을 부르는 클라이언트용

- `POST /v1/sanitize` `{text, industries?, use_case?, flow?, vault_id?}` → `{text, vault_id, findings}`. 차단 대상이면 403. 이어서 보낼 때는 받은 `vault_id`를 같이 보내면 `[이메일_1]` 번호가 이어집니다.
- `POST /v1/restore` `{vault_id, text}` → `{text}`. `vault_id`가 없거나 30분이 지났으면 404.

## 6. 관리

`POST /v1/industries/reload` — 템플릿 파일을 고친 뒤 서버 재시작 없이 다시 읽습니다. 파일 하나라도 형식이 틀리면 400과 파일 이름을 돌려주고 기존 템플릿은 그대로 둡니다. (`GATEWAY_ADMIN_TOKEN` 설정 시 토큰 필요)
