const usStandardRemoval = [
  [0.5, 0.84], [1, 1.53], [2, 2.27],
  [null, 2.89, 2, 1.06],
];
const usOversizeRemoval = [
  [1, 3.12], [2, 4.30], [4, 6.36], [10, 10.04],
  [null, 14.32, 10, 1.06],
];
const usStandardProcessing = [
  [0.5, 0.25], [1, 0.30], [2, 0.35],
  [null, 0.40, 2, 0.20],
];
const usOversizeProcessing = [
  [1, 0.60], [2, 0.70], [4, 0.90], [10, 1.45],
  [null, 1.90, 10, 0.20],
];

const metricTiers = {
  CA: {
    removal: {
      standard: [[0.2, 0.36], [0.5, 0.82], [1, 1.62], [null, 2.31, 1, 1.54]],
      oversize: [[0.2, 0.93], [0.5, 1.21], [1, 1.69], [2, 2.83], [5, 5.02], [null, 5.70, 5, 0.97]],
    },
    processing: {
      standard: [[0.2, 0.25], [0.5, 0.30], [1, 0.35], [null, 0.40, 1, 0.20]],
      oversize: [[0.5, 0.60], [1, 0.70], [2, 0.90], [5, 1.45], [null, 1.90, 5, 0.20]],
    },
  },
  UK: {
    removal: {
      standard: [[0.2, 0.49], [0.5, 0.71], [1, 1.57], [null, 2.03, 1, 0.80]],
      oversize: [[0.5, 2.13], [1, 4.10], [2, 5.27], [5, 7.33], [null, 10.49, 5, 0.80]],
    },
    processing: {
      standard: [[0.2, 0.37], [0.5, 0.49], [1, 0.80], [null, 1.06, 1, 0.53]],
      oversize: [[0.5, 0.85], [1, 1.73], [2, 2.59], [5, 4.32], [null, 5.18, 5, 0.52]],
    },
  },
  DE: {
    removal: {
      standard: [[0.2, 0.50], [0.5, 0.79], [1, 1.80], [null, 2.32, 1, 0.87]],
      oversize: [[0.5, 2.46], [1, 4.80], [2, 6.15], [5, 8.55], [null, 10.49, 5, 0.86]],
    },
    processing: {
      standard: [[0.2, 0.42], [0.5, 0.52], [1, 0.93], [null, 1.02, 1, 0.53]],
      oversize: [[0.5, 0.83], [1, 1.67], [2, 2.51], [5, 4.19], [null, 5.02, 5, 0.52]],
    },
  },
};

export const MARKET_RULES = {
  US: {
    marketplace: "US",
    currency: "USD",
    symbol: "$",
    version: "us-2026.2",
    effectiveFrom: "2026-01-15",
    ageStart: 181,
    volumeUnit: "cuft",
    weightUnit: "lb",
    incrementRounding: "ceil",
    storage: {
      standard: { janSep: 0.78, octDec: 2.40 },
      oversize: { janSep: 0.56, octDec: 1.40 },
    },
    aged: [
      ["181-210", 0.50, null, "volume"],
      ["211-240", 1.00, null, "volume"],
      ["241-270", 1.50, null, "volume"],
      ["271-300", 5.45, null, "volume"],
      ["301-330", 5.70, null, "volume"],
      ["331-365", 5.90, null, "volume"],
      ["366-455", 6.90, 0.30, "max"],
      ["456+", 7.90, 0.35, "max"],
    ],
    removal: { standard: usStandardRemoval, oversize: usOversizeRemoval },
    processing: { standard: usStandardProcessing, oversize: usOversizeProcessing },
  },
  CA: {
    marketplace: "CA",
    currency: "CAD",
    symbol: "C$",
    version: "ca-2026.1",
    effectiveFrom: "2026-01-01",
    ageStart: 181,
    volumeUnit: "m3",
    weightUnit: "kg",
    incrementRounding: "ceil",
    storage: {
      standard: { janSep: 40.00, octDec: 77.00 },
      oversize: { janSep: 28.00, octDec: 49.00 },
    },
    aged: [
      ["181-210", 24.00, null, "volume"],
      ["211-240", 48.00, null, "volume"],
      ["241-270", 72.00, null, "volume"],
      ["271-300", 156.00, null, "volume"],
      ["301-330", 172.00, null, "volume"],
      ["331-365", 189.00, null, "volume"],
      ["366+", 330.00, 0.15, "max"],
    ],
    ...metricTiers.CA,
  },
  UK: {
    marketplace: "UK",
    currency: "GBP",
    symbol: "£",
    version: "uk-2026.07",
    effectiveFrom: "2026-07-01",
    ageStart: 241,
    volumeUnit: "cuft",
    weightUnit: "kg",
    incrementRounding: "exact",
    storage: {
      standard: { janSep: 0.76, octDec: 1.51 },
      oversize: { janSep: 0.55, octDec: 0.87 },
    },
    aged: [
      ["241-270", 1.18, null, "volume"],
      ["271-300", 3.14, null, "volume"],
      ["301-330", 3.26, null, "volume"],
      ["331-365", 3.41, null, "volume"],
      ["366-455", 5.71, 0.20, "max"],
      ["456+", 6.14, 0.25, "max"],
    ],
    ...metricTiers.UK,
  },
  DE: {
    marketplace: "DE",
    currency: "EUR",
    symbol: "€",
    version: "de-2026.07",
    effectiveFrom: "2026-07-01",
    ageStart: 241,
    volumeUnit: "m3",
    weightUnit: "kg",
    incrementRounding: "exact",
    storage: {
      standard: { janSep: 27.54, octDec: 52.20 },
      oversize: { janSep: 21.78, octDec: 34.49 },
    },
    aged: [
      ["241-270", 47.99, null, "volume"],
      ["271-300", 125.16, null, "volume"],
      ["301-330", 129.92, null, "volume"],
      ["331-365", 135.98, null, "volume"],
      ["366-455", 227.63, 0.20, "max"],
      ["456+", 261.97, 0.25, "max"],
    ],
    ...metricTiers.DE,
  },
};

export const LIQUIDATION = {
  grossRecoveryRate: 0.075,
  referralFeeRate: 0.15,
};

export function feeFromTier(tiers, weight, incrementRounding = "ceil") {
  if (!Number.isFinite(weight) || weight < 0) return null;
  for (const [maxWeight, baseFee, includedWeight = 0, increment = 0] of tiers) {
    if (maxWeight === null || weight <= maxWeight) {
      const extraWeight = Math.max(0, weight - includedWeight);
      const increments = incrementRounding === "exact" ? extraWeight : Math.ceil(extraWeight - 1e-12);
      return baseFee + increments * increment;
    }
  }
  return null;
}
