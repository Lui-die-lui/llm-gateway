# 외부 LLM 게이트웨이

사내 앱이 외부 LLM(ChatGPT, Claude 등)을 호출할 때, 민감정보를 가린 채로 내보내고 응답이 오면 원래 값으로 되돌려주는 프록시입니다.
`redact → forward → restore`. 전체 설계는 [docs/blueprint.html](docs/blueprint.html)을 브라우저로 열어 보세요.

## 실행

게이트웨이와 관리자 콘솔을 한 번에 켜려면 `.\dev.bat seed`를 실행하세요 (자세한 사용법은 [docs/TEST_GUIDE.md](docs/TEST_GUIDE.md), 점검 결과와 남은 일은 [docs/REVIEW.md](docs/REVIEW.md)). 아래는 서버만 직접 켜는 방법입니다.

Python 3.11 이상이 필요합니다.

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # UPSTREAM_MODE=mock 으로 두면 API 키 없이 돌아갑니다
python -m pytest                # 테스트
uvicorn app.main:app --reload --env-file .env    # http://localhost:8000  (API 문서: /docs)
```

Docker는 `docker compose up --build` (아직 직접 빌드해 보지 못했습니다). 로컬 LLM(Ollama)까지 같이 띄우려면 `--profile local-llm`.

**API 키는 필요 없습니다.** `.env.example`의 기본값이 `UPSTREAM_MODE=mock`이라서 복사만 하면 키 없이 전부 돌아갑니다. mock 업스트림은 가린 프롬프트를 그대로 되돌려주고, 게이트웨이가 그걸 복원합니다. 실제 LLM을 붙일 때만 이 줄을 지우고 키를 넣으세요.

서버 없이 핵심 장면(범용 규칙 vs 템플릿, 외부로 나가는 문장, 직원이 보는 문장)만 보려면:

```bash
python -m app.demo
```

서버를 띄워 직접 호출해 보려면:

```bash
curl -X POST localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" -H "X-Gateway-Industry: cosmetics" \
  -d '{"model":"x","messages":[{"role":"user","content":"고객 홍길동(901010-1xxxxxx)의 정제수 72.4% 배합, 담당 kim@corp.co.kr"}]}'
```

## 무엇을 하나

- **가림/복원**: 요청의 민감값을 `[이메일_1]` 같은 자리표시자로 바꿔 보내고, 응답(스트리밍 포함)에서 원래 값으로 되돌립니다. 매핑은 요청 단위로 메모리에만 있습니다.
- **탐지**: 기본 규칙(이메일, 주민번호, 외국인등록번호, 법인등록번호, 전화번호, 사업자번호, 여권번호, 운전면허번호, 차량번호, API 키(gitleaks 기본 규칙 기반)·비밀번호·DB 주소 속 비밀번호, 직함이 붙은 사람 이름) + 산업 템플릿(정규식 + 문맥 키워드) + 선택적으로 로컬 LLM 보조 (`LOCAL_LLM_MODEL`).
- **정책**: 항목별 `redact`(가림) / `block`(차단) / `internal_only`(내부 모델로만 처리). 활용처·흐름 헤더로 템플릿 적용 여부를 조절합니다.
- **응답 스캐너**: 모델 답변에 새로 섞인 이메일·번호는 가리고 API 키는 차단합니다 (`RESPONSE_SCAN=off`로 끔).
- **감사**: SQLite에 유형·건수·경로·시간만 기록합니다 (내용·값은 저장 안 함). 통계 API 제공.
- **외부 LLM**: OpenAI 호환 엔드포인트 또는 Claude(`UPSTREAM_PROVIDER=anthropic`). 입구는 항상 OpenAI 호환입니다.

## 문서

| 문서 | 대상 |
|---|---|
| [docs/API.md](docs/API.md) | 프론트엔드 (엔드포인트, 요청/응답 예, 스트리밍 사용법) |
| [docs/TAXONOMY.md](docs/TAXONOMY.md) | 템플릿 작성자 (스키마, 검사 명령, tests 쓰는 법) |
| [extension/README.md](extension/README.md) | Chrome 확장 설치 |

## 외부 LLM 선택 (OpenAI / Claude)

| 설정 | openai (기본) | anthropic |
|---|---|---|
| `UPSTREAM_PROVIDER` | `openai` | `anthropic` |
| `UPSTREAM_API_KEY` | OpenAI 키 (없으면 호출자의 Authorization 전달) | Anthropic 키 (또는 `ANTHROPIC_API_KEY`) |
| `UPSTREAM_MODEL` | 비우면 요청의 `model` 사용 | 예: `claude-opus-5-5`. 사내 앱이 `gpt-4o` 같은 이름을 보내도 이 값으로 바꿔서 보냄 |

Claude 어댑터는 텍스트 대화만 변환합니다 (이미지, 도구 호출, `temperature` 등 샘플링 값은 전달하지 않음). 내부 모델(`INTERNAL_MODEL`)은 Ollama 같은 OpenAI 호환 서버면 됩니다.

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
  main.py          FastAPI 엔드포인트
  detector.py      탐지 엔진 (내장 규칙 + 산업 템플릿)
  secret_rules.py  API 키/비밀번호 규칙 (vendor/gitleaks.toml을 시작할 때 한 번 변환, python -m app.secret_rules로 건너뛴 규칙 확인)
  llm_detector.py  로컬 LLM 탐지 보조 (선택)
  policy.py        경로 결정 (external / internal / block), 템플릿 적용 조건
  vault.py         [유형_n] <-> 원본값 매핑 (요청 단위, 메모리에만)
  sessions.py      sanitize/restore용 vault 보관 (메모리, 30분 만료)
  sanitizer.py     요청 가림, 응답 스캔/복원
  stream.py        스트리밍 응답 필터 (조각 경계에서도 안전하게 복원)
  upstream.py      외부/내부 LLM 전달 (OpenAI, Claude, mock)
  audit.py         SQLite 감사 로그와 통계 쿼리
  taxonomy.py      템플릿 스키마(pydantic) + YAML 로더
  evaluate.py      범용 vs 템플릿 탐지율 비교 (python -m app.evaluate)
  check_templates.py  템플릿 검사 (python -m app.check_templates)
extension/         Chrome 확장 (MV3)  ← 조원 A가 실제 사이트에서 검증
industries/        산업별 템플릿 YAML  ← 조원 B, C 작업 공간
vendor/            gitleaks 기본 규칙 파일(v8.30.1, MIT)과 라이선스. 실행 중에 내려받지 않습니다
docs/              블루프린트, API 명세, 템플릿 가이드
tests/
```

