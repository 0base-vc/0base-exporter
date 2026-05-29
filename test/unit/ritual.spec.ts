import { register } from "prom-client";
import Ritual from "../../src/availables/testnet/ritual";

type JsonRpcPayload = { method: string; params?: unknown[] };
type JsonRpcTransform = (response: { data: unknown }) => unknown;
type GetTransform = (response: { data: string }) => unknown;
type TestCollector = Ritual & {
  postWithCache: jest.Mock<
    Promise<unknown>,
    [string, JsonRpcPayload, JsonRpcTransform, number?, number?]
  >;
  get: jest.Mock<Promise<unknown>, [string, GetTransform, number?]>;
};

const ADDRESS = "0xFBF57F6b80578F4918684BAbB5dA70Fac504bdB3";
const NODE_PUBKEY = "0xd819a8df40351384466db487458d0b9091c697fd198b05a8729f892c251ae82f";
const CONSENSUS_PUBKEY =
  "0x806215a240f6763570802a48133428d51e2d14a16b9f381579a5c5762f7e2d0537906157478269092243f6edd6ad653c";

function createCollector(): TestCollector {
  return new Ritual(
    "http://ritual-testnet:9001/metrics,http://ritual-testnet:9090/metrics",
    "http://ritual-testnet:3030",
    "",
    ADDRESS,
    "",
  ) as unknown as TestCollector;
}

function installRpcMock(collector: TestCollector): void {
  collector.postWithCache = jest.fn(async (_url, payload, transform): Promise<unknown> => {
    const responses: Record<string, unknown> = {
      eth_chainId: "0x310",
      eth_blockNumber: "0xf0311d",
      net_peerCount: "0x9",
      eth_syncing: false,
      health: "Ok",
      getLatestHeight: 15741290,
      getLatestEpoch: 7870,
      getAllValidators: {
        count: 2,
        validators: [
          {
            node_pubkey: NODE_PUBKEY,
            consensus_pubkey: CONSENSUS_PUBKEY,
            status: "Active",
            balance: 32000000000,
            pending_withdrawal_amount: 0,
            has_pending_withdrawal: false,
            joining_epoch: 7862,
            withdrawal_credentials: ADDRESS.toLowerCase(),
            coinbase_address: ADDRESS,
          },
          {
            node_pubkey: "0x00d21610e478bc59b0c1e70505874e191bf94ab73cb1f9246f963f9bc0a1b253",
            consensus_pubkey:
              "0xb664b8a4148a0ea1e248f0a76d6832dc3fbbf9c8495f560565ca79b20d7f3db174b80376a2e33bbca10372e69903045e",
            status: "Active",
            balance: 64000000000,
            pending_withdrawal_amount: 1000000000,
            has_pending_withdrawal: true,
            joining_epoch: 0,
            withdrawal_credentials: "0xe60dc774077dced3f9ea2c0bde81c2f44f171412",
            coinbase_address: "0xe60dc774077dceD3F9EA2C0bde81c2F44f171412",
            commission_rate: 0.05,
          },
        ],
      },
      getActiveValidators: {
        count: 2,
        validators: [],
      },
    };

    return transform({ data: { result: responses[payload.method] } });
  });
}

