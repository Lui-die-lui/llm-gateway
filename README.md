# 외부 LLM 게이트웨이

사내 앱이 외부 LLM(ChatGPT 등)을 호출할 때, 민감정보를 가린 채로 내보내고 응답이 오면 원래 값으로 되돌려주는 프록시입니다.
`redact → forward → restore`. 전체 설계는 [docs/blueprint.html](docs/blueprint.html)을 브라우저로 열어 보세요.

## 실행

Python 3.11 이상이 필요합니다.

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # UPSTREAM_MODE=mock 으로 두면 API 키 없이 돌아갑니다
python -m pytest                # 테스트
uvicorn app.main:app --reload   # http://localhost:8000
```

키 없이 동작을 확인하려면 `UPSTREAM_MODE=mock`으로 서버를 띄우고 호출해 보세요. mock 업스트림은 받은 프롬프트를 그대로 되돌려줍니다.

```bash
curl -X POST localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" -H "X-Gateway-Industry: cosmetics" \
  -d '{"model":"x","messages":[{"role":"user","content":"정제수 72.4% 배합, 담당 kim@corp.co.kr"}]}'
```

## 외부 LLM 선택 (OpenAI / Claude)

사내 앱이 부르는 입구는 항상 OpenAI 호환 형식이고, 게이트웨이가 내보내는 쪽만 `.env`로 고릅니다.

| 설정 | openai (기본) | anthropic |
|---|---|---|
| `UPSTREAM_PROVIDER` | `openai` | `anthropic` |
| `UPSTREAM_API_KEY` | OpenAI 키 (없으면 호출자의 Authorization 전달) | Anthropic 키 (또는 `ANTHROPIC_API_KEY`) |
| `UPSTREAM_MODEL` | 비우면 요청의 `model` 사용 | 예: `claude-opus-5-5`. 사내 앱이 `gpt-4o` 같은 이름을 보내도 이 값으로 바꿔서 보냄 |

Claude 어댑터는 텍스트 대화만 변환합니다 (이미지, 도구 호출, `temperature` 등 샘플링 값은 전달하지 않음). 실제 Anthropic API 호출은 아직 검증하지 못했고, 변환 로직과 전체 흐름은 가짜 클라이언트로 테스트했습니다.

## API (프론트 연동용)

| 엔드포인트 | 설명 |
|---|---|
| `POST /v1/chat/completions` | OpenAI 호환. 사내 앱은 `base_url`만 이 서버로 바꾸면 됩니다. |
| `GET /v1/industries` | 로드된 산업 템플릿 목록 (산업 선택 UI용) |
| `GET /health` | 상태 확인 |

- 요청 헤더 `X-Gateway-Industry: cosmetics,medical` 로 적용할 산업 템플릿을 고릅니다. 생략하면 기본 PII 규칙만 적용됩니다.
- 응답 헤더 `X-Gateway-Redacted`는 가린 건수입니다.
- 차단되면 `403` + `{"error":{"type":"gateway_blocked","findings":{"시크릿":1}}}`. 원본 값은 절대 응답에 넣지 않습니다.
- 지금은 `stream=true`를 지원하지 않습니다 (`501`).
- CORS 허용 오리진은 `GATEWAY_CORS_ORIGINS`로 바꿉니다. 기본값은 `localhost:5173`, `localhost:3000`.

`POST /v1/sanitize`, `POST /v1/restore`는 LLM을 직접 부르는 클라이언트(Chrome 확장)용입니다.
sanitize가 가린 문장과 `vault_id`를 돌려주고, restore는 `vault_id`로 원래 값을 되돌립니다. 같은 `vault_id`를 다시 보내면 `[이메일_1]` 번호가 이어집니다. 매핑은 메모리에만 두고 30분 뒤 사라집니다.

## 브라우저 ChatGPT / 차단 방향

확장 프로그램 설치는 [extension/README.md](extension/README.md)를 보세요. 다만 확장은 사용자가 끌 수 있어서 "막는" 수단이 아니라 "가려주는" 수단입니다.
웹 ChatGPT·Claude를 실제로 막으려면 앱이 아니라 **네트워크 쪽**에서 해야 합니다.

1. LLM API(api.openai.com, api.anthropic.com)는 게이트웨이 서버만 나갈 수 있게 방화벽 허용 목록으로 제한
2. chatgpt.com, claude.ai 같은 웹 UI는 DNS/프록시에서 차단
3. 직원은 게이트웨이 뒤에 있는 사내 채팅 화면(`frontend/`)만 사용
4. 사외 근무 기기는 MDM으로 확장을 강제 설치하고 사이트를 차단 (Chrome 정책 `URLBlocklist`, `ExtensionInstallForcelist`)

이번 주 데모에서는 1~2를 실제로 구축하지 않고, 데모 PC의 hosts 파일로 chatgpt.com만 막아 보여주는 정도를 목표로 합니다.

## 구조

```
app/
  main.py        FastAPI 엔드포인트
  detector.py    탐지 엔진 (내장 PII 정규식 + 산업 템플릿)
  policy.py      정책 판정 (block / internal_only 는 차단, 나머지는 가림)
  vault.py       [유형_n] <-> 원본값 매핑 (요청 단위, 메모리에만)
  sanitizer.py   가림/복원 파이프라인
  taxonomy.py    템플릿 스키마(pydantic) + YAML 로더
  upstream.py    외부 LLM 전달 (OpenAI / Claude 어댑터, UPSTREAM_MODE=mock 지원)
  sessions.py    sanitize/restore용 vault 보관 (메모리, 30분 만료)
extension/       Chrome 확장 (MV3)  ← 조원 A가 실제 사이트에서 검증
industries/      산업별 템플릿 YAML  ← 조원 B, C 작업 공간
docs/            블루프린트, 템플릿 작성 가이드
tests/
```

## 역할

| 담당 | 작업 | 건드리는 곳 |
|---|---|---|
| 본인(코어) | 프록시, 탐지/정책/볼트, 스트리밍, 응답 스캐너, 감사 로그 | `app/` |
| 조원 A | 프론트엔드 (산업 선택, 차단 통계 대시보드) | `frontend/` (새로 만들기) |
| 조원 B, C | 산업별 템플릿 정리 + 테스트 문장 | `industries/`, `tests/fixtures/` |

템플릿 작성법은 [docs/TAXONOMY.md](docs/TAXONOMY.md)에 있습니다. B, C는 `app/`을 건드릴 필요가 없습니다. 스키마에 필요한 필드가 없으면 이슈로 남겨주세요.

## 협업 규칙

- `main`에 직접 푸시하지 않습니다. `feature/이름-작업` 브랜치에서 작업하고 PR로 올립니다.
- PR 전에 `python -m pytest`가 통과해야 합니다.
- `.env`, API 키, 실제 고객 데이터는 커밋하지 않습니다. 테스트 문장은 가짜 값만 씁니다.
- 감사 로그에는 유형·건수·시각만 남기고 원문은 남기지 않습니다.

## 아직 안 된 것

- 스트리밍(SSE) 중계와 응답 역방향 스캔
- 이름 등 정규식으로 못 잡는 항목 (Presidio / NER / 로컬 LLM)
- `internal_only` 내부 모델 라우팅 (지금은 차단으로 처리)
- 감사 로그(SQLite)와 대시보드용 API
