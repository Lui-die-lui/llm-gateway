# 배포하기

내 PC가 아니라 인터넷에 올려서 팀원이나 심사위원이 접속하게 하는 방법입니다. 코드로 할 수 있는 준비는 끝나 있고, 아래 단계는 계정이 필요해서 직접 눌러야 합니다.

## 한 군데에 다 올립니다

게이트웨이가 관리자 콘솔 화면까지 같이 내보내도록 만들어 뒀습니다. 그래서 **서버 하나(Docker 이미지 하나)만 올리면** 콘솔 주소와 게이트웨이 주소가 같아집니다.

```
직원 브라우저 ── 확장 ──▶  https://내서비스.up.railway.app  ◀── 관리자가 여는 콘솔 화면
                          (게이트웨이 + 콘솔, 기록과 정책 저장)
```

콘솔과 서버가 같은 주소라서 따로 맞출 설정(서버 주소, CORS 허용)이 없습니다. Vercel은 쓰지 않아도 됩니다.
Railway, Render, Fly.io처럼 Docker 이미지를 올리고 디스크(볼륨)를 붙일 수 있는 곳이면 어디든 같은 방식입니다. 아래는 Railway 기준입니다.
화면 이름과 요금은 서비스가 바꿀 수 있어서, 이름이 다르면 비슷한 항목을 찾으세요.

## 1. Railway에 올리기

1. railway.com에 GitHub 계정으로 가입합니다.
2. New Project → **Deploy from GitHub repo** → 이 저장소를 고릅니다. org 저장소(`llm-gateway-busan`)가 목록에 안 보이면 GitHub 쪽에서 Railway 앱 접근을 허용해야 하고, 이때 org 소유자의 승인이 필요할 수 있습니다.
3. 저장소 루트의 `Dockerfile`을 알아서 찾아 빌드합니다. 첫 빌드는 화면을 같이 빌드해서 몇 분 걸립니다.
4. 서비스는 **1개**로 두세요. 늘리면 안 됩니다(적용한 정책을 프로세스마다 따로 기억합니다).
5. 서비스에 **Volume**을 추가하고 Mount Path를 `/app/data`로 합니다. 이걸 빼면 서버가 재시작될 때마다 기록과 정책이 사라집니다. 발표용으로 잠깐 쓰는 거면 없어도 돌아가지만 데이터는 날아간다고 생각하세요.
6. **Variables**에 아래를 넣습니다.

| 이름 | 값 |
|---|---|
| `UPSTREAM_MODE` | `mock` (API 키 없이 동작) |
| `GATEWAY_ADMIN_TOKEN` | 길고 아무도 모르는 문자열. 콘솔에서 입력할 비밀번호가 됩니다 |
| `GATEWAY_API_KEYS` | 앱·확장이 쓸 접속 키. `python -m app.keys 앱이름`으로 만든 줄을 쉼표로 이어 붙입니다 (아래 "실제 LLM을 연결할 때") |

**선택: Slack 알림과 접속 키**: 둘 다 콘솔 `설정` 화면에서 바로 정할 수 있어서 환경변수는 필요 없습니다. Slack은 Incoming Webhook 주소를 입력하고(비밀값이라 서버에만 저장되고 다시 보여 주지 않습니다), 접속 키는 "키 만들기"로 발급합니다. 환경변수 `SLACK_WEBHOOK_URL`, `GATEWAY_API_KEYS`도 그대로 쓸 수 있고 콘솔에서 저장한 웹훅이 있으면 그쪽이 우선합니다. 알림에 승인 화면 링크를 넣으려면 `GATEWAY_CONSOLE_URL`에 콘솔 주소를 넣으세요. 설정은 `data/settings.db`에 저장되므로 Railway에서는 볼륨에 두지 않으면 재배포 때 초기화됩니다.

### main이 바뀌면 자동으로 배포되게 하기

