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
| `solana`               | Solana | `./availables/solana.ts`               |
| `solana-testnet`       | Solana | `./availables/testnet/solana.ts`       |
| `spherenet-testnet`    | Solana | `./availables/testnet/spherenet.ts`    |
| `monad`                | EVM    | `./availables/monad.ts`                |
| `monad-testnet`        | EVM    | `./availables/testnet/monad.ts`        |
| `berachain`            | Hybrid | `./availables/berachain.ts`            |
| `mitosis`              | Hybrid | `./availables/mitosis.ts`              |
| `mitosis-testnet`      | Hybrid | `./availables/testnet/mitosis.ts`      |
| `story-testnet`        | EVM    | `./availables/testnet/story.ts`        |
| `ritual-testnet`       | Hybrid | `./availables/testnet/ritual.ts`       |
| `hashkinetics-testnet` | Hybrid | `./availables/testnet/hashkinetics.ts` |
| `canopy-testnet`       | Hybrid | `./availables/testnet/canopy.ts`       |

## Limonata

`limonata-testnet` — Cosmos REST + CometBFT, aLIMO 소수점 18자리. [설정](./configuration.md).

## SphereNet

`spherenet-testnet`은 SphereNet 자체의 Solana 호환 JSON-RPC만 사용한다.
RPC health, slot/epoch, peer·validator set 수, 설정한 vote account의 stake·수수료·
마지막 투표, client version, genesis hash 일치와 shred-version 일치를 수집한다.
vote account가 조회되지 않을 때는 비활성으로 단정하지 않고 unavailable로 둔다.
네트워크 운영자가 값을 공개한 뒤 `GENESIS_HASH`, `SHRED_VERSION`을 설정한다.
