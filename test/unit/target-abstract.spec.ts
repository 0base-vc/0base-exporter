import axios from "axios";
import TargetAbstract from "../../src/target.abstract";

jest.mock("axios");

class TestCollector extends TargetAbstract {
  public constructor(existingMetricsUrl = "") {
    super(existingMetricsUrl, "https://api.example", "https://rpc.example", "a", "b");
  }

  public async makeMetrics(): Promise<string> {
    return "ok";
  }

  public async fetchCached(url: string): Promise<number | ""> {
    return this.getWithCache(url, (response) => response.data.value as number, 1000);
  }

  public async fetchDirect(url: string): Promise<number | ""> {
    return this.get(url, (response) => response.data.value as number);
  }

  public async fetchExistingMetrics(): Promise<string> {
    return this.loadExistMetrics();
  }
}

describe("TargetAbstract transport helpers", () => {
  const mockedAxios = jest.mocked(axios);
  let collector: TestCollector;

  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
    collector = new TestCollector();
  });

  it("deduplicates concurrent cached GET requests", async () => {
    mockedAxios.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ data: { value: 7 } }), 25);
        }),
    );

    const [left, right] = await Promise.all([
      collector.fetchCached("https://api.example/value"),
      collector.fetchCached("https://api.example/value"),
    ]);

    expect(left).toBe(7);
    expect(right).toBe(7);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it("returns the last fallback value when a direct GET fails", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { value: 42 } });
    mockedAxios.get.mockRejectedValueOnce(new Error("network failed"));

    await expect(collector.fetchDirect("https://api.example/value")).resolves.toBe(42);
    await expect(collector.fetchDirect("https://api.example/value")).resolves.toBe(42);
  });

  it("trims and skips empty existing metric URLs", async () => {
    collector = new TestCollector("https://a.example/metrics, https://b.example/metrics, ");
    mockedAxios.get
      .mockResolvedValueOnce({ data: "cometbft_metric 1\n" })
      .mockResolvedValueOnce({ data: "other_metric 2\n" });

    await expect(collector.fetchExistingMetrics()).resolves.toBe(
      "tendermint_metric 1\n\nother_metric 2\n",
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(1, "https://a.example/metrics", {});
    expect(mockedAxios.get).toHaveBeenNthCalledWith(2, "https://b.example/metrics", {});
  });
});
