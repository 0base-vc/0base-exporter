import TargetAbstract from "../../target.abstract";
import { Gauge, Registry } from "prom-client";
import axios from "axios";
import { toDecimal } from "../../core/decimal";
import { getDecimalPlaces } from "../../core/runtime-env";

function scaleAmount(value: string | number | undefined, decimals: number): number {
  return toDecimal(String(value ?? 0), decimals);
}

export default class Canopy extends TargetAbstract {
  private readonly decimalPlaces = getDecimalPlaces(6);
  protected readonly metricPrefix = "canopy";
  protected readonly registry = new Registry();
  private readonly maxPerPage = 5000;

  protected readonly availableGauge = new Gauge({
    name: `${this.metricPrefix}_address_available`,
    help: "Available balance of address",
    labelNames: ["address", "denom"],
  });
  protected readonly rankGauge = new Gauge({
    name: `${this.metricPrefix}_validator_rank`,
    help: "Your rank of validators",
    labelNames: ["validator"],
  });
  protected readonly rivalsPowerGauge = new Gauge({
    name: `${this.metricPrefix}_validator_power_rivals`,
    help: "Voting power of Rivals",
    labelNames: ["rank"],
  });
  protected readonly maxValidatorGauge = new Gauge({
    name: `${this.metricPrefix}_staking_parameters_max_validator_count`,
    help: "Limitation of validators count",
  });
  protected readonly proposalsGauge = new Gauge({
    name: `${this.metricPrefix}_gov_proposals_count`,
    help: "Gov voting period proposals count",
  });

  public constructor(
    protected readonly existMetrics: string,
    protected readonly apiUrl: string,
    protected readonly rpcUrl: string,
    protected readonly addresses: string,
    protected readonly validator: string,
  ) {
    super(existMetrics, apiUrl, rpcUrl, addresses, validator);
    this.registry.registerMetric(this.availableGauge);
    this.registry.registerMetric(this.rankGauge);
    this.registry.registerMetric(this.rivalsPowerGauge);
    this.registry.registerMetric(this.maxValidatorGauge);
    this.registry.registerMetric(this.proposalsGauge);
  }

  public async makeMetrics(): Promise<string> {
    let customMetrics = "";
    try {
      await Promise.all([
        this.updateAddressBalance(this.addresses),
        this.updateRank(this.validator),
        this.updateMaxValidator(),
        this.updateProposalsCount(),
      ]);
      customMetrics = await this.registry.metrics();
    } catch (e) {
      console.error("makeMetrics", e);
    }
    return customMetrics + "\n" + (await this.loadExistMetrics());
  }

  // Canopy는 위임/언본딩/리워드 개념이 없으므로 0으로 처리
  protected async updateAddressBalance(addresses: string): Promise<void> {
    for (const address of addresses.split(",").filter((address) => !address.startsWith("0x"))) {
      // 잔액 조회
      try {
        const res = await axios.post(`${this.apiUrl}/v1/query/account`, { address });
        const amount = scaleAmount(res.data.amount, this.decimalPlaces);
        this.availableGauge.labels(address, "uCNPY").set(amount);
      } catch (e) {
        console.error("updateAddressBalance: available", address, e);
        this.availableGauge.labels(address, "uCNPY").set(0);
      }
    }
  }

