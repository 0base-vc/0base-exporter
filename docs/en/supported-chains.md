# Supported Chains

| `CHAIN`                | Family | Legacy `BLOCKCHAIN`                    |
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

`limonata-testnet` — Cosmos REST + CometBFT, 18-decimal aLIMO. [Configuration](./configuration.md).

## SphereNet

`spherenet-testnet` uses only SphereNet's own Solana-compatible JSON-RPC. It
reports RPC health, slot/epoch, peer and validator-set counts, configured vote
account stake/commission/last vote, client version, genesis hash match, and
shred-version match. Missing vote-account data is left unavailable rather than
being treated as inactive. Configure `GENESIS_HASH` and `SHRED_VERSION` when
the network operator has published those values.
