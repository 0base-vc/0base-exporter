# 0Base Exporter

[![CI](https://github.com/0base-vc/0base-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/0base-vc/0base-exporter/actions/workflows/ci.yml)
[![Release](https://github.com/0base-vc/0base-exporter/actions/workflows/release.yml/badge.svg)](https://github.com/0base-vc/0base-exporter/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js >=20.19.0](https://img.shields.io/badge/node-%3E%3D20.19.0-339933)](./package.json)

[English README](./README.md)

![0Base Exporter 로고](./0base-exporter.png)

Cosmos/Tendermint, Solana, EVM 계열 네트워크의 지갑·검증자 메트릭을 Prometheus 형식으로 노출하는 exporter입니다.

0Base Exporter는 안정적인 `GET /metrics` 엔드포인트와 레거시 환경변수 사용법을 유지하면서, 체인별 검증자 관측을 작은 Node.js 프로세스 하나로 실행할 수 있게 합니다.

## 왜 사용하나요

- 검증자, 지갑, staking, epoch, 체인별 메트릭을 Prometheus 형식으로 내보냅니다.
- Cosmos/Tendermint, Solana, EVM 계열 collector를 같은 런타임 계약으로 실행합니다.
- 기존 `BLOCKCHAIN=./availables/...` 배포를 유지하면서 새 배포는 `CHAIN`으로 이동할 수 있습니다.
- 로컬과 GitHub Actions에서 같은 품질 게이트인 `npm run ci:verify`를 사용합니다.

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
curl http://localhost:27770/healthz
curl http://localhost:27770/metrics
```

체인별 예제 env 파일은 [examples/env](./examples/env)에서 바로 사용할 수 있습니다.

## 체인 선택

가능하면 `BLOCKCHAIN` 대신 `CHAIN`을 사용하세요.

| 계열                | 권장 `CHAIN` 값                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cosmos / Tendermint | `tendermint`, `tendermint-v1`, `tendermint-v1beta1`, `terra`, `terra-v2`, `atomone`, `tendermint-umee`, `tendermint-tgrade`, `gnoland-testnet`, `initia-testnet` |
| Solana              | `solana`, `solana-testnet`                                                                                                                                       |
| EVM / Hybrid        | `monad`, `monad-testnet`, `berachain`, `mitosis`, `mitosis-testnet`, `story-testnet`, `ritual-testnet`, `canopy-testnet`                                         |

기존 `BLOCKCHAIN=./availables/...` 값도 계속 지원됩니다.

## 주요 설정

| 변수                   | 설명                                                |
| ---------------------- | --------------------------------------------------- |
| `PORT`                 | HTTP listen port. 기본값은 `27770`입니다.           |
| `CHAIN`                | 권장 collector id입니다.                            |
| `BLOCKCHAIN`           | 호환성을 위해 유지되는 레거시 module-path selector. |
| `API_URL`              | Cosmos 계열 collector의 REST API base URL.          |
| `RPC_URL`              | Cosmos 또는 Solana collector의 RPC endpoint.        |
| `EVM_API_URL`          | EVM 계열 collector의 JSON-RPC endpoint.             |
| `ADDRESS`              | Solana 외 collector의 지갑/delegator 주소 목록.     |
| `VALIDATOR`            | Solana 외 collector의 validator 주소 목록.          |
| `VOTE`                 | Solana vote account 목록.                           |
| `IDENTITY`             | Solana identity account 목록.                       |
| `EXISTING_METRICS_URL` | 기존 Prometheus endpoint를 merge할 때 사용합니다.   |
| `ENABLE_PROM_PERF`     | 내부 metric timing instrumentation opt-in 설정.     |

## 주요 문서

- [빠른 시작](./docs/ko/quickstart.md)
- [설정 레퍼런스](./docs/ko/configuration.md)
- [지원 체인](./docs/ko/supported-chains.md)
- [예제](./docs/ko/examples.md)
- [아키텍처](./docs/ko/architecture.md)
- [메트릭 호환성 정책](./docs/ko/metrics-policy.md)
- [문제 해결](./docs/ko/troubleshooting.md)
- [릴리스 정책](./docs/ko/release-policy.md)
- [변경 이력](./CHANGELOG.md)

## 기여와 지원

프로덕션 Prometheus 설정이 의존하는 exporter 계약을 지키는 방향의 기여를 환영합니다.

- 기여 전 [CONTRIBUTING.md](./CONTRIBUTING.md)를 확인하세요.
- 버그, 기능 제안, 체인 지원 요청, 문서 이슈, 공개 가능한 질문은 GitHub Issues를 사용하세요.
- 지원 범위는 [SUPPORT.md](./SUPPORT.md)를 참고하세요.
- 보안 취약점은 공개 issue가 아니라 [SECURITY.md](./SECURITY.md)에 따라 신고하세요.

## 개발 명령

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run ci:verify
```

## 라이선스

MIT. 자세한 내용은 [LICENSE](./LICENSE)를 참고하세요.
