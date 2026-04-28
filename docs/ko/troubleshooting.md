# 문제 해결

## 시작 시 설정 오류가 발생하는 경우

새 런타임 설정 레이어는 서버를 열기 전에 필수 변수를 검증합니다. 에러 메시지에 어떤 변수가 빠졌는지 그대로 표시됩니다.

## `GET /metrics`가 500을 반환하는 경우

- upstream RPC / REST가 실제로 열려 있는지 확인하세요.
- 선택한 `CHAIN`과 주소 종류(`ADDRESS`/`VOTE`, `VALIDATOR`/`IDENTITY`)가 맞는지 확인하세요.
- 같은 환경변수로 로컬 실행 후 로그를 확인하세요.

## 레거시 `BLOCKCHAIN` 경로가 동작하지 않는 경우

가능하면 `CHAIN`을 사용하세요. 레거시 경로는 normalization 후 registry에 있는 값만 허용됩니다.

## 메트릭 회귀를 비교하고 싶은 경우

`npm test`를 실행하면 fixture 기반 metric snapshot이 함께 검증됩니다.
