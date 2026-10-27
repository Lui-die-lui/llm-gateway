# Chrome 확장 (LLM Gateway Guard)

chatgpt.com에서 프롬프트를 보내기 직전에 로컬 게이트웨이로 보내 민감정보를 가리고, 답변이 오면 화면에서만 원래 값으로 되돌립니다.
빌드 도구 없이 바로 로드되는 순수 JS(Manifest V3)입니다.

## 설치 (개발용)

1. 게이트웨이를 먼저 띄웁니다: `uvicorn app.main:app` (기본 `http://localhost:8000`)
2. Chrome에서 `chrome://extensions` 를 열고 오른쪽 위 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다** → 이 `extension/` 폴더를 선택합니다.
4. chatgpt.com을 새로고침하고 `kim@corp.co.kr` 같은 문장을 보내 봅니다. 전송 직전 입력창이 `[이메일_1]`로 바뀌고, 답변 속 `[이메일_1]`은 화면에서 원래 값으로 보입니다.

## 동작

| 파일 | 역할 |
|---|---|
| `content.js` | 입력창의 Enter / 전송 버튼을 가로채 `/v1/sanitize` 호출, 답변 DOM의 `[유형_n]`을 `/v1/restore`로 복원 |
| `background.js` | 게이트웨이 호출 대행 (content script는 페이지 CORS를 받으므로 서비스 워커가 대신 호출). 적용 산업은 `INDUSTRIES` 상수 |
| `manifest.json` | `localhost:8000` 접근 권한, chatgpt.com 주입 |

- 게이트웨이가 꺼져 있거나 차단(403)이면 **전송하지 않습니다** (fail closed).
- 한글 IME 입력 중 Enter(`isComposing`)는 전송으로 취급하지 않습니다.
- 매핑(vault)은 게이트웨이 메모리에만 있고 30분 안 쓰면 사라집니다.

## 아직 안 된 것 / 한계

- **실제 chatgpt.com에서는 검증하지 못했습니다.** 입력창(`#prompt-textarea`), 전송 버튼(`data-testid="send-button"`), 답변(`data-message-author-role`) 선택자는 ChatGPT 화면 구조에 의존하므로 깨질 수 있습니다. 조원 A가 실제로 돌려보고 `content.js` 상단 상수를 고쳐주세요.
- 페이지를 새로고침하면 그 대화의 vault id를 잃어서 이전 답변의 `[이메일_1]`이 복원되지 않습니다.
- 확장은 사용자가 끌 수 있으므로 **강제 수단이 아닙니다.** 강제는 네트워크/기기 정책으로 합니다 (루트 README의 "차단 방향" 참고).
- claude.ai 등 다른 사이트는 `manifest.json`의 `matches`와 선택자를 추가해야 합니다.
- 산업 선택 팝업, 아이콘, 게이트웨이 주소 설정 UI는 없습니다.
