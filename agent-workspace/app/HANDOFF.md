# Mac mini 작업 인계

일상 접속·진단·재시작·장애 대응 순서는 [현재 운영 런북](../RUNBOOK.md)을 따른다.

갱신: 2026-10-31. 개발은 **iCloud 밖 `~/Developer/personal-ai`의 `codex/mac-mini-central`**에서 이어간다. 공유 원본은 확인 당시 `feat/opencode-workspace` / `a73d817`이며 미커밋 파일이 없었다. 원격 브랜치도 같은 커밋이었다. 공유 원본의 브랜치·파일·Git 설정을 이 작업에서 변경하지 않았다.

## 완료한 작업

- 공유 원본을 하드링크 없는 독립 저장소로 복제하고 별도 작업 브랜치 사용
- iCloud·CloudStorage·심볼릭 링크 대상·Git 공용 저장소의 실행 경로 차단
- Node 26.7.0 / Git 2.54.0 확인. 기존 OpenCode가 없어 프로젝트 내부 1.18.18 설치; 전역 설치 없음
- 실제 앱 수동 실행, OpenCode health·모델 목록, 앱 로그인·전용 저장소 등록 확인
- Tailscale HTTPS의 정확한 Host·Origin, Secure/HttpOnly 쿠키, 출처별 로그인 세션, Funnel 거부 구현
- 비밀정보 없는 doctor와 검토용 LaunchAgent·HTTPS 운영 계획 생성
- 자동 테스트 27개 및 JavaScript 전체 구문 검사 통과. 중복 서버 시작 거부 확인
- 별도 임시 모의 엔진으로 브라우저 로그인 → 프로젝트 → 템플릿 → 작업 → 승인 → 추적 파일 diff 확인. 390×844 모바일 크기에서 가로 넘침 없음
- 실제 모델 smoke의 명시적 공급자 선택, 두 인증 클라이언트, 선택적 병행 작업, timeout·결과 기록 보완
- 2026-10-31 중앙 앱의 실제 DeepSeek 작업 1개·지시 2개 완료, 명령 승인·파일 변경·중복 방지·새 로그인 재접속 확인
- 사용자 승인 후 Tailscale 연결·MagicDNS 상태 확인, LaunchAgent 설치·bootstrap으로 중앙 앱 전환
- 서비스 정상 종료·재시작 후 DeepSeek 연결·완료 작업 보존 확인, 이전 로그인 만료(401)·새 로그인 통과
- Tailscale HTTPS Serve 적용 후 실제 TLS·로그인·보안 쿠키·출처 거부·로그아웃·동일 완료 작업 조회 확인; Funnel 비활성 유지

## 중앙 앱 실제 DeepSeek 검증 — 2026-10-31

사용자가 OpenCode `auth login`에 직접 인증 정보를 입력한 뒤 앱을 재시작해 공급자 목록을 갱신했다. 인증 값은 출력하거나 저장소에 기록하지 않았다. 중앙 앱 `http://127.0.0.1:4310`과 OpenCode 1.18.18에서 `deepseek` / `deepseek-flash`(목록 표시 이름: DeepSeek V4.1 Flash 1017)를 사용했다. 맥북의 과거 결과와 별개로 맥미니에서 실제 호출을 검증했다.

- 작업 1개에서 첫 지시 1개와 후속 지시 1개를 순서대로 완료했다. `smoke.txt`에 정확한 `hello-workspace\n`을 생성하고 추적 중인 README를 수정했다.
- 두 번째 로컬 인증 HTTP 클라이언트에서 정확한 `git diff --stat` 명령을 1회 승인했다. 후속 읽기 지시의 답변과 실제 파일 내용·추적 파일 diff를 확인했다.
- 독립 인증 클라이언트 2개로 같은 requestID의 중복 전달 방지를 확인했다. 세 번째 클라이언트의 새 로그인에서도 같은 완료 작업을 조회했다.
- 실제 브라우저에서도 다시 로그인해 완료 작업과 변경 사항을 열고 README diff·`smoke.txt` 목록을 확인했다.
- 등록한 원본 검증 저장소는 변경되지 않았다. 중앙 앱에 프로젝트·검증 템플릿·작업·결과를 보존했다.

작업 제목은 `DeepSeek 실제 연결 검증 · 2026-10-31`, task ID는 `d0ac5c28-5801-4596-bb96-111bbfe832ec`다. 결과 기록은 `/Users/ukkhnn/.local/share/personal-ai/verification/deepseek-2026-10-31-Ahhp8c/report.json`에 있다. 같은 폴더의 `fixture`는 중앙 앱에 등록된 원본 저장소다. **이 fixture와 작업 worktree를 임시 파일처럼 삭제하지 않는다.** 등록된 저장소가 사라지면 앱 재시작 시 경로 재검증이 실패한다. 정리 기능이 구현되기 전까지 상태와 함께 유지한다.

## 운영 적용 상태 — 2026-10-31

