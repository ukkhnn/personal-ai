# Personal AI Workspace

OpenCode 개발 작업과 Ollama 텍스트 실험을 관리하는 로컬 서버·웹 UI다. 로그인·작업 기록은 서버에서 관리하며, 클라이언트가 닫혀도 서버의 대기열 처리는 계속된다.

## 설치와 실행

Node.js **22.19 이상**과 Git이 필요하다. 소스의 TypeScript는 Node의 타입 제거 기능으로 실행하며, `npm run check`에서 별도로 타입을 검사한다. 런타임 npm 의존성은 없고 개발 검사·CLI 빌드 도구는 lockfile에 고정한다.

```sh
cd agent-workspace/app
npm ci --ignore-scripts
npm run check
npm test
npm run doctor
```

OpenCode는 `OPENCODE_BIN` → PATH → `~/.opencode/bin/opencode` → `~/.local/bin/opencode` → 프로젝트 고정 버전 순으로 탐색한다. 기존 설치가 없을 때만 `npm run setup:runtime`으로 프로젝트 내부 엔진을 설치한다. 공급자 설정과 인증은 기존 OpenCode 설정을 사용한다.

운영 서비스가 없는 환경에서 시작한다.

```sh
npm start
```

기본 주소는 `http://127.0.0.1:4310`이다. 기본 암호 파일은 `~/.local/share/personal-ai/access-code.txt`이며 `WORKSPACE_DATA_DIR`로 상태 폴더를 바꿀 수 있다. 암호·API 키를 Git에 저장하지 않는다. 실행 경로·상태·Git 메타데이터는 동기화 폴더 밖에 둔다.

기존 맥미니는 LaunchAgent로 실행 중이다. 중복 실행 대신 [런북](../RUNBOOK.md)의 점검·재시작 절차를 사용한다.

## 개발 작업

1. 커밋이 있는 로컬 Git 저장소를 프로젝트로 등록한다.
2. 연결된 공급자 모델·지침·메모리로 템플릿을 만든다.
3. 작업을 생성하면 저장소 HEAD에서 별도 브랜치·worktree를 만든다.
4. 추가 지시는 대기열에 넣는다. 같은 요청 ID의 재전송은 기존 항목을 돌려준다.
5. 셸 명령을 한 번 승인하거나 거절한다. 질문 응답, 중단·이어가기를 지원한다.
6. 변경 파일 목록과 추적 파일 diff를 확인한다.

명령 승인 기록은 `sending` → `applied` 또는 `uncertain`으로 전이한다. 기록을 저장한 뒤 엔진에 전달하며, 응답이 유실되거나 서버가 재시작해도 같은 결정을 다시 보내지 않는다. 작업 링크는 같은 작업 ID를 열고, 새로고침·재로그인 후 미확인 추가 지시의 요청 ID를 유지한다.

## Ollama 실험

`/experiments`에서 설치된 로컬 모델, 시스템 지침, 프롬프트, 생성 옵션을 선택한다. 실행은 명시적인 확인이 필요하며 한 번에 하나만 진행한다. `OLLAMA_URL`은 literal loopback HTTP 주소만 허용하고 기본값은 `http://127.0.0.1:11434`다.

- 입력·모델 digest·Ollama 버전·응답·생성 지표를 `experiments.json`에 저장한다.
- `running`, `completed`, `failed`, `interrupted`를 구분한다. 성공에는 응답이, 실패·중단에는 오류가 필요하다.
- JSON은 읽을 때 필드를 검증한다. 손상된 기록은 덮어쓰지 않고 시작을 중단한다.
- 평가를 누적하고 기존 설정을 재사용하거나 JSON을 내보낼 수 있다.
- 모델 다운로드·도구 실행·셸 실행은 제공하지 않는다. 중단·시간 초과는 Ollama 내부 계산 종료를 보장하지 않는다.

실제 모델별 조건·결과는 [Ollama 실험 안내](../experiments/ollama/README.md)에 있다.

## CLI

```sh
npm run build:cli
npm run test:cli
npm run test:package
```

`paw doctor`, `paw doctor --json`, `paw init --dry-run`의 설치 방법·옵션·종료 코드는 [CLI 사용법](cli/README.md)을 참고한다. `init`은 운영 설정 파일을 생성하며 서비스 설치·재시작·Tailscale 설정을 실행하지 않는다. 기존 `npm run doctor`, `npm run prepare:macos` 진입점도 유지한다.

## 원격 접속과 저장

서버는 `127.0.0.1`에 바인딩한다. Tailscale Serve로 HTTPS를 연결하고 `WORKSPACE_PUBLIC_ORIGIN`에 정확한 tailnet HTTPS origin을 지정한다. Tailscale 연결 후에도 별도 앱 로그인이 필요하다. Funnel 요청은 거부한다.

모든 변경 요청은 정확한 Origin이 필요하다. 원격 쿠키는 Secure·HttpOnly·SameSite=Strict이며 로컬 세션과 분리한다. 서버 재시작 후 다시 로그인한다. 단일 서버 프로세스가 상태를 관리하고 JSON 파일을 원자적으로 교체한다. 운영 설정은 [OPERATIONS.md](OPERATIONS.md)를 참고한다.

## 검사와 구현 범위

```sh
npm run check          # JS 문법 + strict TypeScript + ESLint
npm test               # HTTP·인증·Git·저장·복구·중복 방지
npm run test:cli       # CLI 진단·입력·설정 생성
npm run build:cli
npm run test:package   # tarball을 임시 경로에 설치한 뒤 실행
```

CI는 Linux의 최소 Node 버전과 macOS의 Node 24에서 위 검사를 실행한다. 자동 검사는 모의 엔진을 사용하므로 공급자 인증이나 모델 다운로드가 필요 없다. TypeScript 적용 범위는 `src/core/`와 `cli/src/`다. 기존 서버·브라우저 JavaScript 전체를 타입 검사하는 것은 아니다.

실제 DeepSeek 파일 생성·수정·승인과 Qwen 3B/7B/27B 실험을 확인했다. [M2](M2-VALIDATION.md)·[M3](M3-VALIDATION.md)에 검증 기록을 보존한다. 물리 맥북의 접속 단절·기기 전환, 실제 병행 작업, OS 재부팅 복구는 미검증이다. 자동 커밋·push·병합, 백업·복원, 전체 파일 탐색과 스킬·도구·권한 템플릿 편집은 구현 전이다.
