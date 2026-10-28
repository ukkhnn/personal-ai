# Personal AI

최종 목표는 사용자의 상황과 작업 문맥을 이해하고 필요한 일을 수행하는 **개인 AI 비서**를 구축하는 것이다.

## 프로젝트 위계

```text
personal-ai/
├── README.md
└── agent-workspace/
    ├── README.md
    ├── PRD.md
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