## 역할

| 담당 | 작업 | 건드리는 곳 |
|---|---|---|
| 본인(코어) | 백엔드 전체 | `app/` |
| 조원 A | 프론트엔드 (채팅 화면, 산업 선택, 차단 통계 대시보드) | `frontend/` (새로 만들기) |
| 조원 B, C | 산업별 템플릿 | `industries/` |

B, C는 `app/`을 건드릴 필요가 없습니다. 스키마에 필요한 필드가 없으면 이슈로 남겨주세요.

## 협업 규칙

- `main`에 직접 푸시하지 않습니다. `feature/이름-작업` 브랜치에서 작업하고 PR로 올립니다.
- PR 전에 `python -m pytest`가 통과해야 합니다. 템플릿은 `python -m app.check_templates`도 통과해야 합니다.
- `.env`, API 키, 실제 고객 데이터는 커밋하지 않습니다. 테스트 문장은 가짜 값만 씁니다.
- 감사 로그에는 유형·건수·시각만 남기고 원문은 남기지 않습니다.

## 한계와 아직 안 된 것

- **실제 외부 API는 호출해 보지 못했습니다.** OpenAI/Claude/Ollama 연동은 가짜 서버로 테스트했습니다. 키를 넣고 한 번 확인이 필요합니다.
- 사람 이름은 "고객 홍길동", "김부장님"처럼 직함이 붙은 경우만 규칙으로 잡습니다. 이름만 덩그러니 있는 경우는 로컬 LLM 보조(`LOCAL_LLM_MODEL`)를 켜야 합니다.
- 응답 스캐너는 기본 PII와 API 키만 봅니다. 템플릿 규칙을 응답에 적용하면 정상 답변까지 가려져서 일부러 뺐습니다. 프롬프트 인젝션 자체를 판별하지는 않습니다.
- **스트리밍 응답에서는 여러 줄짜리 개인 키 블록(`-----BEGIN ... PRIVATE KEY-----`)을 놓칠 수 있습니다.** 스트림 필터가 공백까지만 보류하고 200자를 넘으면 그냥 내보내서, 키가 조각으로 나뉘면 규칙이 한 번에 보지 못합니다. 요청(프롬프트)과 스트리밍이 아닌 응답은 전체 텍스트를 한 번에 보므로 잡습니다.
- **한글 비밀번호는 못 잡습니다.** 비밀번호 규칙(`비밀번호: 값`, `password=값`)은 영문·숫자·기호 4자 이상의 값만 보고, 숫자나 `!@#$%^&*+=~?`가 하나도 없는 값(`password: required`, `password = get_password()` 같은 일반 단어와 코드)은 비밀번호로 보지 않습니다.
- gitleaks의 범용 규칙(`generic-api-key`)은 일반 문장에서 오탐이 많아 차단이 아니라 가림만 합니다.
- 텍스트 대화만 지원합니다 (이미지, 도구 호출 제외).
- 게이트웨이를 호출하는 쪽의 인증(누가 쓸 수 있나)은 없습니다. 통계/관리 API만 `GATEWAY_ADMIN_TOKEN`으로 막을 수 있습니다.
- Docker 이미지는 이 PC에 Docker가 없어 빌드해 보지 못했습니다.
