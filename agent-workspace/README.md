# Agent Workspace

개인 AI 비서의 기반 인프라를 구축하는 `personal-ai`의 하위 프로젝트다.

현재 단계: **Mac mini 실제 DeepSeek·HTTPS·서버 재시작 검증 완료 / 물리 기기·병행 작업·OS 재부팅 검증 대기**.

구현·검증 현황은 작업 브랜치 `codex/mac-mini-central`의 [`33b4146`](https://github.com/ukkhnn/personal-ai/commit/33b41462d115bacb30795b1babe71ff50d36a50d) 기준이다. `main`에는 공통 문서만 반영했으며, 앱 구현의 최종 병합은 별도 승인 후 진행한다.

목표는 사용자가 실제 개발에 지속적으로 사용할 수 있는 완성품이다. 첫 버전도 정한 범위 안에서 작업 완료·오류 처리·데이터 보존·복구가 이어져야 하며, 모든 주요 설계에서 확장 가능성을 검토한다.

## 범위

첫 버전은 개발 작업을 우선한다. 자체 화면에서 대화·진행 조회, 추가 지시, 명령 실행 승인, 변경 코드·결과 확인을 제공한다. 실행과 프로젝트 파일은 Mac mini에 두고, 같은 프로젝트의 병행 작업은 브랜치·worktree로 분리한다. 코드 변경은 Git/GitHub로 공유하고 실행 폴더는 iCloud 밖에 둔다.

아래는 단계적으로 구현할 전체 범위다.

- 기기 간 동일한 세션과 실행 환경에 접근하고 작업 이어가기
- 외부 API 및 Ollama 기반 멀티 LLM과 사용자 정의 Agent
- 월 구독형 기존 Agent 도구 연결 (첫 지원 도구와 방식은 미정)
- 첫 버전의 프롬프트·모델·스킬·도구·메모리·권한 설정 및 템플릿 재사용
- 후속 확장으로 사용자 정의 작업 순서 구성
- 예약 메시지, 반복 작업 및 루틴
- 파일·명령 실행, 권한 관리 및 실행 이력

## 문서와 작업 위치

| 경로 | 용도 |
|---|---|
| [PRD.md](PRD.md) | 첨부된 최초 기획서 v0.1 원문 |
| [REQUIREMENTS.md](REQUIREMENTS.md) | 이후 결정된 변경사항과 현재 적용 요구사항 v0.3 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 검증 후 구체화할 시스템 구조와 데이터 흐름 |
| [DECISIONS.md](DECISIONS.md) | 대안·선택 이유·제약을 포함한 기술 결정 기록 |
| [ROADMAP.md](ROADMAP.md) | 단계별 작업과 진행 상태 |
| [references/](references/README.md) | 오픈소스 조사 및 비교 자료 |
| [specs/](specs/README.md) | 기능별 상세 명세 |
| [experiments/](experiments/README.md) | PoC 코드, 검증 절차 및 결과 |

## 진행 원칙

최초 기획서는 원문으로 유지한다. 이후 확정한 변경사항은 현재 요구사항과 의사결정 기록에 반영하며, 충돌하는 항목은 현재 요구사항의 확정 내용을 우선 적용한다. 새로운 기능은 요구사항에 등록한 뒤 개발하고, 주요 기술 결정은 근거와 함께 기록한다. 후보 기술이나 오픈소스의 채택 여부는 아직 확정하지 않는다.

첫 단계는 개발 작업 흐름의 상세 설계와 OpenCode를 이용한 세션·승인·worktree·하네스 설정 검증이다. OpenCode 최종 채택은 검증 결과를 보고 결정한다. 현재 구현·실행·검증 범위는 [app/README.md](https://github.com/ukkhnn/personal-ai/blob/33b41462d115bacb30795b1babe71ff50d36a50d/agent-workspace/app/README.md), 맥미니 인계 절차는 [app/HANDOFF.md](https://github.com/ukkhnn/personal-ai/blob/33b41462d115bacb30795b1babe71ff50d36a50d/agent-workspace/app/HANDOFF.md)에 기록했다. 2026-10-29 맥미니의 독립 실행 저장소와 로컬 서버를 확인하고 자동 테스트 27개를 통과했다. 2026-10-31에는 맥미니 중앙 앱에서 OpenCode 1.18.18·`deepseek/deepseek-flash`로 파일 생성·추적 파일 수정·명령 승인·후속 지시·완료 작업 재조회를 확인했다. 사용자 승인 후 Tailscale Serve HTTPS와 LaunchAgent를 적용했다. 맥미니 자체 접속으로 실제 TLS·앱 인증을, 서버 프로세스 재시작으로 기존 로그인 만료와 완료 작업 보존을 확인했다. 물리 맥북·모바일 접속, 병행 작업, 실제 OS 로그아웃·재부팅·잠자기 검증은 남아 있다. [운영 안내](https://github.com/ukkhnn/personal-ai/blob/33b41462d115bacb30795b1babe71ff50d36a50d/agent-workspace/app/OPERATIONS.md)를 참고한다. 전체 첫 버전의 완료 기준은 아직 충족하지 않았다.
