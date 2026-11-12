import CachedHttpClient from "../../core/http/cached-http-client";

const HEALTH_NAME = "solana_firebam_metrics_up";
const HEALTH_DESCRIPTION = `# HELP ${HEALTH_NAME} Whether the current FireBAM native metrics scrape succeeded\n# TYPE ${HEALTH_NAME} gauge\n`;
const SAMPLE_LINE =
  /^[a-zA-Z_:][a-zA-Z0-9_:]*(?:\{.*\})?[ \t]+(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[+-]?Inf|NaN)(?:[ \t]+[+-]?\d+)?[ \t]*$/;

/** Fresh passthrough: a failed request must never replay old BAM health. */
export default class FirebamMetrics {
  public readonly url: string;
  private readonly client = new CachedHttpClient();

  public constructor(endpoint = "", exporterPort = 27770) {
    this.url = "";
    if (!endpoint.trim()) return;
    try {
      const url = new URL(endpoint.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP(S) required");
      const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
      if (
        ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname) &&
        port === exporterPort
      ) {
        throw new Error("endpoint points to the exporter listen port");
      }
      this.url = url.href;
    } catch {
      throw new Error(
        "Invalid FIREBAM_METRICS_URL: use the native FireBAM HTTP(S) endpoint, not this exporter",
      );
    }
  }

  public async collect(): Promise<string> {
    if (!this.url) return "";
    try {
      const native = await this.client.getFresh(
        this.url,
        ({ data }) => {
          if (
            typeof data !== "string" ||
            data
              .split(/\r?\n/)
              .some((line) => line.trim() && !line.startsWith("#") && !SAMPLE_LINE.test(line)) ||
            !/^bam_enabled(?:\{[^\n]*\})?[ \t]+[01](?:\.0+)?[ \t]*\r?$/m.test(data) ||
            /^solana_firebam_metrics_up(?:\{|[ \t])/m.test(data)
          ) {
            throw new Error("Response is not native FireBAM metrics");
          }
          return data.endsWith("\n") ? data : `${data}\n`;
        },
        4000,
      );
      return `${HEALTH_DESCRIPTION}${HEALTH_NAME} 1\n${native}`;
    } catch {
      return `${HEALTH_DESCRIPTION}${HEALTH_NAME} 0\n`;
    }
  }
}
