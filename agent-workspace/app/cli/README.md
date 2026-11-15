# paw

Personal AI Workspace의 로컬 실행 환경 점검과 macOS 실행 설정 생성을 위한 CLI입니다. Node.js 22.19 이상이 필요합니다.

## 설치

저장소의 `agent-workspace/app`에서 실행합니다.

```sh
npm ci
npm run build:cli
npm pack --workspace @personal-ai/workspace-cli
npm install -g ./personal-ai-workspace-cli-0.1.0.tgz
paw --help
```

npm 레지스트리에 게시된 패키지가 아닙니다. 생성한 tarball로 설치합니다.

## 명령어

```sh
paw doctor --app-dir /absolute/path/to/agent-workspace/app
paw doctor --json --require-ollama
paw init --app-dir /absolute/path/to/agent-workspace/app \
  --output /absolute/path/to/new-review-directory --dry-run --json
```

`doctor`는 Node·Git·OpenCode, 설정 파일 존재 여부, 로컬 저장 경로, Tailscale Serve/Funnel, Ollama 준비 상태와 설치된 로컬 모델 수를 검사합니다. 클라우드 모델과 원격 모델 태그는 로컬 모델 수에서 제외합니다. Ollama CLI와 서버 버전이 다르면 재시작 안내를 표시합니다. 모델 다운로드·추론은 실행하지 않으며 설정·인증 파일 내용과 도구의 원본 오류 출력은 읽거나 표시하지 않습니다.

`--app-dir`를 생략하면 현재 디렉터리에 `src/main.js`가 있을 때만 앱 경로로 사용합니다. 프로젝트에 설치된 OpenCode도 이 경로를 기준으로 찾습니다. 환경 설정은 현재 프로세스에서 읽으며 `.env`를 자동 로드하지 않습니다.

`init --dry-run`은 작성할 파일 내용을 출력하며 파일·디렉터리를 만들지 않습니다. `--dry-run`을 빼면 새 출력 디렉터리(권한 `700`)에 다음 파일만 작성합니다(각 `600`). 이미 있는 출력 디렉터리는 사용하지 않습니다.

- `local.personal-ai.workspace.plist`: LaunchAgent 설정
- `remote-plan.txt`: 실행·적용·확인·해제 명령
- `server.env.example`: 비밀 값이 없는 환경 설정 예제

추가 옵션: `--data-dir`, `--env-file`, `--origin`, `--opencode`. 경로는 절대 경로를 사용합니다. 원격 origin은 정확한 Tailscale HTTPS origin만 허용합니다. `--env-file`은 생성할 설정에서 참조하는 경로이며 기존 파일을 읽거나 덮어쓰지 않습니다. LaunchAgent 등록, 서비스 재시작, Tailscale 설정 변경은 자동 실행하지 않습니다.

| 종료 코드 | 의미 |
|---|---|
| `0` | 성공. 진단 경고가 있을 수 있음 |
| `1` | 필수 진단 실패 |
| `2` | 잘못된 명령·옵션 또는 설정 파일 생성 실패 |

`doctor --json`은 `{ version: 1, ok, checks }`를 출력합니다. 각 검사는 `code`, `status`(`pass`/`warn`/`fail`), `message`, 선택적 `action`을 제공합니다. `--require-ollama`를 사용하면 Ollama 연결 실패·설치된 로컬 모델 없음도 필수 진단 실패로 처리합니다.

## 라이브러리

같은 패키지에서 `runDoctor`, `planPreparation`, `prepare`와 TypeScript 타입을 가져올 수 있습니다.

```ts
import { runDoctor, planPreparation } from '@personal-ai/workspace-cli';

const report = await runDoctor({ appDirectory: '/absolute/path/to/app' });
const preview = planPreparation({
  appDirectory: '/absolute/path/to/app',
  output: '/absolute/path/to/new-review-directory',
});
```

`planPreparation`은 쓰기 없이 `{ version, outputDirectory, files }`를 반환합니다. `prepare`는 같은 옵션으로 파일을 작성합니다.
