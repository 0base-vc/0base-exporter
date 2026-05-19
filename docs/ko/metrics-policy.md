# 메트릭 호환성 정책

Prometheus 사용자는 exporter 출력을 alert, dashboard, recording rule에 직접 연결하는 경우가 많습니다. 따라서 metric 출력은 공개 계약으로 취급합니다.

## 안정 계약

다음 항목은 호환성에 민감합니다.

- metric name;
- label name과 label value 의미;
- gauge, counter 같은 metric type;
- collector 시작에 필요한 필수 환경변수;
- `GET /healthz`, `GET /metrics` endpoint 제공 여부.

patch 릴리스에서는 잘못되었거나 위험한 데이터를 막기 위한 수정이 아닌 이상 이 계약을 유지해야 합니다.

## 호환 가능한 변경

일반적으로 다음 변경은 안전합니다.

- 새 metric 추가;
- 새 `CHAIN` id 추가;
- optional 환경변수 추가;
- metric 의미를 바꾸지 않는 timeout, cache, retry 개선;
- 기존 동작을 더 명확히 문서화.

새 metric을 추가할 때는 metric name과 label set을 고정하는 테스트나 fixture를 함께 추가하세요.

## 브레이킹 변경

다음 변경은 major version 또는 명시적인 migration note가 필요합니다.

- metric 제거 또는 이름 변경;
- label name 또는 label 의미 변경;
- availability indicator 없이 exact metric을 partial metric으로 바꾸는 변경;
- 필수 startup 환경변수 변경;
- 레거시 `BLOCKCHAIN` alias 제거.

가능하면 dashboard와 alert migration note도 함께 작성해야 합니다.

## Partial 데이터와 Best-Effort 데이터

일부 upstream source는 현재 epoch 데이터를 완전하게 제공하지 않습니다. Collector는 metric name, label, companion availability metric으로 상태가 명확할 때만 lower-bound 또는 partial 값을 emit할 수 있습니다.

Solana current-epoch metrics에서는 `solana_slots_available`, `solana_income_available`, `solana_validator_epoch_current`, `solana_validator_epoch_final` 같은 availability gauge로 관련 값의 완전성을 확인합니다.

## 리뷰 기준

Metric을 건드리는 PR은 다음 중 하나를 명시해야 합니다.

- "Metric contract preserved";
- "Metric added, no existing contract changed";
- "Breaking metric change, migration note included".

테스트나 문서화된 호환성 판단이 없는 metric 변경은 리뷰에서 막아야 합니다.
