# Mac mini 중앙 운영

일상 접속·진단·재시작·장애 대응 순서는 [현재 운영 런북](../RUNBOOK.md)을 따른다.

작성: 2026-10-29. 중앙 앱 실제 모델·원격 설정 상태 재확인: 2026-10-31. 설정 생성·검증과 실제 시스템 활성화를 구분한다.

## 실제 위치와 현재 상태

| 항목 | 확인 결과 |
|---|---|
| 공유 원본 | `~/Library/Mobile Documents/com~apple~CloudDocs/sogang/1 AIAI/projects/personal-ai` |
| 전용 실행 저장소 | `~/Developer/personal-ai`, 독립 clone; 공유 원본과 Git 공용 디렉토리·객체 하드링크를 공유하지 않음 |
| 작업 브랜치 | `codex/mac-mini-central` (`a73d817`에서 시작) |
| 상태·worktree·로그 | `~/.local/share/personal-ai` |
| 접속 암호 | 위 폴더의 `access-code.txt`, 600 권한; 값은 기록하지 않음 |
| OpenCode | 기존 설치를 찾지 못해 프로젝트 내부 1.18.18 사용. 공급자 인증은 별개 |
| 공급자 | 사용자 OpenCode 인증 후 `deepseek` / `deepseek-flash`(DeepSeek V4.1 Flash 1017) 실제 호출 확인 |
| 로컬 앱 주소 | `http://127.0.0.1:4310`, LaunchAgent가 중앙 앱 실행 |
| Tailscale HTTPS 주소 | `https://ukkhnns-macmini.tail2e5038.ts.net`; 실제 인증서 검증을 켜고 맥미니에서 HTTPS·앱 인증 확인 |
| Tailscale | 2026-10-31 사용자 승인 후 Running·online, MagicDNS·HTTPS 활성화; Serve 443 루트 → `127.0.0.1:4310`, Funnel 꺼짐 |
| 적용 기록 | `~/.local/share/personal-ai/operations/2026-10-31-activation/`: 적용 plist·`before.json`·`verification.json` |
| 자동 시작 | `~/Library/LaunchAgents/local.personal-ai.workspace.plist` 설치·bootstrap 완료; 실제 로그아웃·재부팅은 미검증 |
| 외부 환경 파일 | `~/.local/share/personal-ai/server.env`, 경로·Origin만 설정; API 키는 기존 OpenCode 사용자 인증 사용 |

실행 경로는 심볼릭 링크의 실제 대상과 Git 공용 저장소까지 검사한다. iCloud 및 `Library/CloudStorage` 아래 경로는 거부한다. 임의 동기화 도구의 모든 사용자 지정 경로를 자동 탐지하는 기능은 아니므로 운영자는 다른 동기화 폴더도 실행 위치에서 제외해야 한다.

## 현재 서비스 조회·재시작과 인증 연결

현재 중앙 앱은 LaunchAgent가 관리한다. Tailscale에 연결한 기기는 `https://ukkhnns-macmini.tail2e5038.ts.net`으로 접속하고 앱에 로그인한다. 맥미니 로컬 확인에는 `http://127.0.0.1:4310`을 사용하며 `npm start`나 직접 Node 실행으로 두 번째 서버를 만들지 않는다. 서비스 상태는 다음으로 확인한다.

```sh
launchctl print "gui/$(id -u)/local.personal-ai.workspace"
```

서비스는 고정된 Node·OpenCode·source 경로, 안정적인 PATH와 private 환경 파일을 사용한다. 실행 파일을 업그레이드하거나 경로를 바꾸면 적용 plist를 검토·갱신해야 한다. 환경 파일에는 경로·Origin만 있고 API 키는 없다. 2026-10-31 사용자가 OpenCode `auth login`에 직접 입력한 DeepSeek 인증을 계속 사용한다. 암호·인증 값은 로그·Git·문서에 넣지 않는다. 인증된 `/api/runtime`은 공급자·모델 이름과 ID를 반환한다.

