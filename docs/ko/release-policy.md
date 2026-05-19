# 릴리스 정책

## 브랜치 전략

- 일반 개발은 `main`에서 파생된 topic branch에서 진행합니다.
- 큰 리팩터링은 `codex/oss-foundation-refactor` 같은 전용 브랜치를 사용합니다.

## 버전 정책

- 릴리스 태그는 `v1.2.3` 형태의 Semantic Versioning을 사용합니다.
- patch 릴리스에서는 metric name, label, 필수 환경변수를 바꾸지 않습니다.
- 런타임 계약이나 metric 계약이 깨지는 변경은 메이저 버전과 명시적 마이그레이션 안내가 필요합니다.

## 품질 게이트

모든 PR은 다음을 통과해야 합니다.

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run docs:lint`
- `npm test`
- `npm run build`
- `npm pack --dry-run`

태그 릴리스에서는 GitHub release workflow가 함께 실행되어 저장소 검증, 패키지 빌드, npm tarball 생성, checksum 업로드까지 수행합니다.

## 호환성 정책

- `GET /metrics`는 안정 인터페이스로 취급합니다.
- metric name / label은 명시적 브레이킹 변경이 아닌 이상 유지합니다.
- 레거시 `BLOCKCHAIN` 값은 차후 메이저 릴리스 전까지 지원합니다.
