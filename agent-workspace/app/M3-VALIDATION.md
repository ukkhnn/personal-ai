# M3 — Ollama 실험 연결 검증 완료

실제 작업·검증일: 2026-11-15. 기존 브랜치 `codex/mac-mini-central` 유지. 사용자가 물리 맥북 검증을 뒤로 미루고 M3 착수를 지시했다. M1 접속 단절과 M2 맥북 대조·남은 실기기 검증은 미완료로 남겨 M4에서 이어간다.

## 운영 확인 추가 — 2026-11-15 오후

운영 HTTPS의 `/api/system`에서 `access=tailscale`, `features.ollamaExperiments=true`를 확인했다. 사용자 터미널에서 생성된 M3 6개 커밋(`fc76278`~`62f46c7`)의 작성자·커미터 날짜가 11월 11·12일인 것도 확인했다. 사용자 수행 후 Ollama API 버전은 0.40.16이다.

같은 HTTPS에서 Qwen 3B/7B/27B 실행 → 로그아웃·재로그인 → 결과 조회 → 평가 추가 → 동일 요청 재전송(원래 결과 반환) → 재로그인 후 평가 복원을 통과했다. 인증 정보는 결과 파일에 저장하지 않았다. 프롬프트는 `M3_HTTPS_OK` 고정 응답 확인이며 코드 실행/개인 작업은 포함하지 않았다.

- 3B: `9d2e2578-4308-4ce2-b605-a3344bd058d6`, 2.120초, 정확 응답.
- 7B: `bed81567-a666-4b1d-b4e4-3a62aebf734a`, 3.030초, 정확 응답.
- 동일 조건: temperature=0, top_p=1, seed=42, num_ctx=4096, num_predict=1024, stream=false, keep_alive=0. 시간은 모델 확인·로딩을 포함한다.
- 근거: [3B 운영 기록](../experiments/ollama/results/2026-11-15-production/qwen3b.json), [7B 운영 기록](../experiments/ollama/results/2026-11-15-production/qwen7b.json).

27B의 첫 다운로드 로그는 11:38에 19%에서 멈췄고 해당 실행 세션도 종료된 것을 확인했다. 오후에 이어받기를 수행했고 프로세스 종료 코드 0, `writing manifest`/`success`, 설치 목록 등재를 확인했다. 이어서 운영 HTTPS 추론·평가·재로그인 복원·동일 요청 중복 방지도 통과했다.

- 27B: `73ad9796-6c12-422c-ab23-ee4335914a5c`, 26.140초, 정확한 `M3_HTTPS_OK` 응답, 종료 이유 stop. 위 3B/7B와 같은 입력·생성 설정이다.
- 설치본: `qwen3.5:27b`, 27.4B, safetensors / NVFP4 / MLX, 약 19GB. digest `2d2e4b8fc7c0479b70f8cba9fc8bdb49a3c9a43a8a6da3873b724c9fca4672ef`.
- 로딩 약 10.015초, 생성 201토큰/14.318초(약 14.0 token/s). thinking 708자가 별도 저장됐다. 3B/7B는 6토큰만 생성했으므로 전체 시간으로 품질이나 순수 성능 순위를 정하지 않는다.
- 추론 중 `ollama ps`: 100% GPU, context 4096, runner mlx. 완료 후 목록이 비어 keep_alive=0에 따른 모델 해제도 확인했다.
- 근거: [27B 운영 기록](../experiments/ollama/results/2026-11-15-production/qwen27b.json).

**M3의 연결·기록·평가 누적과 27B 추가 검증을 완료했다.** 품질 벤치마크와 로컬 모델의 개발 도구 실행은 별도 범위다. M1/M2의 물리 맥북·단절 검증은 계속 보류하고 M4에서 이어간다.

## 구현

- 서버: Ollama 어댑터, 별도 experiments.json 기록, 서버 측 단일 실행, 요청 ID 중복 방지, 원자 저장 후 실행, 실패/중단/재시작 상태, 수동 평가 누적.
- 인증 API: 모델 목록, 실험 생성·목록·상세·중단·평가. 기존 세션과 Host/Origin 정책 적용. 외부 proxy/모델 pull 경로 없음.
- 화면: `/experiments`, 모델/생성 설정, 실행 동의, 요청 ID 보존, 결과·메트릭·모델 정보·평가, 설정 재사용·JSON 내보내기.
- DeepSeek/OpenCode 모델·권한 정책과 기존 workspace.json은 유지한다. M3 실험은 도구 실행 개발 에이전트가 아니다.

## 검증 근거