재시작 전 활성 작업을 확인하고 필요한 작업을 앱에서 명시적으로 중단한다. 다음 명령은 앱에 SIGTERM을 보내 정상 종료를 요청한다. 앱·전용 엔진이 종료되고 `server.pid`가 제거된 것을 확인한 뒤 두 번째 명령을 실행한다. `kickstart -k`로 즉시 강제 교체하지 않는다.

```sh
launchctl kill SIGTERM "gui/$(id -u)/local.personal-ai.workspace"
# 정상 종료와 server.pid 해제 확인 후:
launchctl kickstart "gui/$(id -u)/local.personal-ai.workspace"
```

서비스가 이미 정상 종료되어 멈춘 경우에는 `kickstart`만 실행한다. 정상 종료는 상태를 저장하고 앱 전용 엔진을 닫는다. 임의의 다른 OpenCode 프로세스를 종료하지 않는다. 2026-10-31 정상 종료·재시작으로 OpenCode health, DeepSeek 연결, 기존 완료 작업 보존을 확인했다. 이전 앱 로그인은 401로 만료됐고 새 로그인에서 기록을 조회했다. 이는 실제 macOS 로그아웃·로그인 또는 재부팅 시험과 별개다.

수동 foreground 실행이 필요한 진단 상황에는 아래 되돌리기 절차로 서비스를 먼저 해제한다. 서비스와 전용 엔진의 종료를 확인한 후에만 다음을 사용한다. 진단 후에는 foreground 프로세스를 정상 종료한 뒤 LaunchAgent를 다시 bootstrap한다.

```sh
cd ~/Developer/personal-ai/agent-workspace/app
node --env-file-if-exists="$HOME/.local/share/personal-ai/server.env" src/main.js
```

## 중앙 앱 실제 검증과 자료 보존

2026-10-31 OpenCode 1.18.18의 실제 `deepseek` / `deepseek-flash`로 중앙 앱 작업 1개·지시 2개를 완료했다. `smoke.txt`의 정확한 `hello-workspace\n` 생성, 추적 README 수정과 diff, `git diff --stat` 명령 1회 승인, 후속 읽기 답변을 확인했다. 독립 로컬 인증 HTTP 클라이언트 2개의 같은 requestID는 중복 전달되지 않았고, 세 번째 새 로그인에서도 동일 완료 작업을 조회했다. 실제 브라우저 재로그인 후에도 완료 작업의 README diff·`smoke.txt` 목록을 확인했다. 원본 검증 저장소는 변경되지 않았다.

- 보존된 작업: `DeepSeek 실제 연결 검증 · 2026-10-31` / `d0ac5c28-5801-4596-bb96-111bbfe832ec`
- 결과 기록: `/Users/ukkhnn/.local/share/personal-ai/verification/deepseek-2026-10-31-Ahhp8c/report.json`
- 등록된 원본 저장소: `/Users/ukkhnn/.local/share/personal-ai/verification/deepseek-2026-10-31-Ahhp8c/fixture`
- 작업 폴더: `/Users/ukkhnn/.local/share/personal-ai/worktrees/d0ac5c28-5801-4596-bb96-111bbfe832ec`

프로젝트·검증 템플릿·작업·결과를 중앙 앱에 보존했다. 이 fixture는 임시 정리 대상이 아니다. 등록된 원본 저장소를 삭제하면 앱 재시작 때 경로 재검증이 실패하므로, 상태 데이터와 원본·worktree를 함께 유지한다. 이 검증은 실제 모델을 사용한 로컬 HTTP 검증이며 HTTPS·물리 기기·실제 병행 검증을 대신하지 않는다. HTTPS Serve와 맥미니에서의 실제 TLS 검증은 완료했다. 다음 단계는 현재 서비스를 유지하면서 물리 맥북·모바일에서 같은 작업의 원격 동작을 확인하는 것이다.

## 운영 설정을 다시 준비할 때

`prepare:macos`는 다음 세 파일을 600 권한으로 생성하고 기존 파일을 덮어쓰지 않는다.