  // Validator 랭킹 및 rivals power
  protected async updateRank(validator: string): Promise<void> {
    try {
      const validators = await this.fetchAllValidators(0);
      // stakedAmount 내림차순 정렬
      const sorted = validators
        .filter((v) => v && typeof v === "object")
        .map((v) => ({ ...v, stakedAmount: Number((v as any).stakedAmount ?? 0) }))
        .sort((a, b) => Number(b.stakedAmount) - Number(a.stakedAmount));

      if (sorted.length === 0) {
        this.rankGauge.labels(validator).set(0);
        this.rivalsPowerGauge.labels("above").set(0);
        this.rivalsPowerGauge.labels("below").set(0);
        return;
      }

      const normalizedValidator = (validator || "").toLowerCase().replace(/^0x/, "");
      const idx = sorted.findIndex(
        (v) =>
          String((v as any).address || "")
            .toLowerCase()
            .replace(/^0x/, "") === normalizedValidator,
      );

      if (idx < 0) {
        // validator not found in the returned page(s)
        this.rankGauge.labels(validator).set(0);
        this.rivalsPowerGauge.labels("above").set(0);
        this.rivalsPowerGauge.labels("below").set(0);
        return;
      }

      const rank = idx + 1;
      const me = sorted[idx];
      const above = sorted[idx - 1] ?? me;
      const below = sorted[idx + 1] ?? { stakedAmount: 0 };

      this.rankGauge.labels(validator).set(rank);
      this.rivalsPowerGauge
        .labels("above")
        .set(scaleAmount((above as any)?.stakedAmount, this.decimalPlaces));
      this.rivalsPowerGauge
        .labels("below")
        .set(scaleAmount((below as any)?.stakedAmount, this.decimalPlaces));
    } catch (e) {
      console.error("updateRank", validator, e);
      this.rankGauge.labels(validator).set(0);
      this.rivalsPowerGauge.labels("above").set(0);
      this.rivalsPowerGauge.labels("below").set(0);
    }
  }

  private async fetchAllValidators(height: number): Promise<any[]> {
    const url = `${this.apiUrl}/v1/query/validators`;

    // API.md uses pageNumber; some implementations use page. Try both and fall back.
    const pageKeyCandidates: Array<"pageNumber" | "page"> = ["pageNumber", "page"];
    for (const pageKey of pageKeyCandidates) {
      try {
        const first = await axios.post(url, { height, perPage: this.maxPerPage, [pageKey]: 1 });
        const firstData = first.data || {};
        const firstResults: any[] = Array.isArray(firstData.results) ? firstData.results : [];
        const totalPages = Number(firstData.totalPages || 1);

        if (!Number.isFinite(totalPages) || totalPages <= 1) return firstResults;

        const all = [...firstResults];
        for (let page = 2; page <= totalPages; page++) {
          const res = await axios.post(url, { height, perPage: this.maxPerPage, [pageKey]: page });
          const data = res.data || {};
          const results: any[] = Array.isArray(data.results) ? data.results : [];
          all.push(...results);
        }
        return all;
      } catch {
        // try next page key
      }
    }

    // Some nodes accept perPage but ignore/forbid page keys.
    try {
      const res = await axios.post(url, { height, perPage: this.maxPerPage });
      const data = res.data || {};
      return Array.isArray(data.results) ? data.results : [];
    } catch {
      // continue
    }

    // Last resort: whatever the node returns with minimal request.
    const res = await axios.post(url, { height });
    const data = res.data || {};
    return Array.isArray(data.results) ? data.results : [];
  }

  // 최대 validator 수
  protected async updateMaxValidator(): Promise<void> {
    try {
      const res = await axios.post(`${this.apiUrl}/v1/query/params`, { height: 0 });
      const max = res.data.validator?.maxCommitteeSize
        ? Number(res.data.validator.maxCommitteeSize)
        : 0;
      this.maxValidatorGauge.set(max);
    } catch (e) {
      console.error("updateMaxValidator", e);
      this.maxValidatorGauge.set(0);
    }
  }

  // proposal 개수
  private async updateProposalsCount(): Promise<void> {
    try {
      const res = await axios.get(`${this.apiUrl}/v1/gov/proposals`);
      const data = res.data;
      // API.md documents this response as a map[proposalHashHex] -> object.
      const count = Array.isArray(data)
        ? data.length
        : data && Array.isArray(data.proposals)
          ? data.proposals.length
          : data && data.proposals && typeof data.proposals === "object"
            ? Object.keys(data.proposals).length
            : data && typeof data === "object"
              ? Object.keys(data).length
              : 0;
      this.proposalsGauge.set(count);
    } catch (e) {
      console.error("updateProposalsCount", e);
      this.proposalsGauge.set(0);
    }
  }
}