Railway가 GitHub 저장소와 연결돼 있으면 `main`에 push가 올 때마다 배포를 시작합니다. 그런데 push한 사람이 **Railway 프로젝트 멤버가 아니면 Railway가 배포를 멈춰 두고 멤버의 "허용"을 기다립니다.** 팀원이 PR을 병합할 때마다 프로젝트 주인이 직접 눌러야 하는 이유입니다.

이를 피하려고 CI(`.github/workflows/ci.yml`)의 마지막 `deploy` 단계가 시험 4개를 모두 통과한 뒤 Railway 토큰 주인의 이름으로 배포합니다. 한 번만 설정하면 됩니다.

1. Railway 프로젝트 → Settings → **Tokens**에서 production 환경용 **Project Token**을 만듭니다.
2. GitHub 저장소 → Settings → Secrets and variables → Actions → **New repository secret**에 이름 `RAILWAY_TOKEN`, 값은 그 토큰으로 저장합니다. 토큰은 코드나 채팅에 적지 마세요.
3. Railway 서비스 → Settings → Source에서 **Disconnect**로 GitHub 연결을 끊습니다. 연결을 두면 같은 push에 Railway가 자체 배포를 하나 더 시작해서 "허용" 대기가 또 생깁니다. 끊어도 `deploy` 단계가 코드를 직접 올리므로 배포는 계속됩니다.

`RAILWAY_TOKEN`이 없으면 `deploy` 단계는 알림만 남기고 건너뜁니다. 시험이 하나라도 실패하면 배포하지 않습니다.

7. Settings → Networking → **Generate Domain**을 눌러 `https://○○.up.railway.app` 주소를 받습니다.
8. 그 주소 뒤에 `/health`를 붙여 열어서 `{"status":"ok"}`가 나오면 서버는 성공입니다. 주소 뒤에 아무것도 안 붙여 열면 콘솔 로그인 화면이 나옵니다.

콘솔이 처음 데이터를 불러올 때 관리자 토큰 입력 화면이 나옵니다. 6번에서 정한 `GATEWAY_ADMIN_TOKEN` 값을 넣으세요. 탭을 닫으면 지워집니다.
콘솔 로그인(`admin@example.com`)은 연습용 가짜라서 보호 장치가 아닙니다. 실제로 막아주는 건 관리자 토큰뿐입니다.
`GATEWAY_ADMIN_TOKEN`을 비워 두면 서버 로그에 경고가 뜹니다. 그 상태로 공개하면 누구나 정책을 바꾸고 기록을 볼 수 있습니다.

### 실제 LLM을 연결할 때 (키 필수)

가짜 모델(`UPSTREAM_MODE=mock`)에서는 접속 키 없이도 위험이 없지만, 실제 모델을 붙이면 주소를 아는 누구나 내 키로 LLM을 쓸 수 있습니다. 순서대로 하세요.

1. 내 PC에서 접속 키를 만듭니다. 앱마다, 확장은 따로 만드세요.

```bash
python -m app.keys hr-app
python -m app.keys extension
```

2. 나온 줄들을 쉼표로 이어서 Railway의 `GATEWAY_API_KEYS`에 넣습니다 (`hr-app:gw_...,extension:gw_...`).
3. 모델 제공자의 키를 `UPSTREAM_API_KEY`에, 모델 이름을 `UPSTREAM_MODEL`에 넣고, `UPSTREAM_MODE=mock`을 지웁니다.
4. 앱에는 `gw_...` 부분을 `api_key`로 줍니다. 확장 팝업의 "접속 키" 칸에도 같은 방식으로 넣습니다.
5. 키 없이 `/v1/chat/completions`를 불러서 401이 나오는지 확인합니다.

모델 제공자 쪽에서도 사용 한도를 걸어 두세요. 게이트웨이에는 아직 키별 한도가 없습니다.

## 2. 확장을 배포한 서버에 연결하기

