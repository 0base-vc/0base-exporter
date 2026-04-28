# 아키텍처

## 런타임 흐름

1. `src/index.ts`가 프로세스를 시작하고 치명적 오류를 종료 처리합니다.
2. `src/core/config.ts`가 환경변수를 파싱하고 검증합니다.
3. `src/core/collector-registry.ts`가 `CHAIN` 또는 레거시 `BLOCKCHAIN` 값을 collector로 매핑합니다.
4. `src/server.ts`가 `GET /healthz`, `GET /metrics`를 제공합니다.
5. `src/target.abstract.ts`가 공통 transport, fallback, cache 로직을 제공합니다.

## 설계 포인트

- collector 선택 로직은 중앙화되었지만, 체인별 구현은 아직 분리된 파일을 유지합니다.
- concurrent scrape 시 동일한 upstream 요청이 중복되지 않도록 cache miss dedupe가 추가되었습니다.
- Prometheus 성능 계측은 `ENABLE_PROM_PERF`로 opt-in 됩니다.
- Berachain 같은 background 작업은 constructor가 아니라 lifecycle hook에서 시작합니다.
