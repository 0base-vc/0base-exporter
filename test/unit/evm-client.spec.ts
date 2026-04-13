import EvmClient from "../../src/core/evm-client";

describe("EvmClient", () => {
  it("fails fast when the RPC URL is missing", () => {
    expect(() => new EvmClient("")).toThrow("EVM_API_URL is required for EVM collectors");
  });

  it("scales values with the shared decimal helper", () => {
    const client = new EvmClient("http://127.0.0.1:8545");
    expect(client.scale("1230000000000000000", 18)).toBe(1.23);
  });

  it("reads native balances through web3 and applies decimal scaling", async () => {
    const client = new EvmClient("http://127.0.0.1:8545");
    jest.spyOn(client.web3.eth, "getBalance").mockResolvedValue(4200000000000000000n);

    await expect(client.getNativeBalance("0xabc", 18)).resolves.toBe(4.2);
  });
});
