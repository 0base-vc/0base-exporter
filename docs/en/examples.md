# Examples

## Prometheus scrape config

```yaml
scrape_configs:
  - job_name: 0base-exporter
    static_configs:
      - targets: ["127.0.0.1:27770"]
```

## Cosmos example

Env template: [`examples/env/tendermint-v1.env`](../../examples/env/tendermint-v1.env)

```bash
CHAIN=tendermint-v1 \
API_URL=https://lcd.example.com \
RPC_URL=https://rpc.example.com \
ADDRESS=cosmos1delegator \
VALIDATOR=cosmosvaloper1validator \
npm start
```

## Solana example

Env template: [`examples/env/solana.env`](../../examples/env/solana.env)

```bash
CHAIN=solana \
RPC_URL=https://api.mainnet-beta.solana.com \
ADDRESS=Wallet1111111111111111111111111111111111111 \
VOTE=Vote111111111111111111111111111111111111111 \
IDENTITY=Identity1111111111111111111111111111111 \
npm start
```

## EVM / hybrid example

Env template: [`examples/env/berachain.env`](../../examples/env/berachain.env)

```bash
CHAIN=berachain \
API_URL=https://rest.example.com \
EVM_API_URL=https://rpc.example.com \
ADDRESS=0x1234...,0xabcd... \
VALIDATOR=0xvalidator \
ALCHEMY_API_KEY=your-key \
npm start
```

## Ritual testnet example

Env template: [`examples/env/ritual-testnet.env`](../../examples/env/ritual-testnet.env)

```bash
CHAIN=ritual-testnet \
API_URL=http://ritual-testnet:3030 \
EVM_API_URL=http://ritual-testnet:8545 \
ADDRESS=0xFBF57F6b80578F4918684BAbB5dA70Fac504bdB3 \
VALIDATOR=0xd819a8df40351384466db487458d0b9091c697fd198b05a8729f892c251ae82f \
EXISTING_METRICS_URL=http://ritual-testnet:9001/metrics,http://ritual-testnet:9090/metrics \
npm start
```

`API_URL` points to Ritual CL JSON-RPC, `EVM_API_URL` points to EL JSON-RPC, and
`EXISTING_METRICS_URL` merges the native EL/CL Prometheus endpoints into the same
exporter `/metrics` response.
