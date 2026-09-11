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

## HashKinetics 테스트넷

`CHAIN=hashkinetics-testnet`, `RPC_URL=http://127.0.0.1:26000`을 설정한다.
`RPC_URL`은 필수이며 Tendermint 기본 포트를 사용하지 않는다. 선택 항목인
`API_URL=https://rpc.hashkinetics.org`는 동기화 비교용 기준 노드다.
`VALIDATOR`에는 `validator.json`의 공개 `root_pk` 바이트를 96자리 hex로 넣는다.
개인키나 회전하는 consensus 주소를 넣지 않는다. 공개 루트는 키 회전 뒤에도 유지된다.
`BLOCKCHAIN=./availables/testnet/hashkinetics.js`도 지원한다.
[환경 예시](../../examples/env/hashkinetics-testnet.env)를 참고한다.

로컬 `hk_chainInfo`, `hk_getValidators`, 선택적인 기준 노드 `hk_chainInfo`와
앞선 노드의 `hk_getBlock` 최대 1회를 호출한다. 호출 제한은 각 4초이며 동시
스크레이프는 수집을 공유한다. 실패 시 이전 성공값을 재사용하지 않는 `postFresh`를
사용하며 기존 collector의 fallback 동작은 변경하지 않는다.

추가 지표는 `hashkinetics_` 접두사를 사용한다.

- 상태: `rpc_up`, `validator_query_up`, `reference_rpc_up`,
  `reference_network_match`, `app_hash_check_up`.
- 동기화: `latest_block_height`, `peer_count`, `last_progress_time_seconds`,
  `reference_block_height`, `sync_lag_blocks`, `catching_up` (20블록 초과 지연),
  동일 높이 비교 결과 `app_hash_match`.
- 로컬 밸리데이터 집합: `active_validators`, `total_voting_power`, `quorum_power`,
  `validator_active`, `validator_voting_power`, `validator_epoch`.
- 서명 키: `signer_remaining`, `signer_capacity`, `signer_remaining_ratio`,
  `signer_epoch`. 프로세스: `node_rss_bytes`, `node_uptime_seconds`,
  `verifier_init_milliseconds`. 버전: `network_info{chain_id,version}` (값 1).

조회 불가 항목은 0이나 inactive로 위장하지 않고 생략한다. 로컬 validator set을
정상 조회했을 때만 미등록 observer를 `validator_active=0`으로 표시한다.
등록 여부는 로컬 높이 기준이므로 동기화 상태와 함께 해석한다. 기준 노드 미설정/실패
시 비교 지표를 생략한다. 진행 시간은 exporter가 높이 변화를 관측한 시각이며 재시작
시 초기화된다. 체인 블록 시각은 합성된 값이므로 실제 시간으로 취급하지 않는다.
기준 조회 실패는 fork가 아니다. 지갑 잔고·커미션·미서명 지표를 임의로 만들지 않는다.
기존 지표 계약은 변경하지 않는다.
