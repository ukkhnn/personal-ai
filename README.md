# Personal AI

Mac mini에서 개발 작업을 실행하고 웹에서 지시·승인·결과를 확인하는 워크스페이스다. OpenCode 개발 작업과 Ollama 텍스트 실험을 제공한다.

## 기능

- 작업마다 Git 브랜치·worktree를 생성하고 모델·지침·메모리 템플릿을 적용한다.
- 추가 지시를 대기열에 저장한다. 같은 요청 ID의 중복 전송을 차단하고 전달 결과가 불명확하면 자동 재전송하지 않는다.
- 명령 실행 승인·거절, 질문 응답, 중단·이어가기와 변경 파일 diff를 제공한다.
- Tailscale HTTPS와 별도 앱 로그인으로 같은 작업 기록에 접근한다.
- Ollama 실험의 입력·모델 정보·응답·실패·평가를 저장하고 JSON으로 내보낸다. 이 실험에서는 도구나 셸을 실행하지 않는다.
- `paw` CLI로 실행 환경을 진단하고 macOS 운영 설정 파일을 미리 확인·생성한다.

## 사용

[앱 실행·검사](agent-workspace/app/README.md) · [CLI 명령어](agent-workspace/app/cli/README.md) · [운영 런북](agent-workspace/RUNBOOK.md)

서버는 Node.js 22.19 이상에서 실행한다. 실행 폴더·상태 데이터·worktree는 iCloud 등 동기화 폴더 밖에 둔다. 기존 운영 서버가 실행 중이면 중복으로 시작하지 않는다.

## 구성

| 경로 | 내용 |
|---|---|
| `agent-workspace/app/src/` | HTTP API, 개발 작업·승인 처리, 상태 저장 |
| `agent-workspace/app/src/core/` | TypeScript 입력 검증, 승인 상태, Ollama 어댑터·실험 기록 |
| `agent-workspace/app/public/` | 개발 작업·Ollama 실험 화면 |
| `agent-workspace/app/cli/` | 설치 가능한 CLI와 서버에서 공유하는 진단·설정 생성 코드 |
| `agent-workspace/app/test/` | HTTP·인증·Git·재시작·중복 방지 테스트 |
| `.github/workflows/workspace-ci.yml` | 타입 검사·린트·테스트·CLI 설치 검사 |

실제 DeepSeek 개발 작업과 운영 HTTPS의 Qwen 3B/7B/27B 실험을 확인했다. 세부 조건은 [M2](agent-workspace/app/M2-VALIDATION.md), [M3](agent-workspace/app/M3-VALIDATION.md) 기록에 있다. 물리 맥북의 접속 단절·기기 전환, OS 재부팅 복구, 실제 병행 작업은 추가 검증이 필요하다. 자동 커밋·push·병합과 백업·복원 기능은 구현 전이다.

기획·전체 미완료 범위는 [Agent Workspace](agent-workspace/README.md)와 [로드맵](agent-workspace/ROADMAP.md)을 참고한다.
