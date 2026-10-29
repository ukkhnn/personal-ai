# Mac mini 중앙 운영

작성·확인: 2026-10-29. 설정 생성·검증과 실제 시스템 활성화를 구분한다.

## 실제 위치와 현재 상태

| 항목 | 확인 결과 |
|---|---|
| 공유 원본 | `~/Library/Mobile Documents/com~apple~CloudDocs/sogang/1 AIAI/projects/personal-ai` |
| 전용 실행 저장소 | `~/Developer/personal-ai`, 독립 clone; 공유 원본과 Git 공용 디렉토리·객체 하드링크를 공유하지 않음 |
| 작업 브랜치 | `codex/mac-mini-central` (`a73d817`에서 시작) |
| 상태·worktree·로그 | `~/.local/share/personal-ai` |
| 접속 암호 | 위 폴더의 `access-code.txt`, 600 권한; 값은 기록하지 않음 |
| OpenCode | 기존 설치를 찾지 못해 프로젝트 내부 1.18.18 사용. 공급자 인증은 별개 |
| 공급자 | 엔진 기본 `opencode` 목록만 확인, 기존 DeepSeek 인증 미확인 |
| 수동 앱 주소 | `http://127.0.0.1:4310` |
| Tailscale 후보 주소 | `https://ukkhnns-macmini.tail2e5038.ts.net`; 캐시된 장치 이름이며 활성화 후 재확인 필요 |
| Tailscale | 설치됨(1.96.5), Stopped, Serve 설정 없음, Funnel 꺼짐 |
| 최종 설정안 | `~/.local/share/personal-ai/operations/2026-10-29-final/` |
| 자동 시작 | LaunchAgent 파일 검사 완료, 실제 등록하지 않음 |

실행 경로는 심볼릭 링크의 실제 대상과 Git 공용 저장소까지 검사한다. iCloud 및 `Library/CloudStorage` 아래 경로는 거부한다. 임의 동기화 도구의 모든 사용자 지정 경로를 자동 탐지하는 기능은 아니므로 운영자는 다른 동기화 폴더도 실행 위치에서 제외해야 한다.

## 수동 시작과 인증 연결

```sh
cd ~/Developer/personal-ai/agent-workspace/app
npm run doctor
npm start
```

접속 암호는 로컬 파일에서 확인하며 키·암호를 로그나 Git에 남기지 않는다. 기본 실행은 로컬 HTTP만 제공한다. 기존 공급자 설정이 이 맥미니에 없다면 맥북의 인증된 OpenCode 설정을 사용자가 안전한 경로로 준비하거나 맥미니의 OpenCode에서 직접 인증한다. 맥북의 실행 상태·DB·작업 폴더를 통째로 복사하는 것으로 대체하지 않는다.

별도 위치의 기존 설정은 `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` 등 해당 설정 방식에 맞춰 저장소 밖 private 환경 파일에 연결한다. 기존 `auth.json`이나 인라인 키를 앱 저장소에 복제하지 않는다. 연결 후 `/api/runtime`은 인증된 사용자에게 공급자·모델 이름만 반환한다. 템플릿 생성과 live smoke에는 그 목록의 실제 ID를 사용한다.

```sh
node --env-file-if-exists="$HOME/.local/share/personal-ai/server.env" src/main.js
```

기존 foreground 서버와 같은 데이터 폴더로 두 번째 서버를 실행하면 거부한다. 재시작 전 활성 작업을 확인하고 명시적으로 중단한다. 종료는 시작한 터미널의 Ctrl-C 또는 해당 앱 프로세스에 SIGTERM을 보내는 방법을 사용한다. 정상 종료는 상태를 저장하고 앱 전용 엔진을 닫는다. 임의의 다른 OpenCode 프로세스를 종료하지 않는다.

## HTTPS·자동 시작 설정 준비

`prepare:macos`는 다음 세 파일을 600 권한으로 생성하고 기존 파일을 덮어쓰지 않는다.

- `local.personal-ai.workspace.plist`: 사용자 로그인 후 실행할 LaunchAgent
- `server.env.example`: private 환경 파일에 넣을 선택 설정의 예시, 비밀 값 없음
- `remote-plan.txt`: 정확한 경로·주소를 포함한 수동 시작, 적용·검증·되돌리기 명령

기존 설정안은 보존하고 변경 시 새 output 폴더를 사용한다. plist는 source 저장소·node·OpenCode의 절대 경로를 고정한다. 이 경로가 바뀌면 다시 생성한다. plist의 PORT(4310)·데이터 폴더·선택한 원격 주소는 환경 파일보다 우선한다.

```sh
npm run prepare:macos -- --output "$HOME/.local/share/personal-ai/operations/new-review" --origin https://ukkhnns-macmini.tail2e5038.ts.net
plutil -lint "$HOME/.local/share/personal-ai/operations/new-review/local.personal-ai.workspace.plist"
```

## 사용자 승인 뒤 적용할 시스템 변경

