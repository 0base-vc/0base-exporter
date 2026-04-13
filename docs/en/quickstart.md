# Quickstart

## Requirements

- Node.js 20+
- npm 10+
- Access to the target chain RPC or REST endpoints

## Install

```bash
npm ci
npm run build
```

## Run a Cosmos/Tendermint collector

```bash
CHAIN=tendermint \
API_URL=http://localhost:1317 \
ADDRESS=cosmos1youraddress \
VALIDATOR=cosmosvaloper1yourvalidator \
npm start
```

## Run a Solana collector

```bash
CHAIN=solana \
RPC_URL=https://api.mainnet-beta.solana.com \
VOTE=VoteAccountPubkey \
IDENTITY=IdentityPubkey \
npm start
```

## Verify

```bash
curl http://localhost:27770/healthz
curl http://localhost:27770/metrics
```
