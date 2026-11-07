# M1 현재 검증과 완료 절차

기준: 2026-11-14 한국시간. **M1은 아직 완료하지 않았다.** 이번 결과는 2026-10-31의 성공 기록과 별도로 취급한다. 운영 저장소는 `/Users/ukkhnn/Developer/personal-ai`이며 iCloud 사본을 수정하지 않았다.

## 사용자 재인증 이후 추가 확인

Tailscale 앱이 **Connected**로 전환됐고, 일반 Chrome에서 정확한 HTTPS 주소를 직접 입력해 **Personal AI 로그인 화면**까지 확인했다. 브라우저 도구의 HTTPS 이동에서는 여전히 출처 거부가 발생한다. 따라서 최초 DNS 장애는 일반 브라우저 경로에서 해소됐으며, 도구 접속 경로와 일반 접속 경로의 차이는 남아 있다. 셸의 curl·모델 검증 권한 제한은 별개로 지속된다. 앱 로그인 이후 흐름과 물리 맥북 단절 시험은 아직 완료하지 않았다.

사용자가 이번 변경의 작성자·커미터 날짜를 모두 2026-11-06·07·08로 지정하도록 요청했다. 날짜별 4개씩 총 12개 커밋을 계획했으나 `git add`가 `.git/index.lock: Operation not permitted`로 차단됐다. 아직 커밋은 생성하지 않았다. 실행 권한이 있는 일반 터미널용 `.operations/commit-m1.sh`를 준비했으며 파일 해시·기준 HEAD·브랜치·staging 상태를 확인한 뒤 지정 파일만 커밋한다. 커밋 날짜는 사용자 지정 메타데이터이고 이 문서의 실제 검증 날짜는 11월 14일로 유지한다. 기존 이력 변경과 push는 수행하지 않는다.

## 최초 확인 결과 — 재인증 이전 상태 포함

| 항목 | 현재 관찰 | 판정 |
|---|---|---|
| 경로·쓰기 | `pwd`·`realpath` 모두 운영 경로. 임시 파일 생성·삭제 성공 | 확인 |
| Git | `codex/mac-mini-central`, 시작 HEAD `2835d48`, 시작 시 미커밋 변경 없음 | 확인; 이번 변경은 커밋·push하지 않음 |
| 지침 | 상위 경로와 저장소 내부에 별도 `AGENTS.md` 파일 없음. 세션 지침 및 저장소 문서 사용 | 확인 |
| 실행 호스트 | `ukkhnns-Mac-mini.local`, Darwin arm64, Node 26.7.0, Git 2.54.0, OpenCode 1.18.18 | 확인 |
| 서비스 | `gui/501/local.personal-ai.workspace`: `running`, PID `22584`, `runs=2`; 작업 전후 동일 | 확인 |
| 실행 위치 | Developer 운영본의 `agent-workspace/app/src/main.js`; 외부 `server.env` 사용 | 확인 |
| 수신 | `lsof`: PID 22584가 `127.0.0.1:4310` 수신 | 확인 |
| 데이터 | `~/.local/share/personal-ai`, 프로젝트 2개·템플릿 1개·기존 완료 작업 1개 보존 | 과거 완료 상태를 현재 모델 검증으로 세지 않음 |
| 전원 | AC Power `sleep=0`, `displaysleep=20` | 설정 확인; 실제 잠자기·재부팅 시험은 아님 |
| 로컬 브라우저 | 일반 Chrome 새 탭의 주소창에 로컬 URL을 입력하면 로그인 화면 표시 | 초기 화면 확인; 로그인 이후는 미검증 |
| 브라우저 도구 | 로컬 URL 이동에 `같은 출처의 요청만 허용합니다.` 응답 | 재현; 아래 분석 참고 |
| HTTPS | 일반 Chrome `DNS_PROBE_FINISHED_NXDOMAIN`; 도구 `ERR_NAME_NOT_RESOLVED` | 현재 접속 불가 |
| Tailscale | 앱 `Not Connected`. Reconnect 후 `Needs Authentication`; Log In 화면 열음 | 사용자 재로그인 대기; 복구 완료 아님 |
| 구문·테스트 | 구문 검사 통과. 36개 중 28개 통과, 8개 `listen EPERM` | HTTP 8개 환경 차단, 전체 통과 아님 |
| 실제 모델 | managed 검증 실행이 연결 단계에서 `EPERM` 중단 | 모델·파일 수정·승인·후속 응답 미검증 |
| 접속 독립성 | LaunchAgent·동일 PID 유지, 모의 엔진 서버 타이머 시험 통과 | 실제 맥북 단절 중 작업 유지 증거는 아직 없음 |

