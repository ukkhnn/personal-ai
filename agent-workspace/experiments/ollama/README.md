# Ollama 실험 — M3

실제 확인일: 2026-11-15. Mac mini M4 Pro, 통합 메모리 64GiB, 초기 검증 Ollama 0.22.0, 운영 검증 0.40.16.

## 실행과 기록

워크스페이스의 **Ollama 실험** 링크(`/experiments`)에서 설치된 모델·시스템 지침·프롬프트·생성 설정을 선택한다. 사용자가 실행을 확인하면 서버가 단일 텍스트 실험을 수행하고 `WORKSPACE_DATA_DIR/experiments.json`에 저장한다. 기존 OpenCode 개발 작업과 데이터 파일을 분리했다.

- 설정: temperature, top_p, seed, num_ctx, num_predict. 응답 대기 180초, stream=false, keep_alive=0.
- 입력·상태·시각, Ollama 버전, 실행 전 모델 digest·크기·양자화·모델 기본 parameters/template/system/model_info, 응답·thinking·종료 이유·토큰/시간 지표를 보관한다.
- 기본 설정에서 바꾸지 않은 모델 옵션은 모델 기본값을 사용한다. digest는 실행 전 관측값이며 태그 변경을 잠그거나 비트 단위 재현을 보장하지 않는다.
- 평가(통과/부분 충족/실패, 메모)는 실행 완료와 별개로 추가 기록한다. 이전 평가를 덮어쓰지 않는다. 설정 불러오기와 개별 JSON 내보내기를 제공한다.
- 요청 ID와 입력을 실행 전에 저장한다. 응답 유실 후 같은 ID를 조회·재요청해도 재실행하지 않는다. 브라우저는 미확인 요청을 sessionStorage에 보관한다. 보관 실패 시 실행하지 않는다.
- 한 서버에서 실험은 한 번에 하나만 실행한다. 다른 실험이 실행 중이면 409, 큐 자동 실행은 없다. 다른 Ollama 클라이언트의 실행량까지 제어하지는 않는다.
- 연결 실패·HTTP 오류·시간 초과를 기록한다. 중단/서버 재시작은 결과 미확인으로 남기고 자동 재시도하지 않는다. 연결 중단은 Ollama 내부 계산 종료를 보증하지 않는다.
- 로컬 literal loopback HTTP만 허용한다. 앱 인증·Origin 검사를 통과해야 조회/실행/평가할 수 있다. 원격/클라우드 모델 별칭과 텍스트 생성 미지원 모델은 실행 전에 거부한다. 프롬프트 외 파일·메모리는 자동 주입하지 않는다.
- 모델 설치·업데이트, 도구 호출·코드 실행·파일 편집·프로젝트 worktree 생성은 실험 API에서 제공하지 않는다. Ollama 로컬 서버와 모델 관리자는 신뢰 경계 안에 있다.

기록은 0600 파일로 원자 교체한다. 손상/미지원 스키마를 덮어쓰지 않는다. 프롬프트와 응답이 그대로 남으므로 백업도 비공개 로컬 저장소에 둔다. 현재 단일 JSON 파일 방식으로, 장기 대규모 기록의 페이지 단위 조회/DB 이전은 후속 과제다.

## 재현 명령

저장소의 `agent-workspace/app`에서 실행한다. 새 출력 폴더를 지정해야 하며 운영 기록을 덮어쓰지 않는다.

```bash
node scripts/verify-ollama.js --allow-inference --model qwen2.5:3b --output ../experiments/ollama/results/your-new-run
```

검증 도구는 정해진 짧은 프롬프트로 실제 응답을 확인하고, 설치되지 않은 모델 실패와 디스크 재개방 후 기록·평가 복원을 확인한다. opt-in·모델·출력 경로가 없으면 서비스에 접근하지 않는다. 운영 앱 재시작 시험이나 품질 벤치마크는 아니다.

## 실제 검증 결과

| 모델 | 파라미터/양자화 | 총 소요(모델 확인 포함) | 결과 |
|---|---|---|---|
| qwen2.5:3b | 3.1B / Q4_K_M | 1.812초 | `M3_OLLAMA_OK` 정확히 반환, 평가·복원 통과 |
| qwen2.5:latest | 7.6B / Q4_K_M | 3.929초 | 같은 응답·평가·복원 통과 |

두 모델 모두 temperature=0, top_p=1, seed=42, num_ctx=2048, num_predict=32, 같은 system/prompt로 실행했다. 각 모델에서 `model_unavailable` 실패 기록도 별도로 남겼다. 1회 짧은 연결 시험이므로 모델 품질·실사용 속도 순위를 뜻하지 않는다.

