import { register } from "prom-client";
import Mitosis from "../../src/availables/mitosis";

type Selector = (response: { data: unknown }) => unknown;
type ValidatorInfoResult = {
  metadata: string;
  commissionRate: string;
  pendingCommissionRate: string;
  pendingCommissionRateUpdateEpoch: string;
};
type ValidatorManagerContract = {
  methods: {
    validatorInfo(address: string): {
      call(): Promise<ValidatorInfoResult>;
    };
  };
};
type TestCollector = {
  registry: { metrics(): Promise<string> };
  get: jest.Mock<Promise<unknown>, [string, Selector]>;
  updateEvmAddressBalance(addresses: string): Promise<void>;
  updateValidatorsPower(): Promise<void>;
  validatorManagerContract?: ValidatorManagerContract;
  web3: { eth: object };
  getEVMAmount: jest.Mock<Promise<{ amount: number }>, [string]>;
};

const API_URL = "https://api.example";
const VALIDATOR = "0xValidator";
const OWNER = "0xOwner";

function metadataHex(name: string): string {
  return `0x${Buffer.from(JSON.stringify({ name }), "utf8").toString("hex")}`;
}

function createCollector(): TestCollector {
  return new Mitosis(
    "",
    API_URL,
    "https://rpc.example",
    OWNER,
    VALIDATOR,
  ) as unknown as TestCollector;
}

function setValidatorInfoResult(collector: TestCollector): void {
  collector.validatorManagerContract = {
    methods: {
      validatorInfo: jest.fn(() => ({
        call: jest.fn(async () => ({
          metadata: metadataHex("Validator One"),
          commissionRate: "750",
          pendingCommissionRate: "800",
          pendingCommissionRateUpdateEpoch: "42",
        })),
      })),
    },
  };
}

describe("Mitosis collector", () => {
  const previousEvmApiUrl = process.env.EVM_API_URL;

  beforeEach(() => {
    register.clear();
    process.env.EVM_API_URL = "http://127.0.0.1:8545";
  });

  afterEach(() => {
    register.clear();
    if (previousEvmApiUrl == null) {
      delete process.env.EVM_API_URL;
    } else {
      process.env.EVM_API_URL = previousEvmApiUrl;
    }
  });

  it("emits validator power and commission metrics from the evmvalidator API", async () => {
    const collector = createCollector();
    setValidatorInfoResult(collector);
    collector.get = jest.fn(async (url: string, selector: Selector) => {
      expect(url).toBe(`${API_URL}/mitosis/evmvalidator/v1/validators?pagination.limit=1000`);
      return selector({
        data: {
          validators: [
            {
              addr: VALIDATOR,
              collateral: "1000",
              collateral_shares: "123",
              extra_voting_power: "5",
              voting_power: "9",
            },
          ],
        },
      });
    });

    await collector.updateValidatorsPower();

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain(`tendermint_validators_power{address="${VALIDATOR}"} 123`);
    expect(metrics).toContain(
      `tendermint_validators_collateral{address="${VALIDATOR}",moniker="Validator One"} 1000`,
    );
    expect(metrics).toContain(
      `tendermint_validators_extra_voting_power{address="${VALIDATOR}",moniker="Validator One"} 5`,
    );
    expect(metrics).toContain(
      `tendermint_validators_voting_power{address="${VALIDATOR}",moniker="Validator One"} 9`,
    );
    expect(metrics).toContain(
      `tendermint_validators_commission_rate{address="${VALIDATOR}",moniker="Validator One"} 7.5`,
    );
    expect(metrics).toContain(
      `tendermint_validators_pending_commission_rate{address="${VALIDATOR}",moniker="Validator One"} 8`,
    );
    expect(metrics).toContain(
      `tendermint_validators_pending_commission_rate_update_epoch{address="${VALIDATOR}",moniker="Validator One"} 42`,
    );
  });

  it("falls back to the configured validator when the validators list is empty", async () => {
    const collector = createCollector();
    setValidatorInfoResult(collector);
    collector.get = jest.fn(async (url: string, selector: Selector) => {
      if (url === `${API_URL}/mitosis/evmvalidator/v1/validators?pagination.limit=1000`) {
        return selector({ data: { validators: [] } });
      }

      if (url === `${API_URL}/mitosis/evmvalidator/v1/validators/${VALIDATOR}`) {
        return selector({
          data: {
            validator: {
              addr: VALIDATOR,
              collateral: "1000",
              collateral_shares: "123",
              extra_voting_power: "5",
              voting_power: "9",
            },
          },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await collector.updateValidatorsPower();

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain(`tendermint_validators_power{address="${VALIDATOR}"} 123`);
    expect(metrics).toContain(
      `tendermint_validators_commission_rate{address="${VALIDATOR}",moniker="Validator One"} 7.5`,
    );
  });

  it("emits the gMITO ERC20 balance gauge", async () => {
    const collector = createCollector();
    collector.getEVMAmount = jest.fn(async (_address: string) => ({ amount: 1 }));
    const fakeContract = jest.fn(() => ({
      methods: {
        decimals: jest.fn(() => ({ call: jest.fn(async () => 18) })),
        balanceOf: jest.fn(() => ({
          call: jest.fn(async () => 2500000000000000000n),
        })),
      },
    }));
    Object.defineProperty(collector.web3.eth, "Contract", {
      configurable: true,
      value: fakeContract,
    });

    await collector.updateEvmAddressBalance(OWNER);

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain(
      `tendermint_erc20_balance{address="${OWNER}",contractAddress="0x1248163272144FdbBbE6D1a8c43Ca56DE9bD5cEA",token="gMITO",symbol="gMITO"} 2.5`,
    );
  });
});
