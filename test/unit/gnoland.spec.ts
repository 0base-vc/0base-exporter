import { register } from "prom-client";
import GnolandTestnet from "../../src/availables/testnet/gnoland";

type GetWithCacheTransform = (response: { data: unknown }) => unknown;
type TestCollector = GnolandTestnet & {
  getWithCache: jest.Mock<Promise<unknown>, [string, GetWithCacheTransform, number?, number?]>;
};

const STATUS_RESPONSE = {
  result: {
    node_info: {
      moniker: "gno-node",
      network: "test-13",
      version: "0.2.0",
    },
    sync_info: {
      latest_block_height: "123",
      latest_block_time: "2026-06-24T00:00:00Z",
      catching_up: false,
    },
  },
};

const NET_INFO_RESPONSE = {
  result: {
    n_peers: "2",
    listening: true,
  },
};

const VALIDATORS_RESPONSE = {
  result: {
    block_height: "122",
    validators: [
      {
        address: "g1top",
        pub_key: {
          "@type": "/tm.PubKeyEd25519",
          value: "top-key",
        },
        voting_power: "10",
      },
      {
        address: "g1validator",
        pub_key: {
          "@type": "/tm.PubKeyEd25519",
          value: "validator-key",
        },
        voting_power: "5",
      },
      {
        address: "g1below",
        pub_key: {
          "@type": "/tm.PubKeyEd25519",
          value: "below-key",
        },
        voting_power: "1",
      },
    ],
  },
};

function createCollector(validator = "g1validator"): TestCollector {
  return new GnolandTestnet(
    "",
    "",
    "https://rpc.example/",
    "",
    validator,
  ) as unknown as TestCollector;
}

function installRpcMocks(collector: TestCollector, validatorsResponse = VALIDATORS_RESPONSE): void {
  const responses = new Map<string, unknown>([
    ["https://rpc.example/status", STATUS_RESPONSE],
    ["https://rpc.example/net_info", NET_INFO_RESPONSE],
    ["https://rpc.example/validators", validatorsResponse],
  ]);

  collector.getWithCache = jest.fn(async (url, transform) => {
    if (!responses.has(url)) {
      throw new Error(`Unexpected URL ${url}`);
    }

    return transform({ data: responses.get(url) });
  });
}

describe("Gnoland testnet collector", () => {
  beforeEach(() => {
    register.clear();
  });

  afterEach(() => {
    register.clear();
  });

  it("emits RPC, sync, peer, validator rank, and voting power metrics", async () => {
    const collector = createCollector();
    installRpcMocks(collector);

    const metrics = await collector.makeMetrics();
    const latestBlockTimeSeconds = Math.floor(Date.parse("2026-06-24T00:00:00Z") / 1000);

    expect(metrics).toContain("gnoland_rpc_up 1");
    expect(metrics).toContain(
      'gnoland_network_info{network="test-13",moniker="gno-node",version="0.2.0"} 1',
    );
    expect(metrics).toContain("gnoland_latest_block_height 123");
    expect(metrics).toContain(`gnoland_latest_block_time_seconds ${latestBlockTimeSeconds}`);
    expect(metrics).toContain("gnoland_catching_up 0");
    expect(metrics).toContain("gnoland_peer_count 2");
    expect(metrics).toContain("gnoland_listening 1");
    expect(metrics).toContain("gnoland_validator_set_block_height 122");
    expect(metrics).toContain("gnoland_active_validators 3");
    expect(metrics).toContain('gnoland_validator_voting_power{validator="g1validator"} 5');
    expect(metrics).toContain('gnoland_validator_active{validator="g1validator"} 1');
    expect(metrics).toContain('gnoland_validator_rank{validator="g1validator"} 2');
    expect(metrics).toContain('gnoland_validator_power_rivals{rank="above"} 10');
    expect(metrics).toContain('gnoland_validator_power_rivals{rank="below"} 1');
    expect(metrics).toContain('gnoland_validators_power{address="g1top"} 10');
    expect(metrics).toContain(
      'gnoland_validator_info{address="g1validator",pub_key_type="/tm.PubKeyEd25519",pub_key="validator-key"} 1',
    );
  });

  it("marks a missing configured validator as inactive without throwing", async () => {
    const collector = createCollector("g1missing");
    installRpcMocks(collector);

    const metrics = await collector.makeMetrics();

    expect(metrics).toContain('gnoland_validator_voting_power{validator="g1missing"} 0');
    expect(metrics).toContain('gnoland_validator_active{validator="g1missing"} 0');
    expect(metrics).toContain('gnoland_validator_rank{validator="g1missing"} 0');
    expect(metrics).toContain('gnoland_validator_power_rivals{rank="above"} 0');
    expect(metrics).toContain('gnoland_validator_power_rivals{rank="below"} 0');
  });

  it("sets the RPC up metric to zero when RPC data cannot be fetched", async () => {
    const collector = createCollector();
    collector.getWithCache = jest.fn(async (_url, _transform) => {
      throw new Error("RPC unavailable");
    });

    const metrics = await collector.makeMetrics();

    expect(metrics).toContain("gnoland_rpc_up 0");
  });
});
