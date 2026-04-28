import axios from "axios";
import CachedHttpClient from "../../src/core/http/cached-http-client";

jest.mock("axios");

function getNumericValue(response: { data: unknown }): number {
  return (response.data as { value: number }).value;
}

function getBlockResult(response: { data: unknown }): { height: number } {
  return (response.data as { result: { height: number } }).result;
}

describe("CachedHttpClient", () => {
  const mockedAxios = jest.mocked(axios);
  let client: CachedHttpClient;

  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
    jest.restoreAllMocks();
    client = new CachedHttpClient();
  });

  it("returns stale cached GET results while refreshing them in the background", async () => {
    const nowSpy = jest.spyOn(Date, "now");

    nowSpy.mockReturnValue(0);
    mockedAxios.get.mockResolvedValueOnce({ data: { value: 11 } });

    await expect(
      client.getWithCache("https://api.example/value", getNumericValue, 10),
    ).resolves.toBe(11);

    nowSpy.mockReturnValue(25);
    mockedAxios.get.mockResolvedValueOnce({ data: { value: 22 } });

    await expect(
      client.getWithCache("https://api.example/value", getNumericValue, 10),
    ).resolves.toBe(11);

    await new Promise<void>((resolve) => setImmediate(resolve));

    nowSpy.mockReturnValue(26);
    await expect(
      client.getWithCache("https://api.example/value", getNumericValue, 1000),
    ).resolves.toBe(22);
  });

  it("deduplicates immutable POST requests and serves cached results on later failures", async () => {
    mockedAxios.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ data: { result: { height: 10 } } }), 20);
        }),
    );

    const request = () =>
      client.postImmutableWithLRU(
        "https://rpc.example",
        { method: "getBlock", params: [10] },
        getBlockResult,
      );

    const [left, right] = await Promise.all([request(), request()]);

    expect(left).toEqual({ height: 10 });
    expect(right).toEqual({ height: 10 });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    mockedAxios.post.mockRejectedValueOnce(new Error("network failed"));

    await expect(request()).resolves.toEqual({ height: 10 });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("falls back to the last successful POST response when the next request fails", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { value: 7 } });
    mockedAxios.post.mockRejectedValueOnce(new Error("network failed"));

    const request = () =>
      client.post("https://rpc.example", { method: "getSlot" }, getNumericValue);

    await expect(request()).resolves.toBe(7);
    await expect(request()).resolves.toBe(7);
  });
});