현재 아래 변경은 **적용하지 않았다**. 사용자의 “전역 설치·시스템 변경은 승인” 정책에 따라 설정안을 만든 후 승인받는다. 전역 소프트웨어 설치는 필요하지 않다.

1. 기존 Tailscale 앱의 연결을 켠다. 계정 로그인이 요구되면 사용자가 로그인한다. `status --json`의 실제 Self.DNSName이 후보 주소와 같은지 확인한다. 다르면 그 주소로 설정안을 다시 생성한다.
2. 같은 tailnet의 맥북·모바일이 맥미니 TCP 443에 접근하도록 현재 grants/ACL을 확인한다. 기존 정책을 임의로 넓히지 않는다. MagicDNS·HTTPS 인증서 활성화가 요구되면 해당 계정 변경도 승인 범위에서 처리한다. 인증서 발급 시 장치의 DNS 이름은 공개 인증서 투명성 로그에 기록될 수 있다.
3. 기존 `serve status --json`을 확인한다. 443에 다른 서비스가 있으면 덮어쓰지 않는다. 선택한 origin으로 앱을 시작한 후 다음을 적용한다.

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 http://127.0.0.1:4310
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
```

4. 자동 시작까지 승인받은 경우 foreground 서버를 정상 종료하고 생성한 plist를 `~/Library/LaunchAgents/local.personal-ai.workspace.plist`에 등록한다. 정확한 `install`·`launchctl bootstrap` 명령은 검토한 `remote-plan.txt`에 있다. 기존 plist가 있으면 보존·비교한 뒤 처리한다.
5. `launchctl print`·로그·loopback API로 프로세스 상태를 확인한다. 두 기기에서 HTTPS로 각각 로그인하고 같은 작업 ID를 확인한다.

Serve는 사설 tailnet 접속용이다. **Funnel을 켜지 않는다.** 앱은 여전히 loopback만 수신하며 OpenCode 포트를 Serve에 연결하지 않는다. Tailscale 신원 헤더는 앱 암호 인증의 대체 수단이 아니다. 앱의 HTTPS Host·Origin 검증은 로컬 프록시 뒤에서 이루어지며 모든 로컬 프로세스를 상대로 한 OS 격리는 제공하지 않는다.

LaunchAgent는 사용자 로그인 이후 실행한다. 재부팅 후 사용자 로그인 이전 실행, 잠자기 방지, 전원 복귀 설정, OS 업데이트, 디스크 암호 해제는 자동화하지 않는다. KeepAlive는 실패 종료 후 재시도하며 의도적인 정상 종료는 다시 시작하지 않는다.

## 실제 기기 완료 기준

아래는 아직 미검증이다. localhost의 모의 클라이언트 결과로 체크하지 않는다.

- [ ] 맥북·모바일이 같은 tailnet에서 HTTPS로 접속하고 각자 앱에 로그인
- [ ] 동일 task ID·대화·진행·변경을 조회
- [ ] 맥북에서 실제 DeepSeek 작업 시작 → 브라우저 종료 후 서버 실행 유지
- [ ] 모바일에서 추가 지시와 명령 승인 → 맥북 재접속으로 동일 결과 확인
- [ ] 실제 두 작업 병행 시 파일·승인·명령 실행 분리
- [ ] 사용자 로그인 후 자동 시작, 재시작 후 재로그인·기록 복구 확인
- [ ] 잠자기·네트워크 전환·공급자 장애 후 복구 한계 기록

## 되돌리기와 데이터 보존

생성한 계획의 `launchctl bootout`으로 이 앱의 자동 실행만 중지한다. 443이 이 앱 전용이었던 경우에만 `tailscale serve --https=443 off`를 사용한다. `serve reset`으로 다른 서비스까지 지우지 않는다. 실제 적용 전 설정을 기록해 두고 기존 서비스가 있었다면 그 설정으로 되돌린다. 작업 저장소·상태·인증 파일은 삭제하지 않는다.

백업·복원 기능은 아직 없다. 수동 백업도 앱과 엔진을 멈춰 일관된 상태에서 실행 저장소(작업 브랜치와 미커밋 변경 포함), 상태·worktree, OpenCode 세션 DB 및 필요한 설정을 함께 보존해야 한다. 인증 파일은 암호화된 별도 백업을 사용한다. worktree가 Git 공용 저장소의 절대 경로를 참조하므로 다른 위치·호스트로 파일만 복사한 복원을 성공으로 간주하지 않는다. 실제 복구 리허설은 후속 작업이다.

## 참고한 공식 문서

2026-10-29 확인: [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve), [Serve 설정](https://tailscale.com/docs/features/tailscale-serve), [HTTPS 인증서](https://tailscale.com/kb/1153/enabling-https), [프록시 Host 전달 구현](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go), [OpenCode 설정](https://docs.opencode.ai/docs/config/), [공급자 인증](https://docs.opencode.ai/docs/providers/).