사용자가 Tailscale 연결·HTTPS·로그인 후 자동 시작을 승인했다. 관리자 로그인 후 HTTPS를 활성화하고, 기본 체크된 Funnel 선택은 명시적으로 해제했다. Tailscale은 Running·online이며 MagicDNS·인증서 도메인을 확인했다. 접속 주소는 `https://ukkhnns-macmini.tail2e5038.ts.net`이고, Serve의 HTTPS 443 루트는 `http://127.0.0.1:4310` 한 곳으로 연결한다. Funnel은 활성화하지 않았다. 앱은 계속 `127.0.0.1:4310`만 수신한다. 기존 tailnet 접근 정책을 보존했으며 특정 기기 전용으로 좁힌 것은 아니다. 별도 앱 로그인을 유지한다.

`~/Library/LaunchAgents/local.personal-ai.workspace.plist`를 설치하고 bootstrap해 중앙 앱을 실행했다. 고정된 실행 경로와 안정적인 PATH, 저장소 밖 `~/.local/share/personal-ai/server.env`를 사용한다. 환경 파일에는 경로·Origin 설정만 있고 API 키는 넣지 않았다. 적용 plist·변경 전 상태·검증 기록은 `~/.local/share/personal-ai/operations/2026-10-31-activation/`의 plist, `before.json`, `verification.json`에 보존했다. 10월 29일 준비안은 이전 기록으로 남긴다.

맥미니에서 실제 TLS 인증서 검증을 켜고 HTTPS 첫 화면 200·HSTS, 미인증 401, 로그인과 Secure/HttpOnly/SameSite=Strict `__Host-workspace` 쿠키, Tailscale 접속 분류, 기존 완료 작업·DeepSeek 목록을 확인했다. 잘못된 Origin은 403, 로그아웃한 쿠키는 401로 거부했다. 실제 브라우저에서도 HTTPS 로그인 후 기존 완료 작업·대화 기록·README diff·`smoke.txt` 목록과 화면의 “맥미니·원격 연결” 표시를 확인했다. 이 검증도 같은 맥미니에서 수행했으며 별도 물리 원격 기기 검증은 아니다.

SIGTERM 정상 종료 후 `launchctl kickstart`로 다시 실행해 OpenCode health, DeepSeek 연결과 기존 완료 작업 보존을 확인했다. 이전 앱 로그인은 401로 만료됐고 새 로그인에서 기록을 확인했다. 실제 macOS 로그아웃·재로그인 또는 재부팅 시험은 하지 않았다.

## 아직 완료하지 못한 확인

실제 모델 작업은 맥미니의 로컬 HTTP 클라이언트로, 실제 HTTPS는 같은 맥미니에서 확인했다. 물리 맥북·모바일 접속, 실제 두 작업 병행, macOS 로그인 후 시작·재부팅·잠자기 검증은 남아 있다.

## 다음 실행

현재 중앙 앱은 LaunchAgent가 관리한다. Tailscale에 연결한 기기에서 `https://ukkhnns-macmini.tail2e5038.ts.net`에 접속해 별도로 앱에 로그인한다. 맥미니의 로컬 확인에는 `http://127.0.0.1:4310`을 사용할 수 있으며 **`npm start`로 두 번째 서버를 실행하지 않는다.** 로그인 암호는 `~/.local/share/personal-ai/access-code.txt`에서 로컬로 확인한다. 앱에는 전용 personal-ai 프로젝트와 실제 검증 프로젝트·템플릿·완료 작업이 보존되어 있다.

```sh
launchctl print "gui/$(id -u)/local.personal-ai.workspace"
```

서비스가 등록된 채 정상 종료되어 멈춘 경우에는 다음 명령으로 다시 시작한다. 실행 중인 서비스를 안전하게 재시작하는 절차와 완전히 해제하는 방법은 [OPERATIONS.md](OPERATIONS.md)를 따른다.

```sh
launchctl kickstart "gui/$(id -u)/local.personal-ai.workspace"
```

1. 중앙 앱의 공급자 목록과 보존한 실제 검증 작업을 확인한다. 인증 정보를 다시 입력하거나 검증 자료를 삭제할 필요는 없다.
2. 맥북·모바일을 같은 tailnet에 연결하고 HTTPS에서 같은 작업을 조회·추가 지시·승인·재접속하는 실제 기기 검증을 수행한다.
3. 실제 두 작업 병행 및 macOS 로그아웃·재로그인·재부팅·잠자기 복구를 별도로 검증한다. 모델 검증 반복에는 추가 호출 비용이 발생할 수 있다.

## 이어지는 제품 개발

스킬·도구·권한·템플릿 관리, 프로젝트 의존성 설치의 안전한 승인 경계, 제품 내부 자동 커밋·push 및 커밋과 결부된 최종 병합 승인, 파일·결과물 전체 조회, 백업·복원·작업 정리는 남아 있다. 현재 제품의 모든 셸 명령 승인 정책은 유지했다.

이번 개발의 작업 브랜치 커밋·push는 사용자가 직접 승인한 저장소 작업이다. 제품이 자동으로 커밋·push하도록 구현되었다는 뜻이 아니다. 최종 병합은 하지 않는다.

GitHub는 코드 전달 수단이다. 맥북의 실행 중 작업·세션·절대 경로·OpenCode DB가 자동 이전되지 않는다. 앞으로 맥미니의 동일한 중앙 서버를 클라이언트 기기들이 조회하도록 연결한다. 전체 첫 제품 버전의 완료 기준은 아직 미충족이다.