- `local.personal-ai.workspace.plist`: 사용자 로그인 후 실행할 LaunchAgent
- `server.env.example`: private 환경 파일에 넣을 선택 설정의 예시, 비밀 값 없음
- `remote-plan.txt`: 정확한 경로·주소를 포함한 수동 시작, 적용·검증·되돌리기 명령

10월 29일 준비안은 이전 기록으로 보존하며 현재 적용 기준은 `operations/2026-10-31-activation/`이다. 실제 적용 plist는 안정적인 PATH로 정리했다. 변경 시 새 output 폴더를 사용한다. plist는 source 저장소·node·OpenCode의 절대 경로를 고정한다. 이 경로가 바뀌면 다시 생성한다. plist의 PORT(4310)·데이터 폴더·선택한 원격 주소는 환경 파일보다 우선한다.

```sh
npm run prepare:macos -- --output "$HOME/.local/share/personal-ai/operations/new-review" --origin https://ukkhnns-macmini.tail2e5038.ts.net
plutil -lint "$HOME/.local/share/personal-ai/operations/new-review/local.personal-ai.workspace.plist"
```

## 승인된 운영 변경의 적용 결과

2026-10-31 사용자가 Tailscale 연결·HTTPS·로그인 후 자동 시작을 승인했다. 관리자 로그인 후 HTTPS를 활성화했고 화면에 기본 체크되어 있던 Funnel 선택은 명시적으로 해제했다. Tailscale 연결·HTTPS Serve·LaunchAgent 설치와 bootstrap을 적용했으며 전역 소프트웨어는 새로 설치하지 않았다. 적용 자료는 `~/.local/share/personal-ai/operations/2026-10-31-activation/`에 있다.

- Tailscale Running·online, 실제 Self.DNSName, MagicDNS·인증서 도메인을 확인했다.
- Serve에는 HTTPS 443과 루트의 로컬 앱 proxy 한 개만 설정되어 있고 AllowFunnel은 없다. 앱은 `127.0.0.1:4310`만 수신한다.
- 기존 tailnet grants/ACL을 보존했다. 유효 정책에는 Tailscale IPv6 전체 범위가 포함되어 있어 특정 기기 전용으로 축소했다고 볼 수 없다. 앱의 별도 암호 인증을 유지한다.
- LaunchAgent는 private 환경 파일을 읽어 실행 중이며 기존 DeepSeek 연결·완료 작업 기록이 유지됐다.

