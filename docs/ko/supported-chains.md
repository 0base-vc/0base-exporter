# 지원 체인

| `CHAIN`                | 계열   | 레거시 `BLOCKCHAIN`                    |
| ---------------------- | ------ | -------------------------------------- |
| `tendermint`           | Cosmos | `./availables/tendermint.ts`           |
| `tendermint-v1`        | Cosmos | `./availables/tendermint-v1.ts`        |
| `tendermint-v1beta1`   | Cosmos | `./availables/tendermint-v1beta1.ts`   |
| `terra`                | Cosmos | `./availables/terra.ts`                |
| `terra-v2`             | Cosmos | `./availables/terra-v2.ts`             |
| `atomone`              | Cosmos | `./availables/atomone.ts`              |
| `tendermint-umee`      | Cosmos | `./availables/tendermint-umee.ts`      |
| `tendermint-tgrade`    | Cosmos | `./availables/tendermint-tgrade.ts`    |
| `gnoland`              | Cosmos | `./availables/gnoland.ts`              |
| `gnoland-testnet`      | Cosmos | `./availables/testnet/gnoland.ts`      |
| `initia-testnet`       | Cosmos | `./availables/testnet/initia.ts`       |
| `push-testnet`         | Cosmos | `./availables/testnet/push.ts`         |
| `solana`               | Solana | `./availables/solana.ts`               |
| `solana-testnet`       | Solana | `./availables/testnet/solana.ts`       |
| `spherenet-testnet`    | Solana | `./availables/testnet/spherenet.ts`    |
| `monad`                | EVM    | `./availables/monad.ts`                |
| `monad-testnet`        | EVM    | `./availables/testnet/monad.ts`        |
| `pharos`               | EVM    | `./availables/pharos.ts`               |
| `berachain`            | Hybrid | `./availables/berachain.ts`            |
| `mitosis`              | Hybrid | `./availables/mitosis.ts`              |
| `mitosis-testnet`      | Hybrid | `./availables/testnet/mitosis.ts`      |
| `story-testnet`        | EVM    | `./availables/testnet/story.ts`        |
| `ritual-testnet`       | Hybrid | `./availables/testnet/ritual.ts`       |
| `hashkinetics-testnet` | Hybrid | `./availables/testnet/hashkinetics.ts` |
| `canopy`               | Hybrid | `./availables/canopy.ts`               |
| `canopy-testnet`       | Hybrid | `./availables/testnet/canopy.ts`       |

## Limonata

`limonata-testnet` — Cosmos REST + CometBFT, aLIMO 소수점 18자리. [설정](./configuration.md).

## SphereNet

`spherenet-testnet`은 SphereNet 자체의 Solana 호환 JSON-RPC만 사용한다.
RPC health, slot/epoch, peer·validator set 수, 설정한 vote account의 stake·수수료·
마지막 투표, client version, genesis hash 일치와 shred-version 일치를 수집한다.
vote account가 조회되지 않을 때는 비활성으로 단정하지 않고 unavailable로 둔다.
네트워크 운영자가 값을 공개한 뒤 `GENESIS_HASH`, `SHRED_VERSION`을 설정한다.

## Pharos 메인넷

`pharos`는 Pharos staking contract에서 validator 소유자의 미청구 보상과
commission rate를 읽는다. `EVM_API_URL`에는 Pharos 메인넷 JSON-RPC endpoint,
`VALIDATOR`에는 쉼표로 구분한 validator pool ID(`bytes32` hex)를 지정한다.
각 pool의 owner는 contract에서 조회하며 지갑 주소나 서명 키는 필요하지 않다.
