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

`ritual-testnet`에서는 `API_URL`에 Ritual CL JSON-RPC endpoint를 넣고,
`EVM_API_URL`에 Ritual EL JSON-RPC endpoint를 넣습니다.
`EXISTING_METRICS_URL`에는 exporter `/metrics` 응답에 함께 합칠 EL/CL
Prometheus endpoint를 넣습니다.

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

## Limonata 테스트넷

`CHAIN=limonata-testnet`, `API_URL`(Cosmos REST), `RPC_URL`(CometBFT),
`ADDRESS`(cosmos 계정), `VALIDATOR`(cosmosvaloper 주소)를 지정한다.
기존 `BLOCKCHAIN=./availables/testnet/limonata.js` 경로도 지원한다.
`EXISTING_METRICS_URL`로 네이티브 Prometheus 메트릭을 병합한다.
aLIMO는 18자리로 고정 환산하며 `DECIMAL_PLACES` 설정은 적용하지 않는다.

Cosmos 공통 수집기를 재사용해 잔액·위임·언본딩·보상·커미션·계정 sequence,
본딩 순위·staking 설정·투표 중 제안을 수집한다. 기존 `tendermint_*` 이름을
유지하고 금액은 LIMO 단위다(denom 라벨은 `aLIMO`). 순위 0은 본딩 목록에
없음을 뜻한다. 순위는 처음 256명 기준이며 현재 테스트넷 정원은 100명이다.

`limonata_*`로 RPC/REST/피어/validator 조회 성공 여부와 높이·블록 시각·동기화,
투표 파워·피어 수·본딩·jailed·총 LIMO stake를 추가한다.
실패 시 이전 성공값을 재사용하지 않으며 일부 Cosmos 요청 실패는
`limonata_cosmos_up=0`으로 표시한다. 미등록 validator 조회 실패를 unbonded로
단정하지 않는다. 네이티브 메트릭의 공통 이름 변환(`cometbft` → `tendermint`)을
유지한다. 순위를 DKG 위원회 편입으로 간주하거나 운영 점수를 추정하지 않는다.

Limonata 금액은 aLIMO만 수집한다. 선택 native endpoint 장애는 체인 메트릭을 유지하고 `limonata_native_metrics_up=0`으로 표시한다.
