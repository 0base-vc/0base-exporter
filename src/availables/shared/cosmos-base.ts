import * as _ from "lodash";
import { Gauge, Registry } from "prom-client";
import TargetAbstract from "../../target.abstract";
import { toDecimal } from "../../core/decimal";
import { getDecimalPlaces } from "../../core/runtime-env";

type AmountLike = { denom?: string; amount: number | string };
type AmountSelector = (json: any) => AmountLike[];

interface ValidatorsPowerItem {
  address: string;
  power: number | string;
}

interface RankItem {
  operatorAddress: string;
  tokens: number;
}

interface AmountRequestProfile {
  url: (apiUrl: string, address: string) => string;
  selector: AmountSelector;
}

interface CommissionRequestProfile {
  url: (apiUrl: string, validator: string) => string;
  selector: AmountSelector;
}

interface RankProfile {
  url: (apiUrl: string) => string;
  selector: (json: any) => RankItem[];
  includeRivalsPower?: boolean;
}

interface NumericValueProfile {
  url: (apiUrl: string) => string | null;
  selector: (json: any) => number;
  fallbackValue?: number;
}

interface ValidatorsPowerProfile {
  url: (apiUrl: string, rpcUrl: string) => string;
  selector: (json: any) => ValidatorsPowerItem[];
}

export interface CosmosCollectorProfile {
  filterAddress?: (address: string) => boolean;
  balances: AmountRequestProfile;
  delegations: AmountRequestProfile;
  unbondings: AmountRequestProfile;
  rewards: AmountRequestProfile;
  commission: CommissionRequestProfile;
  rank: RankProfile;
  maxValidators: NumericValueProfile;
  proposals: NumericValueProfile;
  validatorsPower?: ValidatorsPowerProfile;
}

function normalizeAmount(amount: number | string, decimals: number = 0): number {
  if (typeof amount === "number") {
    return decimals > 0 ? amount / 10 ** decimals : amount;
  }

  const normalized = amount.trim();
  if (normalized.includes(".")) {
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed / 10 ** decimals : 0;
  }

  return toDecimal(normalized, decimals);
}

