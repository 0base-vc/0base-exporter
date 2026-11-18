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

`limonata-testnet` — Cosmos REST + CometBFT, 18-decimal aLIMO. [Configuration](./configuration.md).

## SphereNet

`spherenet-testnet` uses only SphereNet's own Solana-compatible JSON-RPC. It
reports RPC health, slot/epoch, peer and validator-set counts, configured vote
account stake/commission/last vote, client version, genesis hash match, and
shred-version match. Missing vote-account data is left unavailable rather than
being treated as inactive. Configure `GENESIS_HASH` and `SHRED_VERSION` when
the network operator has published those values.

## Pharos mainnet

`pharos` reads validator owner rewards and commission rates from the Pharos
staking contract. Set `EVM_API_URL` to a Pharos mainnet JSON-RPC endpoint and
`VALIDATOR` to one or more comma-separated validator pool IDs (`bytes32` hex).
The collector resolves each pool's owner from the contract. It does not need a
wallet address or signing key.
