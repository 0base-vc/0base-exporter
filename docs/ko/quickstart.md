# 빠른 시작

## 요구 사항

- Node.js 20+
- npm 10+
- 대상 체인의 RPC 또는 REST 접근 권한

## 설치

```bash
npm ci
npm run build
```

## Cosmos/Tendermint 실행 예시

```bash
CHAIN=tendermint \
API_URL=http://localhost:1317 \
ADDRESS=cosmos1youraddress \
VALIDATOR=cosmosvaloper1yourvalidator \
npm start
```

## Solana 실행 예시

```bash
CHAIN=solana \
RPC_URL=https://api.mainnet-beta.solana.com \
VOTE=VoteAccountPubkey \
IDENTITY=IdentityPubkey \
npm start
```

## 확인

```bash
curl http://localhost:27770/healthz
curl http://localhost:27770/metrics
```