적용한 Serve 설정은 다음과 같다. 이미 적용되어 있으므로 다시 실행할 필요는 없다. 변경할 때는 기존 서비스를 확인하고 443의 다른 서비스를 덮어쓰지 않는다.

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 http://127.0.0.1:4310
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
```

맥미니에서 실제 TLS 인증서 검증을 켠 HTTPS 검증을 통과했다. 첫 Node 연결은 한 차례 timeout이 났지만 직후 curl에서 HTTP 200·TLS 검증 성공을 확인했고 동일 Node 검증 전체를 다시 실행해 통과했다. 인증서 검증을 끄는 우회는 사용하지 않았다.

- HTTPS 첫 화면 200 및 HSTS
- 미인증 상태 조회 401, 로그인 200
- `__Host-workspace`·Secure·HttpOnly·SameSite=Strict 쿠키
- `/api/system`의 Tailscale 접속 분류, 기존 완료 작업과 DeepSeek 모델 목록
- 잘못된 Origin 403, 로그아웃 후 이전 쿠키 401
- 실제 브라우저 HTTPS 로그인 후 기존 완료 작업·대화·README diff·`smoke.txt` 목록, 화면의 “맥미니·원격 연결” 표시

검증 결과는 적용 기록의 `verification.json`에 있다. 맥미니에서 확인한 결과이며 물리 맥북·모바일의 네트워크 전환·접속을 검증한 것은 아니다. 인증서 발급에 따라 장치 DNS 이름은 공개 인증서 투명성 로그에 기록될 수 있다.

Serve는 사설 tailnet 접속용이다. **Funnel을 켜지 않는다.** 앱은 여전히 loopback만 수신하며 OpenCode 포트를 Serve에 연결하지 않는다. Tailscale 신원 헤더는 앱 암호 인증의 대체 수단이 아니다. 앱의 HTTPS Host·Origin 검증은 로컬 프록시 뒤에서 이루어지며 모든 로컬 프로세스를 상대로 한 OS 격리는 제공하지 않는다.

LaunchAgent는 사용자 로그인 이후 실행한다. 재부팅 후 사용자 로그인 이전 실행, 잠자기 방지, 전원 복귀 설정, OS 업데이트, 디스크 암호 해제는 자동화하지 않는다. KeepAlive는 실패 종료 후 재시도하며 의도적인 정상 종료는 다시 시작하지 않는다.

## 실제 기기 완료 기준

맥미니에서 실제 HTTPS와 LaunchAgent 서비스 재시작을 확인했다. 물리 기기 항목은 아직 미검증이며, 맥미니 내부에서 수행한 결과로 체크하지 않는다.

- [x] 맥미니에서 실제 TLS·HTTPS 로그인·출처·로그아웃·기존 완료 작업 조회
- [ ] 맥북·모바일이 같은 tailnet에서 HTTPS로 접속하고 각자 앱에 로그인
- [ ] 동일 task ID·대화·진행·변경을 조회
- [ ] 맥북에서 실제 DeepSeek 작업 시작 → 브라우저 종료 후 서버 실행 유지
- [ ] 모바일에서 추가 지시와 명령 승인 → 맥북 재접속으로 동일 결과 확인
- [ ] 실제 두 작업 병행 시 파일·승인·명령 실행 분리
- [x] LaunchAgent 설치·bootstrap 및 정상 종료 후 재시작, 앱 재로그인·기록 보존 확인
- [ ] 실제 macOS 로그아웃·재로그인 및 재부팅 후 자동 시작 확인
- [ ] 잠자기·네트워크 전환·공급자 장애 후 복구 한계 기록

## 되돌리기와 데이터 보존

이 앱의 서비스와 자동 실행을 현재 로그인 세션에서 해제하려면 다음 명령을 사용한다. 작업을 먼저 정리하고 정상 종료를 확인한다. plist가 LaunchAgents 폴더에 남아 있으면 다음 로그인 때 다시 등록되므로, 영구 해제는 해당 plist를 적용 기록 폴더로 옮겨 보존하는 별도 변경이다.

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.personal-ai.workspace.plist"
```

같은 plist로 다시 서비스를 등록하려면 기존 foreground 서버가 종료된 것을 확인한 뒤 실행한다.

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.personal-ai.workspace.plist"
```

현재 HTTPS Serve를 되돌릴 때는 443이 계속 이 앱 전용인지 확인한 경우에만 `tailscale serve --https=443 off`를 사용한다. `serve reset`으로 다른 서비스까지 지우지 않는다. 변경 전 상태는 적용 기록의 `before.json`과 비교한다. Tailscale 연결 자체를 끄면 다른 tailnet 기능에도 영향이 있으므로 앱 서비스를 끄는 작업과 구분한다. 작업 저장소·상태·인증 파일·검증 fixture는 삭제하지 않는다.

백업·복원 기능은 아직 없다. 수동 백업도 앱과 엔진을 멈춰 일관된 상태에서 실행 저장소(작업 브랜치와 미커밋 변경 포함), 상태·worktree, OpenCode 세션 DB 및 필요한 설정을 함께 보존해야 한다. 인증 파일은 암호화된 별도 백업을 사용한다. worktree가 Git 공용 저장소의 절대 경로를 참조하므로 다른 위치·호스트로 파일만 복사한 복원을 성공으로 간주하지 않는다. 실제 복구 리허설은 후속 작업이다.

## 참고한 공식 문서

Tailscale Serve·HTTPS는 2026-10-31 재확인, 나머지 자료는 2026-10-29 확인: [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve), [Serve 설정](https://tailscale.com/docs/features/tailscale-serve), [HTTPS 인증서](https://tailscale.com/kb/1153/enabling-https), [프록시 Host 전달 구현](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go), [OpenCode 설정](https://docs.opencode.ai/docs/config/), [공급자 인증](https://docs.opencode.ai/docs/providers/).