describe("Ritual testnet collector", () => {
  const previousEvmApiUrl = process.env.EVM_API_URL;
  const previousCacheMs = process.env.RITUAL_CACHE_MS;
  const previousRpcTimeoutMs = process.env.RITUAL_RPC_TIMEOUT_MS;

  beforeEach(() => {
    register.clear();
    process.env.EVM_API_URL = "http://ritual-testnet:8545";
    delete process.env.RITUAL_CACHE_MS;
    delete process.env.RITUAL_RPC_TIMEOUT_MS;
  });

  afterEach(() => {
    register.clear();
    if (previousEvmApiUrl == null) {
      delete process.env.EVM_API_URL;
    } else {
      process.env.EVM_API_URL = previousEvmApiUrl;
    }
    if (previousCacheMs == null) {
      delete process.env.RITUAL_CACHE_MS;
    } else {
      process.env.RITUAL_CACHE_MS = previousCacheMs;
    }
    if (previousRpcTimeoutMs == null) {
      delete process.env.RITUAL_RPC_TIMEOUT_MS;
    } else {
      process.env.RITUAL_RPC_TIMEOUT_MS = previousRpcTimeoutMs;
    }
  });

  it("emits address, validator, EL, CL, and merged existing metrics", async () => {
    const collector = createCollector();
    installRpcMock(collector);
    jest.spyOn(collector.web3.eth, "getBalance").mockResolvedValue(5000000000000000000n);
    collector.get = jest.fn(async (url, transform) =>
      transform({ data: `# HELP existing Existing metric from ${url}\nexisting_metric 1\n` }),
    );

    const metrics = await collector.makeMetrics();

    expect(metrics).toContain(`ritual_address_available{address="${ADDRESS}",denom="RIT"} 5`);
    expect(metrics).toContain("ritual_execution_layer_chain_id 784");
    expect(metrics).toContain("ritual_execution_layer_latest_block 15741213");
    expect(metrics).toContain('ritual_consensus_layer_health{status="Ok"} 1');
    expect(metrics).toContain("ritual_consensus_layer_latest_epoch 7870");
    expect(metrics).toContain('ritual_validator_count{set="all"} 2');
    expect(metrics).toContain(
      `ritual_validator_info{node_pubkey="${NODE_PUBKEY}",consensus_pubkey="${CONSENSUS_PUBKEY}",status="Active",withdrawal_address="${ADDRESS.toLowerCase()}",fee_recipient="${ADDRESS}",coinbase_address="${ADDRESS}"} 1`,
    );
    expect(metrics).toContain(
      `ritual_validator_stake{node_pubkey="${NODE_PUBKEY}",withdrawal_address="${ADDRESS.toLowerCase()}",fee_recipient="${ADDRESS}",denom="RIT"} 32`,
    );
    expect(metrics).toContain(
      `ritual_validator_commission_available{node_pubkey="${NODE_PUBKEY}"} 0`,
    );
    expect(metrics).toContain("existing_metric 1");
    expect(metrics).toContain(
      "# HELP ritual_execution_layer_up Whether Ritual execution-layer JSON-RPC data is usable, including cached fallback data",
    );
    expect(metrics).toContain(
      "# HELP ritual_consensus_layer_up Whether Ritual consensus-layer JSON-RPC data is usable, including cached fallback data",
    );
  });

  it("can select the configured validator by node public key and emit commission when exposed", async () => {
    const collector = new Ritual(
      "",
      "http://ritual-testnet:3030",
      "",
      "",
      "0x00d21610e478bc59b0c1e70505874e191bf94ab73cb1f9246f963f9bc0a1b253",
    ) as unknown as TestCollector;
    installRpcMock(collector);
    jest.spyOn(collector.web3.eth, "getBalance").mockResolvedValue(0n);

    const metrics = await collector.makeMetrics();

    expect(metrics).toContain(
      'ritual_validator_commission_rate{node_pubkey="0x00d21610e478bc59b0c1e70505874e191bf94ab73cb1f9246f963f9bc0a1b253"} 0.05',
    );
    expect(metrics).toContain(
      'ritual_validator_commission_available{node_pubkey="0x00d21610e478bc59b0c1e70505874e191bf94ab73cb1f9246f963f9bc0a1b253"} 1',
    );
  });

  it("falls back to default cache and timeout values when Ritual env values are invalid", async () => {
    process.env.RITUAL_CACHE_MS = "-1";
    process.env.RITUAL_RPC_TIMEOUT_MS = "1.5";
    const collector = createCollector();
    installRpcMock(collector);
    jest.spyOn(collector.web3.eth, "getBalance").mockResolvedValue(0n);

    await collector.makeMetrics();

    expect(collector.postWithCache).toHaveBeenCalledWith(
      "http://ritual-testnet:8545",
      { method: "eth_chainId", params: [] },
      expect.any(Function),
      30000,
      10000,
    );
  });
});