`workspace.json` 수정 시각은 작업 전후 `2026-10-31T10:51:20.023Z`로 동일했다. 이번 시도로 운영 작업·프로젝트를 추가하거나 기존 완료 작업을 변경하지 않았다. 서비스 재시작, 데이터 삭제, 인증 파일 수정, Tailscale 접근 정책·Serve·Funnel 설정 변경은 하지 않았다. 기존 Tailscale 연결 재시도와 로그인 화면 열기만 수행했다.

## 출처 오류와 HTTPS 장애 구분

`requestContext()`는 정확한 Host·Origin을 검사하고 `Sec-Fetch-Site: cross-site` 또는 `same-site`를 GET에서도 거부한다. 직접 이동(`none`)과 동일 출처 요청은 허용하며 모든 변경 요청에는 정확한 Origin이 필요하다.

같은 로컬 주소에서 **도구 이동은 출처 거부, 일반 Chrome 주소창 직접 이동은 정상 로그인 화면**이라는 차이를 확인했다. 앱이 모든 브라우저 접속을 거부하는 상태는 아니다. 도구 경로의 요청 조건 차이가 의심되지만 거부된 실제 Origin·Fetch Metadata 헤더를 수집하지 못했으므로 특정 헤더나 확장 프로그램을 확정 원인으로 단정하지 않는다. 도구의 `pressKey` 이동도 오류가 유지됐고, 일반 Chrome 앱 UI에서 새 탭을 만들어 직접 입력한 결과를 별도로 확인했다.

HTTPS는 앱 출처 검사를 받기 전에 DNS 해석에서 실패했다. Tailscale 재인증 필요 상태도 확인했으므로 기존 계정 재로그인 후 DNS·Serve·TLS를 다시 확인한다. 재로그인만으로 모든 문제가 해결된다고 가정하지 않는다. 허용 출처 확대, Fetch Metadata 검사 제거, 쿠키 완화, TLS 검증 비활성화, Funnel 활성화는 하지 않는다.

## 이번 추가 사항

- `test/http-security-unit.test.js`: 포트 없이 직접 이동·동일 출처 허용, 다른 출처·변경 요청·프록시·Funnel 거부를 확인하는 4개 테스트. 실제 HTTP 검증을 대체하지 않는다.
- `test/workspace.test.js`: 클라이언트 없이 서버 타이머가 지시를 전달하고 승인 뒤 후속 지시를 처리·저장하는 모의 엔진 테스트 1개.
- `scripts/verify-m1.js`: **이미 실행 중인 LaunchAgent 서버**에 `start`, `approve`, `verify`를 독립 프로세스로 실행. 별도 서버·엔진을 시작하거나 중단하지 않는다.
- `test/m1-verification.test.js`: 명령·세션 소유권, 작업 식별자, 실행 성공·후속 응답, 모델 호출 opt-in 검증 4개.

검증 도구의 안전 조건은 단위 테스트로 확인했다. 운영 서버를 대상으로 세 단계를 끝까지 실행하지 못했으므로 도구 자체의 실제 통합 검증도 남아 있다.

## 남은 M1 완료 절차

### 1. 연결과 HTTP 테스트

Tailscale 기존 계정 재로그인은 사용자가 완료했다. 앱이 Connected인지 확인하고, 로그인 전용 URL·키·암호는 문서나 대화에 복사하지 않는다. 아래 명령은 **맥미니의 일반 터미널**에서 실행한다. 현재 제한된 에이전트 셸 대신 사용자가 실행하거나 정식으로 네트워크·포트 권한이 허용된 후 실행해야 한다. UI 터미널을 통해 에이전트의 권한 제한을 우회하지 않는다.

```sh
cd /Users/ukkhnn/Developer/personal-ai/agent-workspace/app
node --env-file="$HOME/.local/share/personal-ai/server.env" scripts/doctor.js
npm run check
npm test
curl --connect-timeout 5 --max-time 15 --silent --show-error \
  --output /dev/null --write-out 'HTTPS: %{http_code}; TLS: %{ssl_verify_result}\n' \
  https://ukkhnns-macmini.tail2e5038.ts.net/
```

