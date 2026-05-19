import TargetAbstract from "../../src/target.abstract";

export default class CustomBlockchain extends TargetAbstract {
  public async makeMetrics(): Promise<string> {
    return [this.apiUrl, this.rpcUrl, this.addresses, this.validator].join("|");
  }
}
