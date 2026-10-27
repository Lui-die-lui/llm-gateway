# 산업 템플릿 작성 가이드

`industries/<산업>.yaml` 파일 하나가 산업 하나입니다. 서버를 다시 띄우면 자동으로 로드되고, 요청 헤더 `X-Gateway-Industry: <산업>`으로 적용됩니다.
스키마는 [app/taxonomy.py](../app/taxonomy.py)에 있고, 형식이 틀리면 서버가 시작할 때 에러로 알려줍니다.
출발점은 [industries/cosmetics.yaml](../industries/cosmetics.yaml)입니다.

## 필드

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | O | 유형 식별자. 영문 snake_case |
| `label` | | 가림 표시 이름. `조성비`라고 쓰면 `[조성비_1]`로 바뀝니다. 없으면 `id` 사용 |
| `detection.patterns` | | 정규식 목록. 캡처 그룹이 있으면 그룹 1만 민감값으로 가립니다 |
| `detection.context_keywords` | | 있으면 패턴 hit 앞뒤 40자 안에 이 키워드가 있을 때만 잡습니다 (오탐 방지) |
| `detection.ner_hint` | | 나중에 로컬 LLM 판정에 쓸 설명. 지금은 탐지에 쓰이지 않습니다 |
| `sensitivity` | O | `critical` / `high` / `medium` |
| `action` | O | `redact` 가림 / `block` 차단 / `internal_only` (내부 모델 라우팅이 없어서 현재는 차단과 동일) |
| `regulation` | | 관련 법규. 감사 증빙용 |
| `applies_to` | | 활용처(`use_cases`)와 데이터 흐름(`flow`). 아직 탐지에는 반영되지 않습니다 |

## 주의

- `patterns`가 없는 항목은 지금 탐지되지 않습니다. 키워드만으로는 어디까지가 값인지 알 수 없기 때문입니다. 값의 앞뒤 형태를 정규식으로 적어주세요.
- 키워드 없이 `\d+%` 같은 넓은 패턴만 쓰면 모든 퍼센트를 가립니다. `context_keywords`를 꼭 붙이세요.
- YAML에서 정규식은 작은따옴표(`'...'`)로 감싸야 `\d`가 그대로 전달됩니다.
- 파일 이름이 `_`로 시작하면 로드하지 않습니다 (작성 중인 초안용).

## 테스트 추가

가짜 데이터로 "템플릿 없이는 통과, 템플릿이 있으면 가려진다"를 보여주는 문장을 `tests/`에 추가해 주세요.
`tests/test_pipeline.py`의 `test_industry_template_catches_formulation_ratio`가 예시입니다. 이 쌍이 발표에서 쓸 before/after 장면이 됩니다.
