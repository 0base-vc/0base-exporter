# 예제

## Prometheus scrape 설정

```yaml
scrape_configs:
  - job_name: 0base-exporter
    static_configs:
      - targets: ["127.0.0.1:27770"]
```

## Cosmos 예제

env 템플릿: [`examples/env/tendermint-v1.env`](../../examples/env/tendermint-v1.env)

```bash
CHAIN=tendermint-v1 \
API_URL=https://lcd.example.com \
RPC_URL=https://rpc.example.com \
ADDRESS=cosmos1delegator \
VALIDATOR=cosmosvaloper1validator \
npm start
```

## Solana 예제

env 템플릿: [`examples/env/solana.env`](../../examples/env/solana.env)

```bash
CHAIN=solana \
RPC_URL=https://api.mainnet-beta.solana.com \
ADDRESS=Wallet1111111111111111111111111111111111111 \
VOTE=Vote111111111111111111111111111111111111111 \
IDENTITY=Identity1111111111111111111111111111111 \
npm start
```

## EVM / hybrid 예제

env 템플릿: [`examples/env/berachain.env`](../../examples/env/berachain.env)

```bash
CHAIN=berachain \
API_URL=https://rest.example.com \
EVM_API_URL=https://rpc.example.com \
ADDRESS=0x1234...,0xabcd... \
VALIDATOR=0xvalidator \
ALCHEMY_API_KEY=your-key \
npm start
```
