# 설정 레퍼런스

## Collector 선택

- 권장 방식: `CHAIN=<collector-id>`
- 레거시 호환: `BLOCKCHAIN=./availables/<module>.ts`

둘 다 있으면 `CHAIN`이 우선합니다.

## 핵심 변수

| 변수                   | 필요 조건           | 설명                                             |
| ---------------------- | ------------------- | ------------------------------------------------ |
| `PORT`                 | 선택                | 기본값은 `27770`                                 |
| `CHAIN`                | 권장                | registry 기반 collector id                       |
| `BLOCKCHAIN`           | 레거시              | 경로 기반 선택자                                 |
| `API_URL`              | Cosmos / hybrid     | REST API base URL                                |
| `RPC_URL`              | Solana, 일부 Cosmos | non-Solana에서는 기본값 `http://localhost:26657` |
| `EVM_API_URL`          | EVM / hybrid        | JSON-RPC base URL                                |
| `EXISTING_METRICS_URL` | 선택                | 합쳐서 노출할 Prometheus endpoint 목록           |
| `ENABLE_PROM_PERF`     | 선택                | 내부 gauge timing 계측 활성화                    |

## 주소 의미

| 계열         | 주소 필드 | validator 필드 |
| ------------ | --------- | -------------- |
| Cosmos / EVM | `ADDRESS` | `VALIDATOR`    |
| Solana       | `VOTE`    | `IDENTITY`     |
