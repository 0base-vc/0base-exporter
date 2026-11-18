import Pharos from "../../src/availables/pharos";
import { loadRuntimeConfig } from "../../src/core/config";
import { createCollector, resolveChainProfile } from "../../src/core/collector-registry";
import { logger } from "../../src/core/logger";

const RPC = "http://pharos-rpc.example";
const POOL_ID = `0x${"12".repeat(32)}`;
const SECOND_POOL_ID = `0x${"34".repeat(32)}`;
const OWNER = "0x1234567890123456789012345678901234567890";

class StubPharos extends Pharos {
  public ownerLookups: string[] = [];
  public rewardLookups: Array<{ poolId: string; owner: string }> = [];
  public commissionLookups: string[] = [];
  public ownerForPool = new Map<string, string>([[POOL_ID, OWNER]]);
  public rewardsForPool = new Map<string, bigint | number | string>([
    [POOL_ID, "1230000000000000000"],
  ]);
  public commissionForPool = new Map<string, bigint | number | string>([[POOL_ID, "125"]]);
  public failedPools = new Set<string>();

  protected override async readValidatorOwner(poolId: string): Promise<string> {
    this.ownerLookups.push(poolId);
    if (this.failedPools.has(poolId)) {
      throw new Error("RPC unavailable");
    }
    return this.ownerForPool.get(poolId) ?? OWNER;
  }

  protected override async readOwnerUnclaimedRewards(
    poolId: string,
    owner: string,
  ): Promise<bigint | number | string> {
    this.rewardLookups.push({ poolId, owner });
    return this.rewardsForPool.get(poolId) ?? 0n;
  }

  protected override async readCommissionRate(poolId: string): Promise<bigint | number | string> {
    this.commissionLookups.push(poolId);
    return this.commissionForPool.get(poolId) ?? 0n;
  }
}

function collector(validator = POOL_ID) {
  return new StubPharos("", "", "", "", validator, RPC);
}

describe("Pharos collector", () => {
  it("registers the mainnet profile and requires its RPC and pool ID", () => {
    expect(resolveChainProfile("pharos").id).toBe("pharos");
    expect(resolveChainProfile("pharos-mainnet").id).toBe("pharos");
    expect(resolveChainProfile("./availables/pharos.js").id).toBe("pharos");

    const config = loadRuntimeConfig({ CHAIN: "pharos", EVM_API_URL: RPC, VALIDATOR: POOL_ID });
    expect(config.chainId).toBe("pharos");
    expect(config.collectorValidator).toBe(POOL_ID);
    expect(createCollector({ config, logger })).toBeInstanceOf(Pharos);
    expect(() => loadRuntimeConfig({ CHAIN: "pharos", VALIDATOR: POOL_ID })).toThrow("EVM_API_URL");
    expect(() => loadRuntimeConfig({ CHAIN: "pharos", EVM_API_URL: RPC })).toThrow(
      "COLLECTOR_VALIDATOR",
    );
  });

  it("validates and deduplicates configured bytes32 pool IDs", async () => {
    expect(() => collector("not-a-pool-id")).toThrow("bytes32 hex");
    expect(() => collector(" ")).toThrow("one or more Pharos validator pool IDs");
    const target = collector(`${POOL_ID}, ${POOL_ID}`);

    await target.makeMetrics();

    expect(target.ownerLookups).toEqual([POOL_ID]);
  });

  it("exports owner rewards in PROS, commission percent, and pool availability", async () => {
    const target = collector(`${POOL_ID},${SECOND_POOL_ID}`);
    target.rewardsForPool.set(SECOND_POOL_ID, 0n);
    target.commissionForPool.set(SECOND_POOL_ID, 0n);

    const result = await target.makeMetrics();

    expect(result).toContain(
      `pharos_validator_owner_unclaimed_rewards_pros{pool_id="${POOL_ID}"} 1.23`,
    );
    expect(result).toContain(`pharos_validator_commission_rate_percent{pool_id="${POOL_ID}"} 1.25`);
    expect(result).toContain(
      `pharos_validator_unclaimed_rewards_available{pool_id="${POOL_ID}"} 1`,
    );
    expect(result).toContain(
      `pharos_validator_owner_unclaimed_rewards_pros{pool_id="${SECOND_POOL_ID}"} 0`,
    );
    expect(result).toContain(
      `pharos_validator_unclaimed_rewards_available{pool_id="${SECOND_POOL_ID}"} 1`,
    );
    expect(target.rewardLookups).toContainEqual({ poolId: POOL_ID, owner: OWNER });
  });

  it("marks failed pools unavailable and omits reward and commission samples", async () => {
    const target = collector();
    target.failedPools.add(POOL_ID);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await target.makeMetrics();

    expect(result).toContain(
      `pharos_validator_unclaimed_rewards_available{pool_id="${POOL_ID}"} 0`,
    );
    expect(result).not.toContain(
      `pharos_validator_owner_unclaimed_rewards_pros{pool_id="${POOL_ID}"}`,
    );
    expect(result).not.toContain(`pharos_validator_commission_rate_percent{pool_id="${POOL_ID}"}`);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
