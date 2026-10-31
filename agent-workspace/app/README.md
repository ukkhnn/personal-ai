# Personal AI Workspace 실행

자체 서버·화면에서 프로젝트와 작업을 관리하고 기존 OpenCode 설정을 재사용한다. 첫 제품 버전의 일부를 구현한 상태이며, [로드맵](../ROADMAP.md)의 전체 완료 기준은 아직 충족하지 않았다. 맥미니의 실제 확인 결과와 재개 절차는 [HANDOFF.md](HANDOFF.md), 운영 설정은 [OPERATIONS.md](OPERATIONS.md)를 따른다.

## 시작

실행 저장소·상태·worktree는 iCloud 밖에 둔다. 맥미니 전용 저장소는 `~/Developer/personal-ai`다. 공유 폴더의 Git 작업 폴더를 함께 변경하지 않는다. 2026-10-31 확인한 중앙 앱은 `http://127.0.0.1:4310`에서 실행 중이므로 기존 서버에 접속한다. 아래 시작 명령은 서버가 실행 중이지 않을 때만 사용한다.

```sh
cd ~/Developer/personal-ai/agent-workspace/app
npm run doctor
npm start
```

Node.js 22.19 이상이 필요하다. 맥미니 확인 버전은 Node 26.7.0 / OpenCode 1.18.18이다. 엔진은 `OPENCODE_BIN` → PATH → `~/.opencode/bin/opencode` → `~/.local/bin/opencode` → 프로젝트 내부 고정 버전 순으로 찾는다. 기존 설치가 없을 때만 다음 명령으로 **프로젝트 내부** 엔진을 설치한다. 전역 설치나 기존 공급자 설정 변경은 수행하지 않는다.

```sh
npm run setup:runtime
```

고정 버전·무결성은 `tools/opencode/package-lock.json`에 보존한다. npm 설치 스크립트를 끄고 설치하며 플랫폼별 native 실행 파일을 직접 사용한다. 앱 자체는 외부 npm 라이브러리 없이 실행된다. 이 개발 환경 준비 명령과 제품 내부 에이전트의 의존성 자동 설치 정책은 별개다. **제품은 여전히 모든 셸 명령에 승인을 요구한다.**

`http://127.0.0.1:4310`에 접속해 `~/.local/share/personal-ai/access-code.txt`의 암호로 로그인한다. 암호·API 키·인증 파일을 Git이나 대화에 붙여 넣지 않는다. 앱 전용 OpenCode 서버는 임의의 loopback 포트와 임시 암호를 사용한다.

1. 맥미니에 있는 커밋된 Git 저장소의 최상위 폴더를 프로젝트로 연결한다.
2. 이 서버에서 실제 연결된 공급자의 모델·작업 지침·메모리를 템플릿으로 저장한다.
3. 프로젝트·템플릿으로 작업을 생성하면 HEAD 기준의 독립 브랜치·worktree가 만들어진다.
4. 일반 메시지는 추가 지시 대기열로 전달한다. 별도 중단 버튼으로만 중단한다.
5. 명령 실행을 한 번 승인하거나 거절한다. 질문 응답과 중단 후 이어가기를 지원한다.
6. 변경 사항에서 파일 상태와 추적 파일 diff를 확인한다.

## 인증과 원격 접속

앱은 계속 `127.0.0.1`에만 바인딩한다. Tailscale Serve가 HTTPS를 종료하고 로컬 앱으로 전달한다. `WORKSPACE_PUBLIC_ORIGIN`에 정확한 `https://장치.테일넷.ts.net` 주소를 지정한다. 임의 Host·Origin·전달 헤더로 허용 주소를 늘릴 수 없고 Funnel 요청을 거부한다. Tailscale 연결만으로 앱 로그인이 생략되지는 않는다.

원격 쿠키는 `__Host-workspace`, Secure, HttpOnly, SameSite=Strict이며 12시간 유효하다. 로컬/원격 출처와 localhost/127.0.0.1 세션은 서로 분리한다. 서버 재시작 후 각 기기에서 다시 로그인한다. 자동화 API 호출은 로그인·로그아웃을 포함한 모든 POST에 실제 접속 주소와 일치하는 `Origin` 헤더가 필요하다.

운영 설정을 생성하는 명령은 파일만 준비하고 시스템 설정을 적용하지 않는다.

```sh
npm run prepare:macos -- --output "$HOME/.local/share/personal-ai/operations/review-new" --origin https://your-device.your-tailnet.ts.net
```

실제 Tailscale 연결·HTTPS Serve 활성화·LaunchAgent 등록은 사용자 승인 후 [운영 안내](OPERATIONS.md)에 따라 적용한다. 인증·환경 파일은 저장소 밖 `~/.local/share/personal-ai/server.env`를 사용할 수 있다.

## 구현 경계

| 위치 | 책임 |
|---|---|
| `src/server.js`, `src/http-security.js` | 자체 HTTP API, 로그인, HTTPS·Origin 경계 |
| `src/workspace.js` | 프로젝트·템플릿·작업, 대기열, 중단·승인 상태 |
| `src/opencode.js`, `src/runtime-config.js` | 실행 엔진 어댑터, 기존/로컬 엔진 탐색 |
| `src/git.js`, `src/paths.js` | 저장소·Git 공용 경로 검증, worktree·변경 조회 |
| `src/store.js` | 버전 1 JSON 저장, 원자적 교체, 손상 시 덮어쓰기 거부 |
| `scripts/doctor.js`, `scripts/prepare-macos.js` | 비밀정보 없는 진단, 운영 설정안 생성 |
| `public/` | 기존 디자인을 유지한 반응형 화면 |