- `npm run check && npm test` 통과. 기존 47개 + M3 12개, 총 **59/59 통과**, 실패·취소·건너뜀 0개(6088.37075ms). 이번 환경에서는 실제 HTTP 소켓 테스트도 통과했다.
- M3 검증은 intent 선저장, 동일/상이 입력의 요청 ID 처리, 동시 실행 거부, 타임아웃, provider 오류 비노출, 불완전/도구 응답 거부, 로컬 모델·입력 제한, 중단·재시작 자동 재전송 금지, 평가 누적·중복 방지, 손상/심볼릭 링크 파일 거부, 인증·Origin·독립 세션 공유, 브라우저 pending 복원을 다룬다.
- 실제 Qwen 3B/7B: 응답·의도한 모델 부재 실패·평가 저장·기록 재개방 복원 통과. [원본 기록과 세부 조건](../experiments/ollama/README.md).
- 별도 HTTP 검증 앱의 브라우저에서 실제 모델 호출과 평가·리로드·설정 재사용·JSON 내보내기 확인. 폭 421px 수평 넘침 없음. 운영 HTTPS/물리 기기 검증으로 대체하지 않는다.
- 27B 확장: 사용자 요청 반영. 초기 Ollama 0.22.0에서 HTTP 412로 차단됐다. 이후 사용자가 0.40.16으로 업데이트했고 API 응답을 확인했다. 27B 설치·실행 검증은 위 최신 진행을 따른다.

## 운영 적용

운영 백엔드의 M3 활성화와 HTTPS API 실험은 위 추가 검증으로 확인했다. 아래는 이후 배포 시 사용할 절차다. 정적 화면만 열리는 것과 API 활성화를 구분한다. `/api/system`의 `features.ollamaExperiments=true`로 새 프로세스를 확인한다. 기능 미지원이면 화면에 재시작 안내가 표시된다.

1. 모든 클라이언트에서 신규 지시·승인·실험 입력을 멈춘다.
2. `npm run check && npm test`를 확인한다.
3. 활성/current 작업·미처리 승인·질문·전달 불확실 상태가 없는지 확인한다. M2 검증 작업의 사용자 거절로 끝난 interrupted/paused 상태와 기록은 지우거나 재실행하지 않는다.
4. `.operations/activate-m3.sh`는 위 상태와 PID를 확인하고 정상 종료 후 LaunchAgent를 재시작한다. 강제 종료/잠금 삭제/데이터 초기화는 하지 않는다. 중단된 과거 거절 기록은 보존한다.
5. 기존 HTTPS에서 다시 로그인하고 **Ollama 실험**을 연다. 설치 모델 목록 → 새 실험 → 응답 → 평가 → 새로고침 후 기록 유지 순서로 확인한다. 운영 검증을 끝내기 전에는 운영 적용 완료로 표시하지 않는다.

Ollama 서비스 업데이트/다운로드와 워크스페이스 서비스 재시작은 별개다. 3B/7B 실험 연결에는 Ollama 업데이트가 필요하지 않다. 27B 다운로드 문제는 [실험 안내](../experiments/ollama/README.md)의 별도 절차를 따른다.

## 커밋

작성자·커미터 날짜는 사용자 지정 **2026-11-11 / 2026-11-12 +09:00**를 사용한다. 실제 검증일 11월 15일을 위 문서와 결과 JSON에 유지한다. 기존 본인 Git identity만 사용하고 추가 작성자 trailer·기존 이력 수정·push를 하지 않는다. 커밋 준비·실행 상태는 최종 기록을 따른다.

커밋 실행 준비: `.operations/commit-m3.sh --check`는 HEAD·브랜치·identity·파일 해시와 전체 변경 목록을 확인한다. `--apply`는 11월 11일 3개, 12일 3개 커밋을 작성하며 push하지 않는다. 기존 6개 커밋 생성과 운영 반영은 위 추가 확인을 따른다. 이후 추가 검증 기록은 별도 변경으로 남긴다.

추가 운영 검증 기록 커밋: `.operations/commit-m3-validation.sh --check`가 12개 문서/결과 파일의 해시·HEAD·브랜치·identity 검사를 통과했다. `--apply`의 git add는 `.git/index.lock` 생성 EPERM으로 차단됐다. 작업 파일은 보존했고 기존 6개 커밋을 수정하지 않았다. 일반 터미널에서 `bash .operations/commit-m3-validation.sh --apply`로 11월 12일 18:10(+09:00) 작성자·커미터 날짜의 검증 기록 커밋 1개를 적용한다.
