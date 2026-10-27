# 산업 템플릿 작성 가이드

`industries/<산업>.yaml` 파일 하나가 산업 하나입니다. 스키마는 [app/taxonomy.py](../app/taxonomy.py)에 있고,
출발점은 [industries/cosmetics.yaml](../industries/cosmetics.yaml), [industries/medical.yaml](../industries/medical.yaml)입니다.

## 작업 순서

1. 샘플을 복사해 `industries/<산업>.yaml`을 만들고 `entities`와 `tests`를 채웁니다.
2. 검사합니다. 형식, 정규식 문법, 그리고 파일에 적어둔 `tests` 예문까지 확인합니다.

   ```bash
   python -m app.check_templates
   ```

3. 범용 탐지와 비교한 탐지율을 봅니다. 발표에 쓸 비교표가 나옵니다.

   ```bash
   python -m app.evaluate
   ```

4. 서버가 떠 있으면 `POST /v1/industries/reload`로 재시작 없이 반영됩니다. 파일 이름이 `_`로 시작하면 로드하지 않습니다 (작성 중인 초안용).
5. PR을 올리면 `python -m pytest`가 모든 템플릿의 `tests`를 자동으로 검사합니다.

## 필드

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | O | 유형 식별자. 영문 snake_case |
| `label` | | 가림 표시 이름. `조성비`라고 쓰면 `[조성비_1]`로 바뀝니다. 없으면 `id` 사용 |
| `detection.patterns` | | 정규식 목록. 캡처 그룹이 있으면 그룹 1만 민감값으로 가립니다 |
| `detection.context_keywords` | | 있으면 패턴 hit 앞뒤 40자 안에 이 키워드가 있을 때만 잡습니다 (오탐 방지) |
| `detection.ner_hint` | | 로컬 LLM(`LOCAL_LLM_MODEL` 설정 시)에게 "이런 값을 찾아줘"라고 알려주는 설명. 정규식으로 못 잡는 값(업체명 등)에 씁니다 |
| `sensitivity` | O | `critical` / `high` / `medium` |
| `action` | O | `redact` 가려서 외부 LLM으로 / `block` 요청 자체를 차단 / `internal_only` 요청 전체를 내부 모델로만 처리 (내부 모델이 없으면 차단) |
| `regulation` | | 관련 법규. 감사·증빙용 |
| `applies_to` | | `use_cases`, `flow`. 요청 헤더 `X-Gateway-Use-Case`, `X-Gateway-Flow`가 여기 없으면 그 템플릿은 적용되지 않습니다. 헤더를 안 보내면 항상 적용 |
| `tests` | 권장 | 자체 검증 예문. 아래 참고 |

## tests 쓰는 법

```yaml
tests:
  - text: "정제수 72.4%, 글리세린 5% 배합 비율 공유"
    detect: ["72.4%", "5%"]      # 이 값들이 가려져야 함
  - text: "이번 분기 점유율 30% 상승"
    detect: []                   # 이 템플릿은 아무것도 가리면 안 됨 (오탐 검사)
```

- 양성 예문(`detect`에 값이 있는 것)은 범용 규칙만으로는 안 잡히고 템플릿이 있어야 잡히는 문장일수록 좋습니다. 발표의 before/after가 이 문장들입니다.
- 음성 예문은 헷갈리기 쉬운 문장으로 넣어주세요. (예: 키워드 없는 `%`, 환자번호 없는 8자리 숫자)
- 실제 개인정보나 실제 영업비밀은 절대 넣지 마세요. 가짜 값만 씁니다.

## 주의

- `patterns`가 없고 `ner_hint`만 있는 항목은 로컬 LLM이 켜져 있을 때만 탐지됩니다. 꺼져 있으면 체커가 경고합니다.
- 키워드 없이 `\d+%` 같은 넓은 패턴만 쓰면 모든 퍼센트를 가립니다. `context_keywords`를 꼭 붙이세요.
- YAML에서 정규식은 작은따옴표(`'...'`)로 감싸야 `\d`가 그대로 전달됩니다.
- 기본 규칙(이메일, 주민번호, 외국인등록번호, 법인등록번호, 전화번호, 사업자번호, 여권번호, 운전면허번호, 차량번호, 사람 이름, API 키)은 템플릿 없이도 항상 적용됩니다. 템플릿에 중복해서 쓸 필요 없습니다.
  법인등록번호, 여권번호, 운전면허번호는 주변 40자 안에 `법인등록번호`, `여권`, `면허` 같은 키워드가 있을 때만 잡습니다 (`app/detector.py`의 `BUILTIN_RULES`).
