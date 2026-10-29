# Mac mini 작업 인계

갱신: 2026-10-29. 개발은 **iCloud 밖 `~/Developer/personal-ai`의 `codex/mac-mini-central`**에서 이어간다. 공유 원본은 확인 당시 `feat/opencode-workspace` / `a73d817`이며 미커밋 파일이 없었다. 원격 브랜치도 같은 커밋이었다. 공유 원본의 브랜치·파일·Git 설정을 이 작업에서 변경하지 않았다.

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

## 아직 완료하지 못한 확인

맥미니에서 기존 DeepSeek 인증을 찾지 못했다. 실제 smoke를 실행했으나 공급자 선택 단계에서 중단되어 모델 요청은 전송하지 않았다. 실제 엔진에는 기본 `opencode` 공급자만 연결되어 있으며, 다른 무료 모델로 대신 검증하지 않았다. 맥북에서 2026-10-28 검증한 DeepSeek 호출 결과는 맥미니 검증 결과로 재사용하지 않는다. 기존 설정의 안전한 위치 확인 또는 사용자의 공급자 인증이 필요하다.

Tailscale은 설치되어 있지만 Stopped 상태다. 캐시된 주소는 `https://ukkhnns-macmini.tail2e5038.ts.net`이며 Serve는 비어 있고 Funnel은 꺼져 있다. **이 URL을 접속 가능한 완료 주소로 취급하지 않는다.** 사용자 정책에 따라 연결 활성화·HTTPS·자동 시작을 승인 대기로 남겼다. 설정안은 `~/.local/share/personal-ai/operations/2026-10-29-final/`에 있고 plist 검사를 통과했다.

## 다음 실행

```sh
cd ~/Developer/personal-ai/agent-workspace/app
npm run doctor
npm start
```

현재 수동 프로세스가 살아 있으면 중복 시작 대신 `http://127.0.0.1:4310`으로 접속한다. 로그인 암호는 `~/.local/share/personal-ai/access-code.txt`에서 로컬로 확인한다. 현재 앱에는 전용 personal-ai 프로젝트가 연결되어 있다. 테스트용 프로젝트·템플릿·작업은 별도 임시 데이터에만 만들었다.

1. 기존 DeepSeek 설정·인증 위치를 확인하고 엔진에서 연결된 모델을 확인한다. API 키를 대화·Git에 넣지 않는다.
2. 실제 공급자 ID·모델 ID를 지정해 `LIVE_MODEL_TEST=1 LIVE_PROVIDER_ID=deepseek LIVE_MODEL_ID=<실제 ID> node scripts/smoke-live.js`를 실행한다. 병행 검증은 `LIVE_PARALLEL_TEST=1`을 더한다.
3. 사용자 승인 범위에 따라 [OPERATIONS.md](OPERATIONS.md)의 준비된 Tailscale·HTTPS·LaunchAgent 설정을 적용한다. 연결 후 실제 DNS 이름을 다시 확인한다.
4. 맥북·모바일에서 같은 작업을 조회·추가 지시·승인·재접속하는 실제 기기 검증을 수행한다.

## 이어지는 제품 개발

스킬·도구·권한·템플릿 관리, 프로젝트 의존성 설치의 안전한 승인 경계, 제품 내부 자동 커밋·push 및 커밋과 결부된 최종 병합 승인, 파일·결과물 전체 조회, 백업·복원·작업 정리는 남아 있다. 현재 제품의 모든 셸 명령 승인 정책은 유지했다.

이번 개발의 작업 브랜치 커밋·push는 사용자가 직접 승인한 저장소 작업이다. 제품이 자동으로 커밋·push하도록 구현되었다는 뜻이 아니다. 최종 병합은 하지 않는다.

GitHub는 코드 전달 수단이다. 맥북의 실행 중 작업·세션·절대 경로·OpenCode DB가 자동 이전되지 않는다. 앞으로 맥미니의 동일한 중앙 서버를 클라이언트 기기들이 조회하도록 연결한다. 전체 첫 제품 버전의 완료 기준은 아직 미충족이다.
