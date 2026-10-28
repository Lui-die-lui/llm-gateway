# API 명세 (프론트엔드용)

기본 주소는 `http://localhost:8000`입니다. 서버를 띄우면 `http://localhost:8000/docs`에서 직접 호출해 볼 수도 있습니다.
모든 응답은 JSON이고, 실패는 `{"error": {"type": "...", ...}}` 형태입니다. 원본 민감값은 어떤 응답에도 들어가지 않습니다.

개발 중에는 `.env`에 `UPSTREAM_MODE=mock`을 넣으세요. API 키 없이 "가린 프롬프트를 그대로 되돌려주는" 가짜 LLM이 답합니다.

## 0. 접속 키 (누가 게이트웨이를 쓰나)

`GATEWAY_API_KEYS`를 설정하면 앱, 확장, 시연 화면은 키를 보내야 합니다. 비워 두면 열려 있습니다(로컬 개발용).

```
GATEWAY_API_KEYS="hr-app:gw_aaaa...,extension:gw_bbbb..."      # 이름:키, 쉼표로 여러 개
python -m app.keys hr-app                                       # 새 항목 만들기 (그 줄을 위 값에 붙임)
```

- 앱은 `Authorization: Bearer gw_...` (OpenAI SDK의 `api_key`에 이 키를 넣으면 됨) 또는 `X-Gateway-Key: gw_...`로 보냅니다. 없거나 틀리면 `401 {"error":{"type":"unauthorized"}}`입니다.
- 키가 필요한 곳은 `POST /v1/chat/completions`, `POST /v1/sanitize`, `POST /v1/restore`입니다. `/health`, `/v1/config`, `/v1/industries`, `/v1/rules/builtin`, `POST /v1/analyze`(저장·전송 없는 미리보기)는 열려 있습니다. 관리자 쪽(`/v1/policy`, `/v1/stats` 등)은 `GATEWAY_ADMIN_TOKEN`으로 따로 막고, 앱 키로는 열리지 않습니다.
- **이 키는 게이트웨이용입니다. 모델 제공자에게는 보내지 않습니다.** 키를 켜면 앱이 보낸 Authorization은 버리고, 서버의 `UPSTREAM_API_KEY`로 모델을 부릅니다. (`UPSTREAM_API_KEY`가 없으면 모델이 거절합니다.)
- 감사 기록에는 키의 이름이 `caller`로 남습니다 (콘솔 기록의 "사용자" 칸). 클라이언트가 보내는 `site`·`client`와 달리 서버가 정한 값이라 믿어도 됩니다.
- 키를 없애려면 항목을 지우고 다시 배포합니다. 바꾸려면 새 키를 먼저 추가하고, 앱을 옮긴 뒤 옛 키를 지웁니다.
- 아직 없는 것: 키별 사용량 한도, 요청 횟수 제한. 키가 새면 제한 없이 쓸 수 있으니 한도는 모델 제공자 쪽에서도 걸어 두세요.

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

## 1-2. 도구를 쓰는 에이전트 (데이터를 확인하고 고치는 작업)

`tools`를 넣어 호출해도 같은 주소로 됩니다. 모델은 가려진 값만 보고, 도구를 실행하는 앱은 진짜 값을 받습니다.

```
앱 ──요청(진짜 값)──▶ 게이트웨이 ──가려서──▶ 모델
앱 ◀──tool_calls(진짜 값)── 게이트웨이 ◀── tool_calls([사람_1])
앱이 도구 실행(회사 안, 진짜 DB)
앱 ──도구 결과(진짜 값)──▶ 게이트웨이 ──가려서──▶ 모델
앱 ◀──완료 보고(진짜 값)── 게이트웨이 ◀── 완료 보고([사람_1])
```

- **도구 결과는 글 내용과 키 이름 두 가지로 가립니다.** `{"name": "박영희", "salary": 5000000}`처럼 값만 봐서는 알 수 없는 것도 `name`, `email`, `phone`, `salary`, `address`, `account`, `card`, `ssn` 같은 키(한글 `이름`, `연락처`, `급여` 등도)로 알아봅니다. 회사 고유 필드 이름은 환경변수 `SENSITIVE_KEYS="cust_nm=사람,tel_no=전화번호"`로 더합니다. 이름이 `name`인 모든 필드가 가려지므로 상품명 같은 값도 가려질 수 있습니다.
- **모델이 만든 `tool_calls`의 인자**(JSON 문자열)는 이름표를 진짜 값으로 되돌려서 돌려줍니다. 값이 숫자였던 필드(`"salary": "[급여_1]"`)는 숫자로 돌아가고, 따옴표나 줄바꿈이 들어 있어도 JSON이 깨지지 않습니다.
- **이전 대화를 다시 보낼 때**(어시스턴트의 `tool_calls`와 도구 결과가 진짜 값으로 들어 있음)도 매번 새로 가립니다. 같은 값은 같은 이름표(`[사람_1]`)가 됩니다. 앱이 대화 전체를 다시 보내야 번호가 맞습니다.
- **스트리밍**: 글은 평소처럼 나오고, 도구 호출은 조각을 모아 복원한 뒤 한 번에 내보냅니다 (이름표가 조각 사이에서 잘릴 수 있어서). 마지막 `finish_reason`은 `tool_calls`입니다.
- **내부 모델 경로**(`internal_only` 항목)는 원본을 그대로 보냅니다.
- **지금 안 되는 것**: `UPSTREAM_PROVIDER=anthropic`은 도구를 변환하지 못해서 `400 unsupported`를 돌려줍니다(조용히 버리지 않습니다). 모델이 만든 도구 인자에는 답변 검사(역방향 DLP)를 하지 않습니다.
- 웹 ChatGPT·Claude(확장)에서는 쓸 수 없습니다. 거기서 커넥터(Gmail 등)는 그 회사 서버 안에서 실행되어 게이트웨이가 끼어들 수 없습니다.

직접 보려면 게이트웨이를 켠 상태(`UPSTREAM_MODE=mock`)에서 `python scripts/agent_demo.py`를 실행하세요.

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
