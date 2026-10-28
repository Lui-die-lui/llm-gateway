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
| `X-Gateway-Site` · `X-Gateway-Client` | 감사 기록에만 남는 꼬리표 (예: `chatgpt.com`, `extension/0.3.0`). 100자까지만 저장 |
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

`GATEWAY_ADMIN_TOKEN`이 설정되어 있으면 `X-Admin-Token` 헤더가 필요하고, 없으면 401이고, 본문은 다른 오류와 같은 `{"error":{"type":"unauthorized","message":...}}` 모양입니다. 비어 있으면 열려 있습니다.
`since`·`until`은 유닉스 초이고 생략하면 전체 기간입니다.

**`GET /v1/stats/summary?since=`**

```json
{
  "requests": 120,
  "by_status": {"ok": 100, "blocked": 15, "response_blocked": 2, "upstream_error": 3},
  "by_route": {"external": 110, "internal": 6, "block": 4},
  "by_industry": {"cosmetics": 70, "(none)": 50},
  "findings": [{"direction": "request", "label": "조성비", "action": "redact", "count": 41}],
  "redacted_requests": 80,
  "latency_p95_ms": 412,
  "redacted_items": 96,
  "response_redacted_items": 3
}
```

`redacted_requests`는 가린 항목이 1개 이상인 요청 수(`redacted_items`는 가린 항목 수), `latency_p95_ms`는 전체 요청의 95번째 백분위 지연(요청이 없으면 `null`)입니다.

**`GET /v1/stats/timeseries?bucket=minute|hour|day&since=&tz_offset=`** → `[{"bucket":"2026-10-27T09:00:00Z","requests":12,"blocked":1,"redacted_requests":7,"redacted_items":9}]`

`tz_offset`은 UTC보다 몇 분 빠른지입니다 (한국 `540`, 범위 -840~840). 주면 버킷이 그 시계 기준으로 나뉘고 이름에 오프셋이 붙습니다 (`"2026-10-27T00:00:00+09:00"`). 생략하면 UTC (`...Z`)입니다. 기간 전체에 같은 오프셋을 쓰므로 서머타임은 반영하지 않습니다.

**`GET /v1/audit/events?limit=50&offset=0&label=이메일&status=blocked&since=&until=&site=&client=`** → 최근 요청 목록(최신순, 최대 500). 각 항목: `id, ts, endpoint, provider, route, status, industries, use_case, stream, latency_ms, site, client, findings[]`. 프롬프트 내용과 값은 저장하지 않습니다.

필터에 맞는 전체 건수는 응답 헤더 `X-Total-Count`에 있습니다 (`limit`·`offset`과 무관). `since`는 포함, `until`은 미포함입니다. `site`·`client`는 정확히 같은 값만 찾고, 보내지 않은 요청은 `null`입니다.

`status`는 `ok`, `blocked`(요청 차단), `response_blocked`(응답 차단), `upstream_error` 중 하나입니다.

## 4-2. 회사 정책 (콘솔에서 고치고 실제로 적용됨)

기본 규칙과 템플릿 위에 회사가 직접 규칙을 얹습니다. 고친 내용은 **초안**에만 쌓이고, `apply`를 해야 다음 요청부터 적용됩니다.
`GATEWAY_ADMIN_TOKEN` 규칙은 4번과 같습니다. 오류는 `{"error":{"type","message"}}` 모양이고, 규칙 내용이 잘못되면 422입니다.

| 호출 | 내용 |
|---|---|
| `GET /v1/rules/builtin` | 기본 규칙 목록 `{groups:[{id,name,desc,rules:[{id,name,desc,example,labels,action}]}]}`. 토큰 없이 읽힘 |
| `GET /v1/policy` | `{version, rules[], pending[]}`. `rules`는 초안, `pending`은 적용 안 된 변경 (`{ruleId, note}`) |
| `POST /v1/policy/rules` | 규칙 추가 → `{policy, id}` |
| `PUT /v1/policy/rules/{id}` | 규칙 수정 → 정책 |
| `POST /v1/policy/rules/{id}/toggle` | 켜고 끄기 → 정책 |
| `DELETE /v1/policy/rules/{id}` | 삭제 → 정책 |
| `POST /v1/policy/apply` | 초안을 새 버전으로 적용 → `{version, applied}`. 바뀐 게 없으면 400 |
| `GET /v1/policy/versions` | 적용한 버전 목록 (최근 50개, 최신순) |
| `POST /v1/policy/versions/{v}/rollback` | 그 버전의 규칙을 새 버전으로 다시 적용 |
| `GET /v1/policy/builtin` · `PUT /v1/policy/builtin` | 기본 규칙 · 업종 항목 켜고 끄기. `PUT {enabled:{"b:이메일":false,"i:cosmetics:batch_number":false}}`는 바로 적용 |

규칙 본문: `{name, kind, action, scope, enabled, builtins, words, pattern, ai, tag, options}`

- `kind`: `words`(한 줄에 하나, 글자 그대로), `pattern`(정규식, 그룹이 있으면 1번 그룹이 값, 빈 글자에 맞는 패턴은 거절), `ai`(말로 설명, `LOCAL_LLM_MODEL`이 있을 때만 동작), `builtin`(기본 정보의 처리 방식만 바꿈. `builtins`에 `GET /v1/rules/builtin`의 `name`을 넣음)
- `action`: `redact` 가림, `block` 차단, `log` 바꾸지 않고 기록만. `log`로 찾은 것은 가림 개수에 안 들어가고 감사 기록에는 `action: "log"`로 남음
- `tag`: `[프로젝트_n]`처럼 쓰면 자리표시자 이름이 `프로젝트`가 됨. 비우면 규칙명
- API 키·비밀번호 같은 보안 정보는 `block`보다 낮게 둘 수 없음 (422)
- `scope`(부서)는 저장만 하고 적용은 전사로 함. 지금은 요청한 사람을 서버가 모르기 때문

기본 규칙을 끄면 요청과 답변 검사 모두에서 빠집니다. 보안 정보는 4개 항목(`s:*`)이 모두 꺼져야 "시크릿" 탐지가 꺼집니다.
`POST /v1/analyze`에 `use_draft: true`를 주면 아직 적용하지 않은 초안까지 넣고 시험해 볼 수 있습니다.
정책은 `data/policy.db`(`POLICY_DB`)에 저장되어 서버를 다시 켜도 남습니다.

## 5. 브라우저 확장 등 직접 LLM을 부르는 클라이언트용

- `POST /v1/sanitize` `{text, industries?, use_case?, flow?, vault_id?, site?, client?}` → `{text, vault_id, findings}`. 차단 대상이면 403. 이어서 보낼 때는 받은 `vault_id`를 같이 보내면 `[이메일_1]` 번호가 이어집니다.
- `POST /v1/restore` `{vault_id, text}` → `{text}`. `vault_id`가 없거나 30분이 지났으면 404.

## 6. 관리

`POST /v1/industries/reload` — 템플릿 파일을 고친 뒤 서버 재시작 없이 다시 읽습니다. 파일 하나라도 형식이 틀리면 400과 파일 이름을 돌려주고 기존 템플릿은 그대로 둡니다. (`GATEWAY_ADMIN_TOKEN` 설정 시 토큰 필요)
