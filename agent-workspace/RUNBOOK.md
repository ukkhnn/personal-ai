# Mac mini 운영 런북

기준: **2026-10-31, 한국시간**. 현재 적용된 중앙 서버를 이용하고 점검하는 절차다. 적용 이력·상세 근거는 [OPERATIONS.md](https://github.com/ukkhnn/personal-ai/blob/2835d4811667ce4f65ad244dec9267ef7be9c9e2/agent-workspace/app/OPERATIONS.md), 작업 인계는 [HANDOFF.md](https://github.com/ukkhnn/personal-ai/blob/2835d4811667ce4f65ad244dec9267ef7be9c9e2/agent-workspace/app/HANDOFF.md), 기능 진행 상황은 [README.md](README.md)를 참고한다.

## 1. 접속과 일상 사용

1. 맥북·모바일에서 기존 계정으로 Tailscale을 연결한다.
2. [Personal AI](https://ukkhnns-macmini.tail2e5038.ts.net/)를 열고 앱 접속 암호로 로그인한다. Tailscale 로그인과 앱 로그인은 별개다.
3. **맥미니·원격 연결**, OpenCode 연결 상태, 기존 프로젝트·작업이 표시되는지 확인한다.
4. 프로젝트·템플릿을 선택해 작업을 만들고 지시한다. 명령 승인은 실제 명령과 작업 폴더를 확인한 뒤 한 번 승인하거나 거절한다.

암호는 맥미니의 `~/.local/share/personal-ai/access-code.txt`를 본인만 보는 로컬 편집기로 확인한다. 키·암호·쿠키는 대화나 Git에 기록하지 않는다. 앱 로그인은 최대 12시간 유지되며 서버 재시작 후에는 다시 로그인한다. 로컬 주소와 HTTPS 주소도 각각 로그인한다.

일반 메시지는 추가 지시다. 중단하려면 별도 **중단** 버튼을 사용한다. **이어가기**는 보존된 대기 지시를 처리하도록 허용하는 동작이며, 중단된 모델 응답 자체를 복원하지 않는다. 현재는 프로젝트 의존성 설치를 포함한 모든 셸 명령이 승인 대상이다.

서버는 이미 백그라운드에서 실행 중이다. 접속할 때마다 `npm start`를 실행하지 않는다. 클라이언트 브라우저 종료와 서버 종료는 별개이며, 맥미니 자체의 재부팅·잠자기는 실행에 영향을 줄 수 있다.

## 2. 현재 운영 기준

| 항목 | 현재 값 |
|---|---|
| HTTPS 주소 | `https://ukkhnns-macmini.tail2e5038.ts.net` |
| 맥미니 로컬 주소 | `http://127.0.0.1:4310` |
| 실행 저장소 / 브랜치 | `~/Developer/personal-ai` / `codex/mac-mini-central` |
| 앱 폴더 | `~/Developer/personal-ai/agent-workspace/app` |
| 상태·작업 폴더 | `~/.local/share/personal-ai` / 그 안의 `worktrees/` |
| 서비스 | `local.personal-ai.workspace`, 사용자 로그인 후 실행하는 LaunchAgent |
| 서비스 설정 | `~/Library/LaunchAgents/local.personal-ai.workspace.plist` |
| 외부 환경 파일 | `~/.local/share/personal-ai/server.env` — 현재 경로·포트·Origin만 저장 |
| 실행 버전 | Node 26.7.0 / OpenCode 1.18.18 / 실제 검증 모델 `deepseek/deepseek-flash` |
| 네트워크 | Serve HTTPS 443 → `127.0.0.1:4310`; 앱은 loopback만 수신, Funnel 비활성 |
| 적용 기록 | `~/.local/share/personal-ai/operations/2026-10-31-activation/` |

공유 iCloud 저장소는 개발·실행에 사용하지 않는다. `main`에는 공통 문서만 반영되어 있으므로 실행 저장소를 `main`으로 바꾸지 않는다. 기존 tailnet 접근 정책은 유지했으며 특정 기기만 허용하도록 좁힌 구성은 아니다. 앱 암호 인증을 계속 사용한다.

## 3. 먼저 하는 상태 확인 — 읽기 전용

아래 명령은 **맥미니의 터미널**에서 실행한다. 다른 기기의 `127.0.0.1`은 맥미니를 가리키지 않는다.

```sh
cd "$HOME/Developer/personal-ai/agent-workspace/app"
env PORT=4310 \
  WORKSPACE_DATA_DIR="$HOME/.local/share/personal-ai" \
  WORKSPACE_PUBLIC_ORIGIN=https://ukkhnns-macmini.tail2e5038.ts.net \
  OPENCODE_BIN="$PWD/tools/opencode/node_modules/opencode-darwin-arm64/bin/opencode" \
  /opt/homebrew/Cellar/node/26.7.0/bin/node \
  --env-file="$HOME/.local/share/personal-ai/server.env" scripts/doctor.js

launchctl print "gui/$(id -u)/local.personal-ai.workspace"

curl --connect-timeout 5 --max-time 15 --silent --show-error \
  --output /dev/null --write-out 'Local home: %{http_code}\n' \
  http://127.0.0.1:4310/
curl --connect-timeout 5 --max-time 15 --silent --show-error \
  --output /dev/null --write-out 'HTTPS home: %{http_code}; TLS: %{ssl_verify_result}\n' \
  https://ukkhnns-macmini.tail2e5038.ts.net/
curl --connect-timeout 5 --max-time 15 --silent --show-error \
  --output /dev/null --write-out 'Unauthenticated API: %{http_code}\n' \
  https://ukkhnns-macmini.tail2e5038.ts.net/api/state
```

정상 결과:

- doctor: Node·Git·OpenCode 확인, Tailscale `Running, online=true`, `workspace HTTPS proxy=true`, `Funnel=off`.
- 서비스: `state = running`. PID는 실행마다 바뀌므로 고정값으로 비교하지 않는다.
- 로컬·HTTPS 첫 화면: `200`, HTTPS TLS: `0`. 로그인하지 않은 API: `401`이 정상이다.
- 브라우저 로그인 후 OpenCode 연결·DeepSeek 모델·기존 작업을 확인한다. doctor 성공만으로 실제 모델 호출 성공을 판단하지 않는다.

현재 `npm run doctor`는 앱 폴더의 `.env`만 읽는다. 위 명령은 실제 `server.env`와 LaunchAgent가 우선 적용하는 고정값을 함께 사용한다. 설치 경로·포트·Origin이 바뀌면 plist와 환경 파일, 이 명령을 함께 갱신한다. 첫 화면 확인에 `curl -I`나 인증서 검증을 끄는 `-k`를 사용하지 않는다.

모델 비용 없이 기존 결과를 확인하려면 **DeepSeek 실제 연결 검증 · 2026-10-31** 작업을 연다. ID는 `d0ac5c28-5801-4596-bb96-111bbfe832ec`다. 대화의 `hello-workspace` 답변, README diff와 `smoke.txt` 목록이 보이는지 확인한다. 이 작업·원본 fixture·worktree는 검증 근거로 보존한다.

## 4. 서비스 재시작

### 실행 중인 정상 서비스를 재시작할 때

1. 모든 작업을 확인한다. 실행·승인 대기·질문 대기 중인 작업은 완료를 기다리거나 앱의 중단 버튼으로 중단하고 **중단됨**까지 확인한다. 대기 지시도 검토한다. 일시 정지되지 않은 대기열은 재시작 후 처리될 수 있다.
2. 아래 블록을 실행한다. 서비스에 정상 종료를 요청하고, 기존 프로세스·PID 파일·포트가 모두 정리된 경우에만 다시 시작한다.

```sh
(
  set -eu
  workspace_pid="$(cat "$HOME/.local/share/personal-ai/server.pid")"
  case "$workspace_pid" in
    ''|*[!0-9]*) printf '%s\n' 'PID 파일을 확인하세요.' >&2; exit 1 ;;
  esac
  [ "$workspace_pid" -gt 1 ] || exit 1
  launchctl kill SIGTERM "gui/$(id -u)/local.personal-ai.workspace"
  for attempt in {1..45}; do
    if ! kill -0 "$workspace_pid" 2>/dev/null &&
       [ ! -e "$HOME/.local/share/personal-ai/server.pid" ] &&
       ! /usr/sbin/lsof -nP -iTCP:4310 -sTCP:LISTEN >/dev/null 2>&1; then
      launchctl kickstart "gui/$(id -u)/local.personal-ai.workspace"
      exit 0
    fi
    sleep 1
  done
  printf '%s\n' '정상 종료가 확인되지 않았습니다. 강제 실행하지 말고 상태와 로그를 확인하세요.' >&2
  exit 1
)
```

3. 잠시 후 3절의 상태 확인을 실행하고 앱에 다시 로그인한다. 기존 완료 작업과 변경 내용이 보존됐는지 확인한다. 중단한 작업은 대기 지시와 파일을 확인한 뒤 필요한 작업만 이어간다.

이 재시작 방식의 기반인 정상 종료·LaunchAgent 재시작·로그인 만료·완료 기록 보존은 확인했다. 진행 중 모델 실행의 무손실 재개를 보장하는 절차는 아니다. 종료 지연 때 `kickstart -k`, 무조건적인 강제 종료나 `server.pid` 삭제로 넘어가지 않는다.

### 서비스가 이미 멈췄을 때

먼저 `launchctl print`와 `lsof -nP -iTCP:4310 -sTCP:LISTEN`으로 상태를 확인한다. 등록된 서비스가 정상 종료되어 멈춘 경우에는 다음만 실행한다. 정상 종료 후에는 KeepAlive가 자동으로 다시 시작하지 않는다.

```sh
launchctl kickstart "gui/$(id -u)/local.personal-ai.workspace"
```

서비스가 등록되지 않았다는 오류가 나면 기존 앱 프로세스와 4310 수신이 없는지 확인하고, 기존 plist를 검사한 뒤 등록한다.

```sh
plutil -lint "$HOME/Library/LaunchAgents/local.personal-ai.workspace.plist" &&
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.personal-ai.workspace.plist"
```

plist나 실행 파일이 없으면 설치를 반복하기 전에 경로와 적용 기록을 확인한다. 실패 후 재시도를 반복하는 서비스는 오류 원인을 먼저 해결한다.

## 5. 증상별 대응

| 증상 | 먼저 확인할 것 | 조치·정상 복귀 기준 |
|---|---|---|
| HTTPS만 열리지 않고 맥미니 로컬은 열림 | 양쪽 기기의 Tailscale 연결, 정확한 HTTPS 주소, doctor의 Serve 상태 | 기존 연결이 꺼졌다면 Tailscale 앱에서 연결. 맥미니 CLI는 옵션 없는 `/Applications/Tailscale.app/Contents/MacOS/Tailscale up`으로 기존 설정 유지. 로컬 200·HTTPS 200 확인 |
| 로컬도 열리지 않음 | LaunchAgent 상태, 4310 수신, 앱 로그 | 4절에 따라 등록·실행 상태 복구. 중복 서버를 만들지 않음 |
| HTTPS에서 403 또는 인증서 오류 | 실제 DNS 이름, plist·server.env의 Origin, Serve가 `http://127.0.0.1:4310`을 가리키는지 | 주소·프록시 불일치를 바로잡음. 임의 Host 허용이나 TLS 검증 해제로 우회하지 않음 |
| 로그인 필요 / 401 | 서버 재시작 여부, 해당 주소에 로그인했는지 | 기존 앱 암호로 다시 로그인. 미인증 API 401은 정상 |
| 잠시 후 로그인하라는 오류 / 429 | 최근 로그인 시도 횟수 | 마지막 시도에서 60초 이상 기다린 뒤 한 번 시도. 성공을 포함해 서버 전체 분당 10회 제한 |
| 승인 대기·질문 대기 | 현재 작업의 요청 내용 | 해당 작업에서 한 번 승인·거절 또는 질문 응답. 이미 처리된 요청의 409는 새 목록을 확인 |
| 전달 확인 필요(`uncertain`)·실행 끊김(`interrupted`) | 대화, 전달 상태, 변경 파일, 마지막 지시의 실제 결과 | 같은 지시를 즉시 재전송하지 않음. `uncertain`은 중단으로 실행 종료부터 확인. 이후 보존 대기열을 검토해 이어가기·새 지시 여부 결정 |
| OpenCode 연결 실패·모델 목록 없음 | doctor의 실행 파일·설정 존재, 앱 연결 표시, 전용 엔진 로그 | 기존 인증·경로를 먼저 확인. 새 키 입력이나 무료 모델로 임의 교체하지 않음. 인증 변경 후에는 4절의 재시작·모델 목록 확인 |
| 중복 서버·잘못된 PID·포트 사용 오류 | 서비스 상태와 실제 4310 수신 프로세스 | 기존 프로세스의 소유자·경로를 확인. 죽은 PID는 시작 코드가 처리하므로 PID 파일을 습관적으로 삭제하지 않음 |
| 저장소 경로 없음·공유 경로 거부·상태 파일 오류 | 등록된 프로젝트·fixture·worktree와 Git 공용 경로, `workspace.json` 보존 여부 | 누락된 경로·정상 자료를 조사. 빈 상태로 초기화하거나 fixture를 삭제해 해결하지 않음 |

Tailscale 실행 파일은 `/Applications/Tailscale.app/Contents/MacOS/Tailscale`이다. 설정을 바꾸기 전 읽기 확인은 다음과 같다. 기존 다른 서비스가 있으면 덮어쓰지 않는다.

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
```

로그는 맥미니의 `~/.local/share/personal-ai/server.stderr.log`, `server.stdout.log`, `opencode.log`를 로컬에서 확인한다. 로그에 작업 내용이 포함될 수 있으므로 필요한 오류 부분만 가린 뒤 공유한다. 장애 기록에는 **한국시간, 기기·브라우저·네트워크, task ID, 마지막 성공 행동, 현재 상태·오류, 시도한 조치와 결과**를 남긴다. 인증 파일 전체나 비밀 값은 첨부하지 않는다.

## 6. 기기 전환·재부팅 검증

현재 **맥미니 자체 HTTPS와 서비스 프로세스 재시작만 검증 완료**다. 다음 항목은 실제 기기·환경에서 확인한 날짜와 결과를 남긴 뒤 완료 처리한다.

- [ ] 맥북·모바일이 각각 Tailscale과 앱에 로그인하고, 같은 기존 작업의 대화·변경을 조회한다.
- [ ] 별도 새 검증 작업을 만든다. 맥북에서 시작한 뒤 브라우저를 닫고, 모바일에서 같은 작업에 추가 지시·명령 승인을 처리한다. 맥북 재접속 후 같은 task ID·결과를 확인한다. 보존된 기존 검증 작업은 수정하지 않는다.
- [ ] 두 실제 작업을 동시에 실행해 브랜치·worktree·파일·승인 요청이 분리되는지 확인한다.
- [ ] 활성 작업을 정리한 뒤 계획된 macOS 로그아웃·재로그인·재부팅을 수행한다. 로그인 후 서비스와 Tailscale 연결, HTTPS, 재로그인과 기록 보존을 확인한다.
- [ ] 잠자기·네트워크 전환 후 실행 상태와 복구 한계를 기록한다.

현재 설정은 로그인 전 실행·FileVault 해제·잠자기 방지를 제공하지 않는다. 이 런북 작성 과정에서 맥을 재부팅하거나 전원 설정을 바꾸지는 않았다.

## 7. 서비스 해제·되돌리기

작업을 완료하거나 중단한다. 서비스가 실행 중이면 먼저 아래 명령으로 정상 종료를 요청한다. 이미 멈춘 경우에는 건너뛴다.

```sh
launchctl kill SIGTERM "gui/$(id -u)/local.personal-ai.workspace"
```

기존 앱 PID 종료·`server.pid` 해제·4310 수신 종료를 모두 확인한 뒤, 다음으로 현재 로그인 세션에서 서비스를 해제한다. 종료 확인 없이 다음 단계로 진행하지 않는다.

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.personal-ai.workspace.plist"
```

서비스를 다시 등록할 때는 4절의 bootstrap 절차를 따른다. plist가 LaunchAgents 폴더에 남으면 다음 로그인 때 다시 등록된다. 영구 해제할 경우 해당 plist를 적용 기록 폴더에 별도 이름으로 보존한 뒤 LaunchAgents 밖으로 옮긴다. 상태·작업·인증은 삭제하지 않는다.

HTTPS만 중지할 때는 현재 443이 이 앱 전용인 것을 `serve status`로 확인한 뒤 다음을 사용한다.

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --https=443 off
```

현재와 같은 설정으로 복원할 때는 앱의 로컬 200과 Origin 설정을 확인하고, 443에 다른 서비스가 없을 때만 적용한다.

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 http://127.0.0.1:4310
```

`serve reset`이나 Funnel 활성화는 이 복원 절차에 포함하지 않는다. 복원 후 3절을 다시 확인한다. Tailscale 연결 전체를 끄는 것은 다른 tailnet 기능에도 영향을 주므로 HTTPS 서비스 해제와 구분한다.

## 8. 업데이트·자료 보존의 경계

실행 코드나 Node·OpenCode 경로를 바꾸기 전 현재 브랜치·커밋·미커밋 변경과 작업 상태를 기록한다. 활성 작업을 정리하고 기존 변경을 보존한 뒤 검토한 코드만 적용한다. 서비스가 고정된 실행 파일 경로를 사용하므로 업그레이드 후 plist·server.env의 경로가 실제 파일과 일치하는지 확인한다.

- 앱 코드나 `server.env`만 변경했다면 4절의 정상 재시작을 따른다. 단, plist가 고정한 포트·상태 경로·OpenCode 경로·HTTPS Origin은 `server.env`보다 우선하므로 환경 파일만 바꿔서는 해당 값이 변경되지 않는다.
- plist를 변경했다면 기존 프로세스를 정상 종료하고 7절의 `bootout`으로 등록을 해제한다. 변경한 plist를 `plutil -lint`로 검사해 통과한 뒤 4절의 `bootstrap`으로 다시 등록한다. `kickstart`만으로는 이미 등록된 plist 설정이 갱신되지 않는다.
- 적용 후에는 3절의 진단·로그인·기존 작업 검증을 다시 수행한다.

공통 문서 `main` 반영은 앱 코드의 최종 병합과 별개다.

자동 백업과 검증된 복구 절차는 아직 없다. 보존 대상은 실행 저장소와 미커밋 파일, 등록된 모든 프로젝트 원본 저장소와 Git 공용 이력, `workspace.json`·worktree·등록된 fixture, OpenCode 세션 DB·설정, plist·server.env·운영 기록이다. 인증 정보는 암호화된 별도 보관이 필요하다. 일관된 수동 백업은 앱·전용 엔진을 정상 종료한 상태에서 수행해야 한다. GitHub만으로 작업 기록·실행 세션이 복구되지 않으며, worktree의 절대 경로 때문에 파일 복사만으로 복원 성공을 판단하지 않는다. 검증 전 기존 데이터를 덮어쓰는 복원 명령은 사용하지 않는다.

일상 접속·진단·기존 서비스 재시작은 위 절차로 처리한다. 전역 설치·새로운 시스템 설정 변경·최종 코드 병합은 기존 사용자 승인 정책을 따른다. 이번 런북은 백업·자동 의존성 설치·자동 커밋/push·최종 병합 기능이 구현됐다는 의미가 아니다.