원본: [3B 기록](results/2026-11-15-qwen3b/experiments.json), [7B 기록](results/2026-11-15-qwen7b/experiments.json). 개인 작업 입력·인증 정보는 포함하지 않았다.

별도 loopback HTTP 검증 서버에서 브라우저 로그인 → 실험 실행 → 실제 `M3_BROWSER_OK` 응답 → 평가 추가 → 새로고침 후 같은 ID·평가 복원 → 설정 불러오기 → JSON 내보내기도 확인했다. 실험 ID `e53de996-bda4-415c-84f8-c3bab5d36a22`; 내보낸 파일의 ID·응답·평가 1개를 대조했다. 실제 CSS 너비 421px에서 clientWidth=scrollWidth=421, 실행 버튼 높이 약 44px. 운영 HTTPS·물리 맥북/아이폰 시험으로 계산하지 않는다.

## 27B 추가 요청

사용자가 27B급 모델도 실험하도록 요청했다. 64GiB 메모리와 확인 시점 124GiB 디스크 여유를 확인했다. Qwen 3.5 27B와 Gemma 3 27B의 공식 배포 크기는 각각 약 17~20GB, 17GB이며 컨텍스트·캐시 메모리는 별도다.

초기 Ollama 0.22.0에서는 27B pull이 manifest HTTP 412(newer version required)로 거부됐다. 사용자가 Homebrew로 0.40.16 업데이트·서비스 재시작을 수행한 뒤 API 응답을 확인했다. 첫 다운로드는 19%에서 실행 세션이 종료됐고, 오후에 이어받아 종료 코드 0과 설치 완료를 확인했다.

최종 설치본은 `qwen3.5:27b`(27.4B, safetensors / NVFP4 / MLX, 약 19GB)다. 공식 태그가 제공하는 Mac용 모델이 선택됐다. 설치된 digest와 실제 양자화/runner를 기록했으며 태그 이름만으로 GGUF Q4_K_M이라고 간주하지 않는다.

## 운영 HTTPS 검증 완료

Ollama 0.40.16과 실제 Tailscale HTTPS 앱에서 아래 세 모델을 확인했다. 모두 `M3_HTTPS_OK`를 정확히 반환했고, 실행 접수 후 로그아웃·재로그인, 평가 저장·재로그인 복원, 동일 요청 ID 재전송 시 원래 결과 반환을 통과했다. 인증 정보는 결과 파일에 포함하지 않았다.

| 모델 | 실제 설치 형식 | 모델 확인·로딩 포함 소요 | 기록 |
|---|---|---|---|
| qwen2.5:3b | 3.1B / Q4_K_M | 2.120초 | [3B](results/2026-11-15-production/qwen3b.json) |
| qwen2.5:latest | 7.6B / Q4_K_M | 3.030초 | [7B](results/2026-11-15-production/qwen7b.json) |
| qwen3.5:27b | 27.4B / NVFP4 / MLX | 26.140초 | [27B](results/2026-11-15-production/qwen27b.json) |

동일 system/prompt, temperature=0, top_p=1, seed=42, num_ctx=4096, num_predict=1024, stream=false, keep_alive=0을 사용했다. 27B는 별도 thinking 708자를 반환하고 총 201토큰을 생성했다. 로딩 10.015초, 생성 14.318초(약 14.0 token/s)다. 3B/7B는 6토큰을 생성했다. 이 수치는 각 1회 연결 검증 결과이며 모델 품질 순위나 엄밀한 속도 벤치마크가 아니다.

27B 추론 중 100% GPU·context 4096·runner mlx를 확인했고, 완료 후 `ollama ps`에서 해제된 것도 확인했다. 실험 화면에서 27B를 선택할 때 우선 위 검증 조건인 컨텍스트 4096/최대 생성 1024를 기준으로 기록을 쌓는다. 기본 CLI 검증 스크립트의 32토큰 설정은 thinking 모델의 최종 응답 전에 한도에 닿을 수 있으므로, 27B 운영 검증은 별도 HTTP 검증에서 1024토큰으로 수행했다.

M3의 실험 연결·기록 누적은 완료했다. 로컬 모델의 코드·도구 실행 및 물리 기기 전환 검증은 이번 통과 범위에 포함하지 않는다.

## 참고한 공식 명세

- [Ollama chat API](https://docs.ollama.com/api/chat)
- [Ollama 모델 목록](https://docs.ollama.com/api/tags)
- [Qwen 3.5 27B](https://ollama.com/library/qwen3.5:27b)
- [Gemma 3 27B Q4_K_M](https://ollama.com/library/gemma3:27b-it-q4_K_M)
