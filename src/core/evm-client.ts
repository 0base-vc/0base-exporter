import { Web3 } from "web3";
import { toDecimal } from "./decimal";

export default class EvmClient {
  public readonly web3: Web3;

  public constructor(rpcUrl: string) {
    if (!rpcUrl) {
      throw new Error("EVM_API_URL is required for EVM collectors");
    }

    this.web3 = new Web3(rpcUrl);
  }

  public async getNativeBalance(address: string, decimals: number): Promise<number> {
    const amount = await this.web3.eth.getBalance(address);
    return this.scale(amount.toString(), decimals);
  }

  public scale(value: bigint | number | string, decimals: number): number {
    return toDecimal(typeof value === "bigint" ? value.toString() : value, decimals);
  }
}
