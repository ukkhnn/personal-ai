# Personal AI

최종 목표는 사용자의 상황과 작업 문맥을 이해하고 필요한 일을 수행하는 **개인 AI 비서**를 구축하는 것이다. 사용자가 일상적으로 계속 사용할 수 있는 완성품을 목표로 하며, 개발 단계는 그 목표에 도달하기 위한 구현 순서다. 모든 주요 설계에서 향후 기능 추가와 구성 요소 교체, 기존 데이터 보존을 고려한다.

## 프로젝트 위계

```text
personal-ai/
├── README.md
└── agent-workspace/
    ├── README.md
    ├── PRD.md
    ├── REQUIREMENTS.md
    ├── ARCHITECTURE.md
    ├── DECISIONS.md
    ├── ROADMAP.md
    ├── references/
    ├── specs/
    └── experiments/
```

## 현재 하위 프로젝트

[agent-workspace](agent-workspace/README.md)는 개인 AI 비서가 사용할 공통 실행 기반을 구축한다. 기기 간 세션 연속성, 멀티 LLM 및 사용자 정의 Agent, 하네스·메모리 템플릿, 예약 메시지·루틴이 주요 범위다.

첨부 기획서의 “독립적인 AI 비서를 완성하는 작업이 아니다”라는 범위 제한은 이 하위 프로젝트에 적용된다. 상위 프로젝트인 `personal-ai`의 최종 목표는 개인 AI 비서다.

현재는 워크스페이스 기반 구축부터 진행하며, 향후 AI 비서 구현을 위한 별도 디렉토리와 구조는 구체적인 설계가 정해지면 추가한다.

## 현재 확정 방향

자체 사용자 환경을 중심으로 기존 구독형 AI 도구도 연결한다. 첫 버전은 개발 작업을 우선하며 Mac mini에서 실행하고, 작업별 브랜치와 Git worktree로 병행 작업을 분리한다. 코드 변경은 Git/GitHub로 공유하고 대화·실행·승인 상태는 중앙 서비스에서 관리한다.

첫 버전부터 프롬프트·모델·스킬·도구·메모리·권한을 설정하는 하네스 템플릿을 제공한다. 작업 순서 구성은 후속 확장으로 남기고, 실행 엔진은 OpenCode부터 검증한다. 검증 순서의 확정은 최종 채택을 의미하지 않는다.

최초 기획서는 원문으로 보존한다. 이후 확정한 변경사항과 현재 적용 범위는 [현재 요구사항](agent-workspace/REQUIREMENTS.md), 선택 근거는 [의사결정 기록](agent-workspace/DECISIONS.md)을 참고한다.