기대 결과는 Tailscale Running·online, HTTPS 프록시 일치·Funnel off, 테스트 36개 통과, HTTPS 200·TLS 0이다. 오류가 있으면 그대로 기록하며 과거 결과로 대체하지 않는다. 암호를 URL이나 명령 인수에 입력하지 않는다.

### 2. 작업 시작 후 접속 종료

**실제 모델 지시 2개를 생성하므로 비용이 발생할 수 있다.** 모델이 달라졌다면 확인한 ID를 명시한다. 기존 OpenCode 인증은 변경하지 않는다.

```sh
cd /Users/ukkhnn/Developer/personal-ai/agent-workspace/app
LIVE_MODEL_TEST=1 LIVE_PROVIDER_ID=deepseek LIVE_MODEL_ID=deepseek-flash \
  node --env-file="$HOME/.local/share/personal-ai/server.env" scripts/verify-m1.js start
```

새 `~/.local/share/personal-ai/verification/m1-…/report.json` 경로와 `STARTED`가 출력된다. 경로를 기록하고 원본 fixture·worktree·리포트를 보존한다. 중앙 앱에 등록되므로 삭제하면 서버 재시작 시 경로 검증에 영향을 준다.

정상 종료하면 검증 클라이언트도 종료된다. 맥북의 해당 브라우저·SSH·원격 터미널 접속을 끊고 기다린 뒤 재접속한다. **맥미니 사용자 로그아웃·재부팅·전원 종료는 다른 시험**이다. LaunchAgent는 맥미니의 사용자 로그인 세션에 속한다.

### 3. 승인 후 다시 접속 종료

`M1_REPORT`에 방금 출력된 실제 경로를 넣는다.

```sh
M1_REPORT="$HOME/.local/share/personal-ai/verification/m1-실제접미사/report.json"
node --env-file="$HOME/.local/share/personal-ai/server.env" scripts/verify-m1.js approve "$M1_REPORT"
```

동일 서버 PID·작업·모델·세션과 파일 결과, 승인 대기를 확인한 뒤 **정확히 `git diff --stat` 한 번만 승인**한다. 예상하지 않은 명령·질문·실패는 자동 처리하지 않는다. 파일이나 승인 요청이 아직 준비되지 않았다면 기다렸다가 작업 상태를 확인한다. `approval-sending`은 전달 여부가 모호할 수 있어 자동 재승인하지 않는다. 새 `start`로 반복하지 말고 기존 작업을 조사한다.

`APPROVED` 이후 프로세스가 종료된다. 맥북 접속을 다시 끊고 기다린 뒤 재접속한다. 그 사이 명령 실행과 후속 읽기 지시가 서버에서 완료돼야 한다.

### 4. 결과 확인

```sh
node --env-file="$HOME/.local/share/personal-ai/server.env" scripts/verify-m1.js verify "$M1_REPORT"
```

조건: 단계별 동일 LaunchAgent PID, 명령 1회·exit code 0, 정확한 `smoke.txt`, 추적 README diff, 후속 답변 일치, 원본 fixture 무변경, 새 로그인에서 같은 task ID 조회. 아직 실행 중이면 나중에 `verify`만 다시 실행한다.

리포트 `passed`는 **로컬 managed 흐름**의 성공이다. 맥북의 물리 연결 여부는 감지하지 않으므로 실제 단절·재접속 시각과 관찰 기기를 별도로 기록한다. HTTPS 로그인과 같은 작업 조회도 브라우저에서 확인한다. 이 증거까지 갖춘 후 M1을 완료로 전환한다. M2 모바일 승인, M3 Ollama, M4 기기 전환 종합 검증은 이번에 완료 처리하지 않는다.

## 운영 범위

클라이언트 종료는 서버 종료가 아니다. 맥미니 OS 로그아웃은 GUI LaunchAgent 세션을 끝낼 수 있고 재부팅 후에는 사용자 로그인·FileVault 해제가 필요할 수 있다. `sleep=0`은 유휴 잠자기 설정이며 강제 잠자기·정전·재부팅 중 실행 보장을 뜻하지 않는다. 이런 장애·복구 시험은 M1 접속 종료 시험과 구분해 후속 검증으로 남긴다.
