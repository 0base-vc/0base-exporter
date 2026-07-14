import { register } from "prom-client";
import GnolandTestnet from "../../src/availables/testnet/gnoland";

type GetWithCacheTransform = (response: { data: unknown }) => unknown;
type TestCollector = GnolandTestnet & {
  getWithCache: jest.Mock<Promise<unknown>, [string, GetWithCacheTransform, number?, number?]>;
  get: jest.Mock<Promise<unknown>, [string, GetWithCacheTransform, number?]>;
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

function createCollector(validator = "g1validator", addresses = ""): TestCollector {
  return new GnolandTestnet(
    "",
    "",
    "https://rpc.example/",
    addresses,
    validator,
  ) as unknown as TestCollector;
}

function installRpcMocks(
  collector: TestCollector,
  validatorsResponse = VALIDATORS_RESPONSE,
  statusResponse = STATUS_RESPONSE,
  additionalResponses: ReadonlyMap<string, unknown> = new Map(),
): void {
  const responses = new Map<string, unknown>([
    ["https://rpc.example/status", statusResponse],
    ["https://rpc.example/net_info", NET_INFO_RESPONSE],
    ["https://rpc.example/validators", validatorsResponse],
    ...additionalResponses,
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

  it("emits operator wallet balances and reports commission field availability", async () => {
    const collector = createCollector("g1validator", "g1operator");
    const balanceData = Buffer.from(JSON.stringify("2500000ugnot,42foo/bar")).toString("base64");
    installRpcMocks(
      collector,
      VALIDATORS_RESPONSE,
      STATUS_RESPONSE,
      new Map([
        [
          "https://rpc.example/abci_query?path=bank%2Fbalances%2Fg1operator",
          {
            result: {
              response: {
                ResponseBase: { Data: balanceData },
              },
            },
          },
        ],
      ]),
    );

    const metrics = await collector.makeMetrics();

    expect(metrics).toContain('gnoland_wallet_query_up{address="g1operator"} 1');
    expect(metrics).toContain(
      'gnoland_address_available{address="g1operator",denom="ugnot"} 2500000',
    );
    expect(metrics).toContain('gnoland_address_available{address="g1operator",denom="foo/bar"} 42');
    expect(metrics).toContain('gnoland_validator_commission_available{validator="g1validator"} 0');
  });

  it("tracks signed, missed, and proposed blocks for the configured validator", async () => {
    const collector = createCollector();
    const statusResponse = {
      ...STATUS_RESPONSE,
      result: {
        ...STATUS_RESPONSE.result,
        sync_info: {
          ...STATUS_RESPONSE.result.sync_info,
          latest_block_height: "3",
        },
      },
    };
    installRpcMocks(collector, VALIDATORS_RESPONSE, statusResponse);

    const commit = (height: number, signed: boolean, proposed = false) => ({
      result: {
        signed_header: {
          header: {
            height: String(height),
            proposer_address: proposed ? "g1validator" : "g1other",
            validators_hash: "validator-set-a",
          },
          commit: {
            precommits: signed ? [{ validator_address: "g1validator" }] : [null],
          },
        },
      },
    });
    const responses = new Map<string, unknown>([
      ["https://rpc.example/commit?height=1", commit(1, true)],
      ["https://rpc.example/commit?height=2", commit(2, false)],
      ["https://rpc.example/commit?height=3", commit(3, true, true)],
      [
        "https://rpc.example/validators?height=1&page=1&per_page=100",
        {
          result: {
            total: "2",
            validators: [{ address: "g1other" }],
          },
        },
      ],
      [
        "https://rpc.example/validators?height=1&page=2&per_page=100",
        {
          result: {
            total: "2",
            validators: [{ address: "g1validator" }],
          },
        },
      ],
    ]);

    collector.get = jest.fn(async (url, transform) => {
      if (!responses.has(url)) {
        throw new Error(`Unexpected URL ${url}`);
      }

      return transform({ data: responses.get(url) });
    });

    await collector.start();
    try {
      const metrics = await collector.makeMetrics();

      expect(metrics).toContain('gnoland_validator_signing_tracker_up{validator="g1validator"} 1');
      expect(metrics).toContain(
        'gnoland_validator_signing_window_blocks{validator="g1validator"} 3',
      );
      expect(metrics).toContain('gnoland_validator_signed_blocks{validator="g1validator"} 2');
      expect(metrics).toContain('gnoland_validator_missed_blocks{validator="g1validator"} 1');
      expect(metrics).toContain(
        'gnoland_validator_miss_rate{validator="g1validator"} 0.3333333333333333',
      );
      expect(metrics).toContain(
        'gnoland_validator_consecutive_missed_blocks{validator="g1validator"} 0',
      );
      expect(metrics).toContain('gnoland_validator_last_signed_height{validator="g1validator"} 3');
      expect(metrics).toContain('gnoland_validator_last_missed_height{validator="g1validator"} 2');
      expect(metrics).toContain('gnoland_validator_proposed_blocks{validator="g1validator"} 1');
      expect(metrics).toContain('gnoland_validator_signed_latest{validator="g1validator"} 1');
      expect(collector.get).toHaveBeenCalledWith(
        "https://rpc.example/validators?height=1&page=2&per_page=100",
        expect.any(Function),
        10000,
      );
    } finally {
      await collector.stop();
    }
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
