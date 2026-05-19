import CosmosCollectorBase, { initiaProfile } from "../shared/cosmos-base";

export default class InitiaTestnet extends CosmosCollectorBase {
  public constructor(
    protected readonly existMetrics: string,
    protected readonly apiUrl: string,
    protected readonly rpcUrl: string,
    protected readonly addresses: string,
    protected readonly validator: string,
  ) {
    super(existMetrics, apiUrl, rpcUrl, addresses, validator, initiaProfile);
  }
}
