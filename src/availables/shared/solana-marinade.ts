type ScoredValidator = {
  epoch?: number;
  marinadeSamTargetSol?: number;
  revShare?: { totalPmpe?: number; inflationPmpe?: number; mevPmpe?: number };
  values?: {
    commissions?: { inflationCommissionDec?: number; mevCommissionDec?: number };
  };
};

export function publishedMarinadeAuction(rows: unknown): {
  epoch: number;
  winningTotalPmpe: number;
  inflationPmpe: number;
  mevPmpe: number;
} {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No published Marinade scores available");
  }

  const scores = rows as ScoredValidator[];
  const epochs = scores.map((row) => row?.epoch).filter(Number.isSafeInteger) as number[];
  if (epochs.length === 0) throw new Error("No valid Marinade scoring epoch available");
  const epoch = Math.max(...epochs);
  const latest = scores.filter((row) => row?.epoch === epoch);
  // This is the same winner cutoff used by the SDK's auction-history processor.
  const winners = latest.filter((row) => row.marinadeSamTargetSol > 0);
  const totals = winners.map((row) => row.revShare?.totalPmpe);
  if (totals.length === 0 || totals.some((total) => !Number.isFinite(total) || total <= 0)) {
    throw new Error("No valid Marinade winning total available");
  }

  for (const row of latest) {
    const commissions = row.values?.commissions;
    const inflationCommission = commissions?.inflationCommissionDec;
    const mevCommission = commissions?.mevCommissionDec;
    const inflation = row.revShare?.inflationPmpe;
    const mev = row.revShare?.mevPmpe;
    if (
      !Number.isFinite(inflationCommission) ||
      inflationCommission < 0 ||
      inflationCommission >= 1 ||
      !Number.isFinite(mevCommission) ||
      mevCommission < 0 ||
      mevCommission >= 1 ||
      !Number.isFinite(inflation) ||
      inflation <= 0 ||
      !Number.isFinite(mev) ||
      mev < 0
    ) {
      continue;
    }

    return {
      epoch,
      winningTotalPmpe: Math.min(...(totals as number[])),
      inflationPmpe: inflation / (1 - inflationCommission),
      mevPmpe: mev / (1 - mevCommission),
    };
  }
  throw new Error("No valid Marinade reward baseline available");
}
