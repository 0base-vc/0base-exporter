# 설정 레퍼런스

## Collector 선택

- 권장 방식: `CHAIN=<collector-id>`
- 레거시 호환: `BLOCKCHAIN=./availables/<module>.ts` 또는 Node가 해석할 수 있는 module specifier

둘 다 있으면 `CHAIN`이 우선합니다.

등록된 레거시 `BLOCKCHAIN` 경로는 대응하는 `CHAIN` 항목으로 매핑됩니다. 등록되지 않은 값도 하위 호환성을 위해 동적으로 로드하므로, custom collector는 기존 module path나 package specifier를 계속 사용할 수 있습니다. 단, 호환되는 collector class를 export해야 합니다.

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

여러 값은 쉼표로 구분합니다.

하위 호환성을 위해 런타임은 여전히 `VOTE`를 `ADDRESS`보다, `IDENTITY`를 `VALIDATOR`보다 먼저 확인합니다. 새 배포에서는 위 표의 계열별 필드를 권장하며, 두 alias를 동시에 설정하면 레거시 값이 이긴다는 점을 명시적으로 의도해야 합니다.

## Solana 메인넷 current epoch 메트릭

`solana` collector는 current epoch의 slot, fee, tip income 데이터를 `https://whoearns.live`에서 읽습니다. indexer가 유효한 숫자를 반환하면 numeric metric을 노출하고, 완성도는 `solana_slots_available`, `solana_income_available`, `solana_validator_epoch_current`, `solana_validator_epoch_final` 같은 boolean gauge로 별도 노출합니다.

수입은 Solana RPC block data에서 계산한 base fee, priority fee, on-chain Jito tip 기준입니다. `solana_mev_fees_total_sol`은 `solana_block_tips_total_sol`의 호환 alias로 유지되며, 더 이상 Jito Kobe payout 값을 의미하지 않습니다.
