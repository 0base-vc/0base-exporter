export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' {"meta":"unserializable"}';
  }
}

class ConsoleLogger implements Logger {
  public info(message: string, meta?: Record<string, unknown>): void {
    console.info(`[0base-exporter] ${message}${formatMeta(meta)}`);
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[0base-exporter] ${message}${formatMeta(meta)}`);
  }

  public error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[0base-exporter] ${message}${formatMeta(meta)}`);
  }
}

export const logger: Logger = new ConsoleLogger();
