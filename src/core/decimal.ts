function normalizeBigInt(value: bigint | number | string): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(Math.trunc(value));
  }

  return BigInt(value);
}

export function toDecimal(value: bigint | number | string, decimals: number): number {
  const normalized = normalizeBigInt(value);
  const negative = normalized < 0n;
  const absolute = negative ? normalized * -1n : normalized;
  const divisor = 10n ** BigInt(decimals);

  const whole = absolute / divisor;
  const fraction = absolute % divisor;
  const prefix = negative ? "-" : "";

  if (fraction === 0n) {
    return Number(`${prefix}${whole.toString()}`);
  }

  return Number(`${prefix}${whole.toString()}.${fraction.toString().padStart(decimals, "0")}`);
}

export function toPercent(value: bigint | number | string, decimals: number = 18): number {
  return toDecimal(value, decimals) * 100;
}