자체 작업 ID와 OpenCode 세션 ID를 분리한다. 템플릿은 작업 생성 시 복사하며 이후 변경이 기존 작업에 소급 적용되지 않는다. 상태 폴더 잠금으로 중복 서버 시작을 차단한다. 상태는 단일 프로세스 전용이며 엔진별 이벤트 정규화와 설정 이전은 추가 설계가 필요하다.

## 검증과 현재 한계

```sh
npm run check
npm test
```

2026-10-29 맥미니에서 27개 테스트가 통과했다. 실제 HTTP·인증·Git·디스크를 사용하는 테스트에는 모의 엔진을 사용한다. 두 클라이언트의 같은 작업 조회, 대기열·승인 소유권·질문·중복 방지, 작업 병행 격리, 재접속·서버 재시작, HTTPS·쿠키·출처 경계, 공유 저장소 차단과 운영 설정 생성을 확인한다. 브라우저에서도 모의 엔진의 전체 흐름과 390px 모바일 화면을 확인했다. **이 결과는 실제 DeepSeek·Tailscale·물리 기기 검증을 대신하지 않는다.**

2026-10-31에는 중앙 앱 4310과 OpenCode 1.18.18에서 실제 `deepseek` / `deepseek-flash`(DeepSeek V4.1 Flash 1017) 검증을 통과했다. 사용자가 OpenCode 인증에 직접 입력한 뒤 앱을 재시작해 공급자 목록을 갱신했으며 인증 값은 출력·저장소 기록하지 않았다. 작업 1개·지시 2개로 `smoke.txt`의 정확한 `hello-workspace\n` 생성, 추적 README 수정, `git diff --stat` 명령 1회 승인, 후속 읽기 답변을 확인했다. 로컬 인증 HTTP 클라이언트 2개 사이의 동일 requestID 중복 방지와 세 번째 새 로그인에서 같은 완료 작업 조회도 통과했다. 실제 브라우저 재로그인 후 완료 작업의 README diff와 `smoke.txt` 목록도 확인했다. **물리 기기의 HTTPS 접속과 실제 두 작업 병행은 아직 검증하지 않았다.**

실제 검증의 프로젝트·템플릿·작업·결과는 중앙 앱에 남아 있다. [HANDOFF.md](HANDOFF.md)에 task ID와 결과 기록 경로를 적었다. 등록된 검증 원본 저장소와 worktree는 계속 보존한다. 원본 저장소를 삭제하면 앱 시작 시 경로 재검증이 실패한다.

실제 smoke를 다시 실행할 때는 명시적으로 선택한 연결 모델을 사용한다. 2개 짧은 모델 턴을 사용하며, 병행 옵션은 1턴을 추가한다. 추가 호출 비용이 발생할 수 있다.

```sh
LIVE_MODEL_TEST=1 LIVE_PROVIDER_ID=deepseek LIVE_MODEL_ID=deepseek-flash node scripts/smoke-live.js
# 연결된 실제 모델 ID를 사용한다. 필요할 때만 LIVE_PARALLEL_TEST=1 추가.
```

- 맥북의 2026-10-28 검증에 이어 맥미니 중앙 앱의 실제 DeepSeek 단일 작업을 2026-10-31 확인했다. Tailscale·LaunchAgent 적용, 물리 기기 전환·실제 작업 병행은 남아 있다.
- 모델·프롬프트·직접 입력 메모리를 지원한다. 스킬·도구·권한 편집, 템플릿 수정·삭제는 남아 있다.
- 모든 셸 명령은 승인 대상이다. worktree는 OS 보안 격리가 아니다. 프로젝트 의존성 자동 설치의 판별·집행을 구현하기 전까지 승인 범위를 완화하지 않는다.
- 제품 내부 자동 커밋·push·최종 병합, 작업 정리, 백업·복원은 구현 전이다. 이번 개발 브랜치를 커밋·push하는 것과 제품 기능 구현은 다르다.
- 새 파일은 목록만 제공한다. 전체 파일 탐색·새 파일 내용·미디어 결과물 조회는 남아 있다.
- 재시작 시 저장 기록과 대기열을 복원한다. 전달이 모호한 지시는 자동 재전송하지 않는다. 엔진 세션의 무손실 복구·기기 간 이전을 보장하지 않는다.
- LaunchAgent 생성은 구현했지만 실제 등록·재부팅 검증은 별도 승인·확인이 필요하다. macOS 로그인 전 실행, 잠자기 방지, FileVault 해제는 포함하지 않는다.

## UI 참고

[Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)과 [Cursor Agent](https://cursor.com/docs/agent/overview)를 참고한 기존 구조·스타일을 유지한다. 모델 출력은 HTML로 실행하지 않고 텍스트로 표시한다. 이번 변경은 서버 접속 방식·모델 인증 안내에 집중했다.
