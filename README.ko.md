# 0Base Exporter

Cosmos/Tendermint, Solana, EVM 계열 네트워크의 지갑·검증자 메트릭을 Prometheus 형식으로 노출하는 exporter입니다.

이 저장소는 기존 `GET /metrics` 인터페이스와 레거시 환경변수 사용법을 유지하면서, `CHAIN` 기반 런타임 설정, 테스트, 린트, Git hook, GitHub Actions를 추가해 공개 오픈소스 저장소 기준으로 정리되었습니다.

## 빠른 시작

```bash
npm ci
npm run build

CHAIN=tendermint \
API_URL=http://localhost:1317 \
ADDRESS=cosmos1youraddress \
VALIDATOR=cosmosvaloper1yourvalidator \
npm start
```

실행 후:

```bash
curl http://localhost:27770/metrics
```

체인별 예제 env 파일은 [examples/env](./examples/env)에서 바로 사용할 수 있습니다.

## 체인 선택

가능하면 `BLOCKCHAIN` 대신 `CHAIN`을 사용하세요.

| 계열                | 권장 `CHAIN` 값                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cosmos / Tendermint | `tendermint`, `tendermint-v1`, `tendermint-v1beta1`, `terra`, `terra-v2`, `atomone`, `tgrade`, `tendermint-umee`, `initia-testnet` |
| Solana              | `solana`, `solana-testnet`                                                                                                         |
| EVM / Hybrid        | `monad`, `monad-testnet`, `berachain`, `mitosis`, `mitosis-testnet`, `story-testnet`, `canopy-testnet`                             |

기존 `BLOCKCHAIN=./availables/...` 값도 계속 지원됩니다.

## 주요 문서

- [빠른 시작](./docs/ko/quickstart.md)
- [설정 레퍼런스](./docs/ko/configuration.md)
- [지원 체인](./docs/ko/supported-chains.md)
- [예제](./docs/ko/examples.md)
- [아키텍처](./docs/ko/architecture.md)
- [문제 해결](./docs/ko/troubleshooting.md)
- [릴리스 정책](./docs/ko/release-policy.md)
- [변경 이력](./CHANGELOG.md)
- [영문 README](./README.md)

## 개발 명령

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

## 라이선스

MIT. 자세한 내용은 [LICENSE](./LICENSE)를 참고하세요.