function normalizeInteger(value: number | string): number {
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export default abstract class CosmosCollectorBase extends TargetAbstract {
  protected readonly decimalPlaces = getDecimalPlaces(6);
  protected readonly metricPrefix = "tendermint";
  protected readonly registry = new Registry();

  protected readonly availableGauge = new Gauge({
    name: `${this.metricPrefix}_address_available`,
    help: "Available balance of address",
    labelNames: ["address", "denom"],
  });

  protected readonly delegatedGauge = new Gauge({
    name: `${this.metricPrefix}_address_delegated`,
    help: "Delegated balance of address",
    labelNames: ["address", "denom"],
  });

  protected readonly unbondingGauge = new Gauge({
    name: `${this.metricPrefix}_address_unbonding`,
    help: "Unbonding balance of address",
    labelNames: ["address", "denom"],
  });

  protected readonly rewardsGauge = new Gauge({
    name: `${this.metricPrefix}_address_rewards`,
    help: "Rewards of address",
    labelNames: ["address", "denom"],
  });

  protected readonly commissionGauge = new Gauge({
    name: `${this.metricPrefix}_address_commission`,
    help: "Commission balance of address",
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

  private readonly maybeValidatorsGauge?: Gauge;

  protected constructor(
    existMetrics: string,
    apiUrl: string,
    rpcUrl: string,
    addresses: string,
    validator: string,
    protected readonly profile: CosmosCollectorProfile,
  ) {
    super(existMetrics, apiUrl, rpcUrl, addresses, validator);

    this.registry.registerMetric(this.availableGauge);
    this.registry.registerMetric(this.delegatedGauge);
    this.registry.registerMetric(this.unbondingGauge);
    this.registry.registerMetric(this.rewardsGauge);
    this.registry.registerMetric(this.commissionGauge);
    this.registry.registerMetric(this.rankGauge);
    this.registry.registerMetric(this.rivalsPowerGauge);
    this.registry.registerMetric(this.maxValidatorGauge);
    this.registry.registerMetric(this.proposalsGauge);

    if (profile.validatorsPower) {
      this.maybeValidatorsGauge = new Gauge({
        name: `${this.metricPrefix}_validators_power`,
        help: "Validators power",
        labelNames: ["address"],
      });
      this.registry.registerMetric(this.maybeValidatorsGauge);
    }
  }

  protected get validatorsGauge(): Gauge {
    if (!this.maybeValidatorsGauge) {
      throw new Error(
        "validatorsGauge is only available for collectors with validatorsPower support",
      );
    }

    return this.maybeValidatorsGauge;
  }

  public async makeMetrics(): Promise<string> {
    let customMetrics = "";

    try {
      const tasks: Array<Promise<void>> = [
        this.updateAddressBalance(this.addresses),
        this.updateRank(this.validator),
        this.updateMaxValidator(),
        this.updateProposalsCount(),
      ];

      if (this.profile.validatorsPower) {
        tasks.push(this.updateValidatorsPower());
      }

      await Promise.all(tasks);
      customMetrics = await this.registry.metrics();
    } catch (error) {
      console.error("makeMetrics", error);
    }

    return customMetrics + "\n" + (await this.loadExistMetrics());
  }

  protected async updateAddressBalance(addresses: string): Promise<void> {
    const addressesToScan = addresses
      .split(",")
      .map((address) => address.trim())
      .filter(Boolean)
      .filter((address) =>
        this.profile.filterAddress ? this.profile.filterAddress(address) : true,
      );

    for (const address of addressesToScan) {
      const available = await this.getAmount(
        this.profile.balances.url(this.apiUrl, address),
        this.profile.balances.selector,
        this.decimalPlaces,
      );
      available.forEach((entry) => {
        this.availableGauge.labels(address, entry.denom).set(entry.amount);
      });

      const delegated = await this.getAmount(
        this.profile.delegations.url(this.apiUrl, address),
        this.profile.delegations.selector,
        this.decimalPlaces,
      );
      delegated.forEach((entry) => {
        this.delegatedGauge.labels(address, entry.denom).set(entry.amount);
      });

      const unbonding = await this.getAmount(
        this.profile.unbondings.url(this.apiUrl, address),
        this.profile.unbondings.selector,
        this.decimalPlaces,
      );
      unbonding.forEach((entry) => {
        this.unbondingGauge.labels(address, entry.denom).set(entry.amount);
      });

      const rewards = await this.getAmount(
        this.profile.rewards.url(this.apiUrl, address),
        this.profile.rewards.selector,
        this.decimalPlaces,
      );
      rewards.forEach((entry) => {
        this.rewardsGauge.labels(address, entry.denom).set(entry.amount);
      });
    }

    const commissions = await this.getAmount(
      this.profile.commission.url(this.apiUrl, this.validator),
      this.profile.commission.selector,
      this.decimalPlaces,
    );
    commissions.forEach((entry) => {
      this.commissionGauge.labels(this.validator, entry.denom).set(entry.amount);
    });
  }

  protected async getAmount(
    url: string,
    selector: AmountSelector,
    decimal: number,
  ): Promise<Array<{ denom: string; amount: number }>> {
    return this.get(url, (response) => {
      return selector(response.data).map((entry) => ({
        denom: entry.denom ?? "undefined",
        amount: normalizeAmount(entry.amount, decimal),
      }));
    });
  }

  protected async updateRank(validator: string): Promise<void> {
    return this.get(this.profile.rank.url(this.apiUrl), (response) => {
      const sorted = _.sortBy(
        this.profile.rank.selector(response.data),
        (entry) => entry.tokens,
      ).reverse();
      const rank = _.findIndex(sorted, (entry) => entry.operatorAddress === validator) + 1;

      this.rankGauge.labels(validator).set(rank);

      if (this.profile.rank.includeRivalsPower === false) {
        return;
      }

      const me = sorted[rank - 1];
      const above = sorted[rank - 2] ?? { tokens: me?.tokens ?? 0 };
      const below = sorted[rank] ?? { tokens: 0 };

      this.rivalsPowerGauge.labels("above").set(normalizeAmount(above.tokens, this.decimalPlaces));
      this.rivalsPowerGauge.labels("below").set(normalizeAmount(below.tokens, this.decimalPlaces));
    });
  }

  protected async updateMaxValidator(): Promise<void> {
    const url = this.profile.maxValidators.url(this.apiUrl);

    if (!url) {
      this.maxValidatorGauge.set(this.profile.maxValidators.fallbackValue ?? 0);
      return;
    }

    await this.get(url, (response) => {
      this.maxValidatorGauge.set(this.profile.maxValidators.selector(response.data));
    });
  }

  protected async updateProposalsCount(): Promise<void> {
    const url = this.profile.proposals.url(this.apiUrl);

    if (!url) {
      this.proposalsGauge.set(this.profile.proposals.fallbackValue ?? 0);
      return;
    }

    await this.get(url, (response) => {
      this.proposalsGauge.set(this.profile.proposals.selector(response.data));
    });
  }

  protected async updateValidatorsPower(): Promise<void> {
    if (!this.profile.validatorsPower) {
      return;
    }

    const validatorsPower = this.profile.validatorsPower;
    const url = validatorsPower.url(this.apiUrl, this.rpcUrl);

    await this.get(url, (response) => {
      validatorsPower.selector(response.data).forEach((entry) => {
        this.validatorsGauge.labels(entry.address).set(normalizeAmount(entry.power));
      });
    });
  }
}

const legacyBalanceSelector: AmountSelector = (json: any) => json.result;
const legacyDelegationSelector: AmountSelector = (json: any) =>
  json.result.length === 0
    ? []
    : [
        json.result.reduce(
          (state: any, item: any) => {
            state.amount += normalizeInteger(item.balance.amount);
            return state;
          },
          {
            denom: json.result[0].balance.denom,
            amount: 0,
          },
        ),
      ];
const legacyUnbondingSelector: AmountSelector = (json: any) =>
  json.result.length === 0
    ? []
    : [
        json.result.reduce(
          (state: any, item: any) => {
            state.amount += item.entries.reduce(
              (sum: number, entry: any) => sum + normalizeInteger(entry.balance),
              0,
            );
            return state;
          },
          {
            amount: 0,
          },
        ),
      ];
const legacyRewardsSelector: AmountSelector = (json: any) =>
  json.result.total == null || json.result.total.length === 0 ? [] : json.result.total;
const legacyCommissionSelector: AmountSelector = (json: any) => {
  const commissionTop = json.result.val_commission;
  if ("commission" in commissionTop) {
    return commissionTop.commission == null || commissionTop.length === 0
      ? []
      : commissionTop.commission;
  }

  return commissionTop.length === 0 ? [] : commissionTop;
};

const cosmosBalanceSelector: AmountSelector = (json: any) => json.balances;
const cosmosDelegationSelector: AmountSelector = (json: any) =>
  json.delegation_responses.length === 0
    ? []
    : [
        json.delegation_responses.reduce(
          (state: any, item: any) => {
            state.amount += normalizeInteger(item.balance.amount);
            return state;
          },
          {
            denom: json.delegation_responses[0].balance.denom,
            amount: 0,
          },
        ),
      ];
const cosmosUnbondingSelector: AmountSelector = (json: any) =>
  json.unbonding_responses.length === 0
    ? []
    : [
        json.unbonding_responses.reduce(
          (state: any, item: any) => {
            state.amount += item.entries.reduce(
              (sum: number, entry: any) => sum + normalizeInteger(entry.balance),
              0,
            );
            return state;
          },
          {
            amount: 0,
          },
        ),
      ];
const cosmosRewardsSelector: AmountSelector = (json: any) =>
  json.rewards.total == null || json.rewards.total.length === 0 ? [] : json.rewards.total;
const cosmosCommissionSelector: AmountSelector = (json: any) =>
  json.commission.commission == null || json.commission.commission.length === 0
    ? []
    : json.commission.commission;

export const legacyTendermintProfile: CosmosCollectorProfile = {
  filterAddress: (address) => !address.startsWith("0x"),
  balances: {
    url: (apiUrl, address) => `${apiUrl}/bank/balances/${address}`,
    selector: legacyBalanceSelector,
  },
  delegations: {
    url: (apiUrl, address) => `${apiUrl}/staking/delegators/${address}/delegations`,
    selector: legacyDelegationSelector,
  },
  unbondings: {
    url: (apiUrl, address) => `${apiUrl}/staking/delegators/${address}/unbonding_delegations`,
    selector: legacyUnbondingSelector,
  },
  rewards: {
    url: (apiUrl, address) => `${apiUrl}/distribution/delegators/${address}/rewards`,
    selector: legacyRewardsSelector,
  },
  commission: {
    url: (apiUrl, validator) => `${apiUrl}/distribution/validators/${validator}`,
    selector: legacyCommissionSelector,
  },
  rank: {
    url: (apiUrl) => `${apiUrl}/staking/validators?status=BOND_STATUS_BONDED&page=1&limit=256`,
    selector: (json) =>
      json.result.map((entry: any) => ({
        operatorAddress: entry.operator_address,
        tokens: normalizeInteger(entry.tokens),
      })),
  },
  maxValidators: {
    url: (apiUrl) => `${apiUrl}/staking/parameters`,
    selector: (json) => json.result.max_validators,
  },
  proposals: {
    url: (apiUrl) => `${apiUrl}/gov/proposals?status=voting_period`,
    selector: (json) => json.result.length,
  },
};

export const cosmosV1beta1Profile: CosmosCollectorProfile = {
  filterAddress: (address) => !address.startsWith("0x"),
  balances: {
    url: (apiUrl, address) => `${apiUrl}/cosmos/bank/v1beta1/balances/${address}`,
    selector: cosmosBalanceSelector,
  },
  delegations: {
    url: (apiUrl, address) => `${apiUrl}/cosmos/staking/v1beta1/delegations/${address}`,
    selector: cosmosDelegationSelector,
  },
  unbondings: {
    url: (apiUrl, address) =>
      `${apiUrl}/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations`,
    selector: cosmosUnbondingSelector,
  },
  rewards: {
    url: (apiUrl, address) => `${apiUrl}/cosmos/distribution/v1beta1/delegators/${address}/rewards`,
    selector: cosmosRewardsSelector,
  },
  commission: {
    url: (apiUrl, validator) =>
      `${apiUrl}/cosmos/distribution/v1beta1/validators/${validator}/commission`,
    selector: cosmosCommissionSelector,
  },
  rank: {
    url: (apiUrl) =>
      `${apiUrl}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=256`,
    selector: (json) =>
      json.validators.map((entry: any) => ({
        operatorAddress: entry.operator_address,
        tokens: normalizeInteger(entry.tokens),
      })),
  },
  maxValidators: {
    url: (apiUrl) => `${apiUrl}/cosmos/staking/v1beta1/params`,
    selector: (json) => json.params.max_validators,
  },
  proposals: {
    url: (apiUrl) => `${apiUrl}/cosmos/gov/v1beta1/proposals?proposal_status=2`,
    selector: (json) => json.proposals.length,
  },
};

export const cosmosV1Profile: CosmosCollectorProfile = {
  ...cosmosV1beta1Profile,
  proposals: {
    url: (apiUrl) => `${apiUrl}/cosmos/gov/v1/proposals?proposal_status=2`,
    selector: (json) => json.proposals.length,
  },
  validatorsPower: {
    url: (_apiUrl, rpcUrl) => `${rpcUrl}/validators?per_page=100`,
    selector: (json) =>
      json.result.validators.map((entry: any) => ({
        address: entry.address,
        power: entry.voting_power,
      })),
  },
};

export const tgradeProfile: CosmosCollectorProfile = {
  ...cosmosV1beta1Profile,
  filterAddress: () => true,
  rank: {
    url: (apiUrl) => `${apiUrl}/cosmos/staking/v1beta1/validators?pagination.limit=256`,
    selector: (json) =>
      json.validators.map((entry: any) => ({
        operatorAddress: entry.operator_address,
        tokens: normalizeInteger(entry.tokens),
      })),
  },
  proposals: {
    url: () => null,
    selector: () => 0,
    fallbackValue: 0,
  },
};

export const terraV2Profile: CosmosCollectorProfile = {
  ...cosmosV1beta1Profile,
  filterAddress: () => true,
  rank: {
    url: (apiUrl) =>
      `${apiUrl}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=150`,
    selector: (json) =>
      json.validators.map((entry: any) => ({
        operatorAddress: entry.operator_address,
        tokens: normalizeInteger(entry.tokens),
      })),
    includeRivalsPower: false,
  },
  proposals: {
    url: (apiUrl) => `${apiUrl}/cosmos/gov/v1beta1/proposals?proposal_status=2`,
    selector: (json) => json.proposals.length,
  },
};

export const initiaProfile: CosmosCollectorProfile = {
  filterAddress: (address) => !address.startsWith("0x"),
  balances: {
    url: (apiUrl, address) => `${apiUrl}/cosmos/bank/v1beta1/balances/${address}`,
    selector: cosmosBalanceSelector,
  },
  delegations: {
    url: (apiUrl, address) => `${apiUrl}/initia/mstaking/v1/delegations/${address}`,
    selector: (json) =>
      json.delegation_responses.length === 0
        ? []
        : [
            json.delegation_responses.reduce(
              (state: any, item: any) => {
                state.amount += normalizeInteger(item.balance[0].amount);
                return state;
              },
              {
                denom: json.delegation_responses[0].balance[0].denom,
                amount: 0,
              },
            ),
          ],
  },
  unbondings: {
    url: (apiUrl, address) =>
      `${apiUrl}/initia/mstaking/v1/delegators/${address}/unbonding_delegations`,
    selector: (json) =>
      json.unbonding_responses.length === 0
        ? []
        : [
            json.unbonding_responses.reduce(
              (state: any, item: any) => {
                state.amount += item.entries.reduce(
                  (sum: number, entry: any) => sum + normalizeInteger(entry.balance[0]),
                  0,
                );
                return state;
              },
              {
                amount: 0,
              },
            ),
          ],
  },
  rewards: {
    url: (apiUrl, address) => `${apiUrl}/cosmos/distribution/v1beta1/delegators/${address}/rewards`,
    selector: (json) => (json.total == null || json.total.length === 0 ? [] : json.total),
  },
  commission: {
    url: (apiUrl, validator) =>
      `${apiUrl}/cosmos/distribution/v1beta1/validators/${validator}/commission`,
    selector: cosmosCommissionSelector,
  },
  rank: {
    url: (apiUrl) =>
      `${apiUrl}/initia/mstaking/v1/validators?status=BOND_STATUS_BONDED&pagination.limit=256`,
    selector: (json) =>
      json.validators.map((entry: any) => ({
        operatorAddress: entry.operator_address,
        tokens: normalizeInteger(
          entry.tokens.filter((token: any) => token.denom === "uinit")[0].amount,
        ),
      })),
  },
  maxValidators: {
    url: (apiUrl) => `${apiUrl}/initia/mstaking/v1/params`,
    selector: (json) => json.params.max_validators,
  },
  proposals: {
    url: (apiUrl) => `${apiUrl}/cosmos/gov/v1/proposals?proposal_status=2`,
    selector: (json) => json.proposals.length,
  },
};