1. `chrome://extensions`에서 확장을 새로고침합니다(코드가 바뀌었습니다).
2. 확장 아이콘 → **게이트웨이 주소**에 위 주소를 넣고 저장 → Chrome이 묻는 권한을 허용합니다.
3. "게이트웨이 연결됨"이 보이면 chatgpt.com, claude.ai에서 평소대로 쓰면 됩니다.

내 PC 밖의 서버는 `https://` 주소만 받습니다. 프롬프트가 평문으로 나가면 가리는 의미가 없기 때문입니다.

## 3. 올리기 전에 확인할 것

- [ ] `/health`가 열린다
- [ ] 주소 첫 화면에 콘솔 로그인이 뜨고, 로그인 후 토큰을 넣으면 숫자가 나온다
- [ ] `GATEWAY_ADMIN_TOKEN`을 설정했다
- [ ] `UPSTREAM_MODE=mock`이거나, 실제 키를 넣었다면 서버 주소를 아무에게나 공개하지 않았다 (호출하는 사람을 확인하는 장치가 아직 없어서, 주소를 아는 사람이 내 키로 LLM을 부를 수 있습니다)
- [ ] 확장 팝업에 "게이트웨이 연결됨"이 뜬다
- [ ] 정책을 한 번 만들어 적용한 뒤 서버를 재시작해도 남아 있다 (Volume이 붙었는지 확인)

## 4. 확인하지 못한 것

- 이 PC에는 Docker가 없어서 로컬에서는 이미지를 빌드해 보지 못했습니다. 대신 Railway에서 실제로 빌드하고 띄워서 `/health`, 콘솔 화면, 관리자 토큰 차단(토큰 없이 401), 가림·복원·차단 호출을 확인했습니다. 서비스는 `PORT`를 Railway가 주는 값(8080)으로 받아 동작했습니다.
- Volume이 재시작 뒤에도 정책을 남기는지는 확인하지 못했습니다(정책을 바꾸려면 관리자 토큰이 필요해서). 정책을 하나 적용하고 서비스를 재시작해서 남아 있는지 직접 확인해 보세요.
- 확장의 주소 설정은 문법만 확인했고 Chrome에 로드해서 눌러 보지는 못했습니다.

## 다른 방식

**콘솔만 Vercel에 따로 올리기**: 화면은 Vercel, 서버는 Railway로 나누는 방식입니다. 서버 주소 설정과 CORS를 직접 맞춰야 해서 더 번거롭습니다. 그래도 하려면 Vercel에서 Root Directory를 `frontend`로 하고 `VITE_GATEWAY_URL`에 서버 주소를 넣은 뒤(`frontend/vercel.json`이 화면 경로를 처리합니다), 서버의 `GATEWAY_CORS_ORIGINS`에 Vercel 주소를 넣습니다. org 저장소는 org 소유자가 Vercel 앱 설치를 승인해야 목록에 보입니다.

**직원 PC마다 게이트웨이를 띄우기**: 서버 배포가 필요 없습니다. 각자 `.\dev.bat`으로 켜면 되고 확장은 기본값(`http://localhost:8000`) 그대로 씁니다. 다만 정책이 PC마다 따로 저장되어 회사 전체의 규칙을 한곳에서 관리할 수 없습니다.


## 발표 전에 데이터 비우기

테스트하면서 쌓인 예외 요청·기록은 서버의 `data/` 볼륨에 있습니다. 비우려면 서버를 멈춘 뒤 `python scripts/reset_data.py --yes`를 그 서버에서 실행하거나 볼륨의 `exceptions.db`, `audit.db`를 지웁니다 (인자 없이 실행하면 무엇이 지워질지만 보여 줍니다). 다시 켜면 빈 파일이 생기고, `python scripts/seed_demo.py <주소>`로 가짜 트래픽을 채울 수 있습니다. 콘솔의 "예시 값" 표시가 붙은 숫자와 목록은 브라우저 안의 가짜 데이터라 이 스크립트와 무관합니다.
