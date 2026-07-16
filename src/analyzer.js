import { LIQUIDATION, MARKET_RULES, feeFromTier } from "./rules.js";

const REPORT_LABELS = {
  inventory: "库存报告",
  age: "库龄报告",
  charge: "仓储收费报告",
  commission: "佣金预览报告",
  products: "所有商品报告",
  costs: "成本补充表",
  unknown: "未识别文件",
};

const recognizedHeaders = new Set([
  "sku", "seller-sku", "merchant-sku", "fnsku", "asin", "asin1", "product-id",
  "available", "fc-transfer", "units-shipped-t30", "estimated-excess-quantity",
  "181-210", "211-240", "241-270", "estimated-monthly-storage-fee",
  "item-volume", "weight", "estimated-referral-fee-per-item", "item-name",
  "unit-cost", "product-cost", "unit-cost-rate", "product-cost-rate",
  "fulfillment-fee-per-unit", "fulfillment-fee-rate", "first-mile-cost-rate",
]);

const DETAILED_AGE_BUCKETS = [
  "0-180", "181-210", "211-240", "241-270", "271-300",
  "301-330", "331-365", "366-455", "456+",
];

export const FORECAST_HORIZONS = [30, 60, 90, 180];
export const SALES_SCENARIOS = [
  { key: "conservative", label: "保守", multiplier: 0.7 },
  { key: "baseline", label: "基准", multiplier: 1 },
  { key: "optimistic", label: "乐观", multiplier: 1.3 },
];

export function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[$£€¥,%]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function valueOrZero(value) {
  return numberOrNull(value) ?? 0;
}

function rateOrNull(value) {
  const parsed = numberOrNull(value);
  if (parsed === null || parsed < 0) return null;
  const normalized = parsed > 1 ? parsed / 100 : parsed;
  return normalized <= 1 ? normalized : null;
}

function text(value) {
  return String(value ?? "").trim();
}

function first(row, aliases) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
}

function firstPositive(row, aliases) {
  for (const alias of aliases) {
    const amount = numberOrNull(row[normalizeHeader(alias)]);
    if (amount !== null && amount > 0) return amount;
  }
  return null;
}

function findHeaderIndex(matrix) {
  let best = { index: -1, score: 0 };
  matrix.slice(0, 12).forEach((row, index) => {
    const score = row
      .map(normalizeHeader)
      .filter((header) => recognizedHeaders.has(header)).length;
    if (score > best.score) best = { index, score };
  });
  return best.score >= 2 ? best.index : -1;
}

function matrixToRows(matrix) {
  const headerIndex = findHeaderIndex(matrix);
  if (headerIndex < 0) return { headers: [], rows: [] };
  const headers = matrix[headerIndex].map(normalizeHeader);
  const rows = matrix.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => text(cell) !== ""))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header || `column-${index}`, cells[index] ?? ""])));
  return { headers, rows };
}

export function detectReportType(headers) {
  const set = new Set(headers.map(normalizeHeader));
  if (set.has("estimated-monthly-storage-fee") && set.has("fnsku")) return "charge";
  if (set.has("estimated-referral-fee-per-item") && set.has("seller-sku")) return "commission";
  if (set.has("merchant-sku") && (set.has("181-210") || set.has("0-180"))) return "age";
  if (set.has("available") && (set.has("sku") || set.has("seller-sku"))) return "inventory";
  if (set.has("item-name") && set.has("seller-sku") && (set.has("asin1") || set.has("product-id"))) return "products";
  const hasCostField = ["unit-cost", "product-cost", "unit-cost-rate", "product-cost-rate", "fulfillment-fee-per-unit", "fulfillment-fee-rate", "first-mile-cost-rate"]
    .some((header) => set.has(header));
  if ((set.has("seller-sku") || set.has("sku")) && hasCostField) return "costs";
  return "unknown";
}

function extractAsin(productText) {
  return text(productText).match(/ASIN:\s*([A-Z0-9]{10})/i)?.[1] ?? "";
}

function normalizeSizeTier(value) {
  const lowered = text(value).toLowerCase();
  return lowered.includes("standard") || lowered.includes("标准") ? "standard" : "oversize";
}

function normalizedWeight(weight, unit, targetUnit) {
  const amount = numberOrNull(weight);
  if (amount === null) return null;
  const source = text(unit).toLowerCase();
  if (targetUnit === "kg" && (source.includes("pound") || source === "lb" || source === "lbs")) return amount * 0.45359237;
  if (targetUnit === "lb" && (source.includes("kilogram") || source === "kg")) return amount / 0.45359237;
  return amount;
}

function normalizedVolume(volume, unit, targetUnit) {
  const amount = numberOrNull(volume);
  if (amount === null) return null;
  const source = text(unit).toLowerCase();
  const sourceIsCubicFeet = source.includes("cubic feet") || source.includes("cuft") || source.includes("ft3");
  const sourceIsCubicMeters = source.includes("cubic meter") || source === "m3" || source === "m³";
  if (targetUnit === "m3" && sourceIsCubicFeet) return amount * 0.0283168466;
  if (targetUnit === "cuft" && sourceIsCubicMeters) return amount / 0.0283168466;
  return amount;
}

function rowToSource(type, row, rule) {
  if (type === "inventory") {
    return {
      sku: text(first(row, ["sku", "seller-sku", "merchant-sku"])),
      fnsku: text(first(row, ["fnsku"])),
      asin: text(first(row, ["asin", "asin1", "product-id"])),
      product: text(first(row, ["product-name", "item-name", "product"])),
      available: numberOrNull(first(row, ["available", "afn-fulfillable-quantity", "quantity"])),
      transfer: valueOrZero(first(row, ["fc-transfer", "transfer"])),
      sales30: valueOrZero(first(row, ["units-shipped-t30", "sales-30", "30-day-sales"])),
      excess: numberOrNull(first(row, ["estimated-excess-quantity", "excess-quantity", "excess"])),
      price: firstPositive(row, ["your-price", "featuredoffer-price", "lowest-price-new-plus-shipping", "sales-price", "price"]),
      productCost: numberOrNull(first(row, ["product-cost", "unit-cost", "cost"])),
      productCostRate: rateOrNull(first(row, ["unit-cost-rate", "product-cost-rate", "采购成本比例", "单件采购成本比例"])),
      firstMileCost: numberOrNull(first(row, ["first-mile-cost", "first-leg-cost", "inbound-cost"])),
      firstMileRate: rateOrNull(first(row, ["first-mile-cost-rate", "first-mile-rate", "头程占售价比例"])),
      fulfillmentFee: numberOrNull(first(row, ["fulfillment-fee-per-unit", "fba-fulfillment-fee-per-unit", "estimated-fulfillment-fee-per-item", "estimated-fulfillment-fee-per-unit"])),
      fulfillmentFeeRate: rateOrNull(first(row, ["fulfillment-fee-rate", "fba-fulfillment-fee-rate", "fba配送费比例"])),
      ageMode: "grouped",
      age: {
        "0-180": valueOrZero(first(row, ["inv-age-0-to-90-days"])) + valueOrZero(first(row, ["inv-age-91-to-180-days"])),
        "181-270": valueOrZero(first(row, ["inv-age-181-to-270-days"])),
        "271-365": valueOrZero(first(row, ["inv-age-271-to-365-days"])),
        "366-455": valueOrZero(first(row, ["inv-age-366-to-455-days"])),
        "456+": valueOrZero(first(row, ["inv-age-456-plus-days"])),
      },
    };
  }
  if (type === "age") {
    const product = first(row, ["商品", "product", "item-name"]);
    return {
      sku: text(first(row, ["merchant-sku", "sku", "seller-sku"])),
      asin: text(first(row, ["asin"])) || extractAsin(product),
      product: text(product).split(/\r?\n/).slice(2).join(" "),
      snapshot: first(row, ["日期", "date", "snapshot-date"]),
      ageMode: "detailed",
      age: {
        "0-180": valueOrZero(first(row, ["0-180"])),
        "181-210": valueOrZero(first(row, ["181-210"])),
        "211-240": valueOrZero(first(row, ["211-240"])),
        "241-270": valueOrZero(first(row, ["241-270"])),
        "271-300": valueOrZero(first(row, ["271-300"])),
        "301-330": valueOrZero(first(row, ["301-330"])),
        "331-365": valueOrZero(first(row, ["331-365"])),
        "366-455": valueOrZero(first(row, ["366-455"])),
        "456+": valueOrZero(first(row, ["456+"])),
      },
    };
  }
  if (type === "charge") {
    return {
      sku: text(first(row, ["sku", "seller-sku"])),
      fnsku: text(first(row, ["fnsku"])),
      asin: text(first(row, ["asin"])),
      product: text(first(row, ["product-name", "item-name"])),
      storageFee: valueOrZero(first(row, ["estimated-monthly-storage-fee"])),
      chargeMonth: text(first(row, ["month-of-charge"])),
      weight: normalizedWeight(first(row, ["weight"]), first(row, ["weight-units"]), rule.weightUnit),
      volume: normalizedVolume(first(row, ["item-volume"]), first(row, ["volume-units"]), rule.volumeUnit),
      sizeTier: normalizeSizeTier(first(row, ["product-size-tier"])),
    };
  }
  if (type === "commission") {
    return {
      sku: text(first(row, ["seller-sku", "sku"])),
      asin: text(first(row, ["asin", "asin1"])),
      product: text(first(row, ["item-name", "product-name"])),
      price: numberOrNull(first(row, ["price", "your-price"])),
      referralFee: numberOrNull(first(row, ["estimated-referral-fee-per-item"])),
      fulfillmentFee: numberOrNull(first(row, ["fulfillment-fee-per-unit", "fba-fulfillment-fee-per-unit", "estimated-fulfillment-fee-per-item", "estimated-fulfillment-fee-per-unit"])),
      fulfillmentFeeRate: rateOrNull(first(row, ["fulfillment-fee-rate", "fba-fulfillment-fee-rate", "fba配送费比例"])),
    };
  }
  if (type === "products") {
    return {
      sku: text(first(row, ["seller-sku", "sku"])),
      asin: text(first(row, ["asin1", "product-id", "asin"])),
      product: text(first(row, ["item-name", "product-name"])),
      price: numberOrNull(first(row, ["price", "your-price"])),
      productCost: numberOrNull(first(row, ["product-cost", "unit-cost", "cost"])),
      productCostRate: rateOrNull(first(row, ["unit-cost-rate", "product-cost-rate", "采购成本比例", "单件采购成本比例"])),
      firstMileCost: numberOrNull(first(row, ["first-mile-cost", "first-leg-cost", "inbound-cost"])),
      firstMileRate: rateOrNull(first(row, ["first-mile-cost-rate", "first-mile-rate", "头程占售价比例"])),
      fulfillmentFee: numberOrNull(first(row, ["fulfillment-fee-per-unit", "fba-fulfillment-fee-per-unit", "estimated-fulfillment-fee-per-item", "estimated-fulfillment-fee-per-unit"])),
      fulfillmentFeeRate: rateOrNull(first(row, ["fulfillment-fee-rate", "fba-fulfillment-fee-rate", "fba配送费比例"])),
    };
  }
  if (type === "costs") {
    return {
      sku: text(first(row, ["seller-sku", "sku", "merchant-sku"])),
      asin: text(first(row, ["asin", "asin1", "product-id"])),
      productCost: numberOrNull(first(row, ["unit-cost", "product-cost", "cost", "单件采购成本"])),
      productCostRate: rateOrNull(first(row, ["unit-cost-rate", "product-cost-rate", "采购成本比例", "单件采购成本比例"])),
      fulfillmentFee: numberOrNull(first(row, ["fulfillment-fee-per-unit", "fba-fulfillment-fee-per-unit", "estimated-fulfillment-fee-per-item", "estimated-fulfillment-fee-per-unit", "fba正常销售配送费"])),
      fulfillmentFeeRate: rateOrNull(first(row, ["fulfillment-fee-rate", "fba-fulfillment-fee-rate", "fba配送费比例"])),
      firstMileCost: numberOrNull(first(row, ["first-mile-cost", "first-leg-cost", "inbound-cost", "单件头程"])),
      firstMileRate: rateOrNull(first(row, ["first-mile-cost-rate", "first-mile-rate", "头程占售价比例"])),
    };
  }
  return null;
}

export function workbookToSources(workbook, fileName, XLSX, marketplace = "US") {
  const rule = MARKET_RULES[marketplace];
  const parsed = [];
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
    const { headers, rows } = matrixToRows(matrix);
    const type = detectReportType(headers);
    if (type === "unknown") continue;
    const items = rows.map((row) => rowToSource(type, row, rule)).filter((row) => row && (row.sku || row.fnsku || row.asin));
    parsed.push({ fileName, sheetName, type, label: REPORT_LABELS[type], rows: items });
  }
  if (!parsed.length) parsed.push({ fileName, sheetName: "", type: "unknown", label: REPORT_LABELS.unknown, rows: [] });
  return parsed;
}

function stableSnapshotRank(value, rowIndex) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : -rowIndex;
}

function sumAge(age) {
  return Object.values(age || {}).reduce((sum, value) => sum + valueOrZero(value), 0);
}

function agedUnits(item, rule) {
  const age = item.age || {};
  if (item.ageMode === "detailed") {
    const keys = rule.ageStart === 181
      ? ["181-210", "211-240", "241-270", "271-300", "301-330", "331-365", "366-455", "456+"]
      : ["241-270", "271-300", "301-330", "331-365", "366-455", "456+"];
    return keys.reduce((sum, key) => sum + valueOrZero(age[key]), 0);
  }
  if (rule.ageStart === 181) return valueOrZero(age["181-270"]) + valueOrZero(age["271-365"]) + valueOrZero(age["366-455"]) + valueOrZero(age["456+"]);
  return valueOrZero(age["271-365"]) + valueOrZero(age["366-455"]) + valueOrZero(age["456+"]);
}

function ageFee(item, rule) {
  if (!Number.isFinite(item.volume) || !item.age) return null;
  let total = 0;
  for (const [bucket, volumeRate, unitRate, method] of rule.aged) {
    let units = valueOrZero(item.age[bucket]);
    if (!units && item.ageMode !== "detailed") {
      if (bucket === "181-210" && rule.ageStart === 181) units = valueOrZero(item.age["181-270"]);
      if (bucket === "271-300") units = valueOrZero(item.age["271-365"]);
      if (bucket === "366-455") units = valueOrZero(item.age["366-455"]);
      if (bucket === "456+" || bucket === "366+") units = valueOrZero(item.age["456+"]);
    }
    const volumeFee = units * item.volume * volumeRate;
    const perUnitFee = unitRate === null ? 0 : units * unitRate;
    total += method === "max" ? Math.max(volumeFee, perUnitFee) : volumeFee;
  }
  return total;
}

function monthlyStorage(item, rule, month) {
  if (item.storageFee > 0) return item.storageFee;
  if (!Number.isFinite(item.volume)) return null;
  const season = month >= 10 ? "octDec" : "janSep";
  return item.available * item.volume * rule.storage[item.sizeTier][season];
}

function bucketStart(bucket) {
  const parsed = Number(String(bucket).split(/[-+]/)[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bucketEnd(bucket) {
  if (String(bucket).includes("+")) return Infinity;
  const parsed = Number(String(bucket).split("-")[1]);
  return Number.isFinite(parsed) ? parsed : Infinity;
}

function agedFeePerUnitAtAge(item, rule, ageDays) {
  if (!Number.isFinite(item.volume)) return null;
  const tier = rule.aged.find(([bucket]) => ageDays >= bucketStart(bucket) && ageDays <= bucketEnd(bucket));
  if (!tier) return 0;
  const [, volumeRate, unitRate, method] = tier;
  const volumeFee = item.volume * volumeRate;
  const perUnitFee = unitRate === null ? 0 : unitRate;
  return method === "max" ? Math.max(volumeFee, perUnitFee) : volumeFee;
}

function actionCohorts(item, rule) {
  if (item.ageMode !== "detailed") return [];
  return DETAILED_AGE_BUCKETS
    .map((bucket) => ({ bucket, ageDays: bucketStart(bucket), units: valueOrZero(item.age?.[bucket]) }))
    .filter((cohort) => cohort.ageDays >= rule.ageStart && cohort.units > 0)
    .sort((a, b) => b.ageDays - a.ageDays);
}

function cohortsAfterSales(item, rule, elapsedDays, salesMultiplier = 1) {
  const cohorts = actionCohorts(item, rule).map((cohort) => ({ ...cohort }));
  let sold = Math.min(item.actionUnits, item.sales30 * salesMultiplier / 30 * elapsedDays);
  for (const cohort of cohorts) {
    const deducted = Math.min(cohort.units, sold);
    cohort.units -= deducted;
    sold -= deducted;
  }
  return cohorts;
}

function baseStoragePerUnit(item, rule, currentMonth, targetMonth) {
  const sizeTier = item.sizeTier || "standard";
  const currentSeason = currentMonth >= 10 ? "octDec" : "janSep";
  const targetSeason = targetMonth >= 10 ? "octDec" : "janSep";
  if (item.storageFee > 0 && item.available > 0) {
    const currentRate = rule.storage[sizeTier][currentSeason];
    const targetRate = rule.storage[sizeTier][targetSeason];
    return item.storageFee / item.available * (currentRate > 0 ? targetRate / currentRate : 1);
  }
  if (!Number.isFinite(item.volume)) return null;
  return item.volume * rule.storage[sizeTier][targetSeason];
}

function recommendScenario(holdValue, liquidateValue, horizonDays) {
  const scenarios = [
    { key: "hold", value: holdValue, label: `继续销售 ${horizonDays} 天，再清算剩余` },
    { key: "liquidate", value: liquidateValue, label: "立即清算" },
  ].filter((scenario) => Number.isFinite(scenario.value));
  if (scenarios.length < 2) return { key: "pending", label: "补全费用后再比较", value: null };
  return scenarios.reduce((best, scenario) => scenario.value > best.value ? scenario : best);
}

function forecastHolding(item, rule, horizonDays, currentMonth, salesMultiplier = 1) {
  if (item.actionUnits <= 0) {
    return {
      horizonDays, expectedSoldUnits: 0, remainingUnits: 0,
      baseStorageCost: 0, agedSurchargeCost: 0, totalHoldingCost: 0,
      normalSaleCash: 0, exitLiquidationNet: 0, holdThenLiquidateValue: 0,
      recommendation: { key: "none", label: "无需处理", value: 0 },
    };
  }

  const periodCount = Math.ceil(horizonDays / 30);
  const dailySales = item.sales30 * salesMultiplier / 30;
  let baseStorageCost = 0;
  let agedSurchargeCost = 0;
  let baseReady = true;
  let agedReady = true;
  for (let period = 1; period <= periodCount; period += 1) {
    const startDay = (period - 1) * 30;
    const endDay = Math.min(horizonDays, period * 30);
    const periodDays = endDay - startDay;
    const startUnits = Math.max(0, item.actionUnits - dailySales * startDay);
    const endUnits = Math.max(0, item.actionUnits - dailySales * endDay);
    const averageUnits = (startUnits + endUnits) / 2;
    const targetMonth = ((currentMonth - 1 + period - 1) % 12) + 1;
    const basePerUnit = baseStoragePerUnit(item, rule, currentMonth, targetMonth);
    if (Number.isFinite(basePerUnit)) baseStorageCost += averageUnits * basePerUnit * periodDays / 30;
    else baseReady = false;

    const cohorts = cohortsAfterSales(item, rule, endDay, salesMultiplier);
    if (cohorts.length) {
      for (const cohort of cohorts) {
        const fee = agedFeePerUnitAtAge(item, rule, cohort.ageDays + endDay);
        if (Number.isFinite(fee)) agedSurchargeCost += cohort.units * fee * periodDays / 30;
        else agedReady = false;
      }
    } else if (Number.isFinite(item.agedFee) && item.actionUnits > 0) {
      agedSurchargeCost += item.agedFee / item.actionUnits * endUnits * periodDays / 30;
    } else {
      agedReady = false;
    }
  }

  const expectedSoldUnits = Math.min(item.actionUnits, dailySales * horizonDays);
  const remainingUnits = Math.max(0, item.actionUnits - expectedSoldUnits);
  const totalHoldingCost = baseReady && agedReady ? baseStorageCost + agedSurchargeCost : null;
  const normalSaleCash = Number.isFinite(item.normalSaleNetPerUnit)
    ? expectedSoldUnits * item.normalSaleNetPerUnit
    : null;
  const liquidationPerUnit = Number.isFinite(item.liquidationNet) && item.actionUnits > 0
    ? item.liquidationNet / item.actionUnits
    : null;
  const exitLiquidationNet = Number.isFinite(liquidationPerUnit) ? remainingUnits * liquidationPerUnit : null;
  const holdThenLiquidateValue = Number.isFinite(normalSaleCash)
    && Number.isFinite(exitLiquidationNet)
    && Number.isFinite(totalHoldingCost)
    ? normalSaleCash + exitLiquidationNet - totalHoldingCost
    : null;
  return {
    horizonDays,
    salesMultiplier,
    expectedSoldUnits,
    remainingUnits,
    baseStorageCost: baseReady ? baseStorageCost : null,
    agedSurchargeCost: agedReady ? agedSurchargeCost : null,
    totalHoldingCost,
    normalSaleCash,
    exitLiquidationNet,
    holdThenLiquidateValue,
    recommendation: recommendScenario(holdThenLiquidateValue, item.liquidationNet, horizonDays),
  };
}

function breakEvenDays(item, rule, currentMonth, limitDays = 365) {
  if (item.actionUnits <= 0 || !Number.isFinite(item.liquidationNet)) return null;
  for (let horizonDays = 1; horizonDays <= limitDays; horizonDays += 1) {
    const forecast = forecastHolding(item, rule, horizonDays, currentMonth);
    if (Number.isFinite(forecast.holdThenLiquidateValue)
      && forecast.holdThenLiquidateValue <= item.liquidationNet) return horizonDays;
  }
  return null;
}

function portfolioBreakEvenDays(rows, rule, currentMonth, limitDays = 365) {
  const actionRows = rows.filter((row) => row.actionUnits > 0);
  if (!actionRows.length || actionRows.some((row) => !Number.isFinite(row.liquidationNet))) return null;
  const liquidationValue = actionRows.reduce((total, row) => total + row.liquidationNet, 0);
  for (let horizonDays = 1; horizonDays <= limitDays; horizonDays += 1) {
    const forecasts = actionRows.map((row) => forecastHolding(row, rule, horizonDays, currentMonth));
    if (forecasts.some((forecast) => !Number.isFinite(forecast.holdThenLiquidateValue))) return null;
    const holdValue = forecasts.reduce((total, forecast) => total + forecast.holdThenLiquidateValue, 0);
    if (holdValue <= liquidationValue) return horizonDays;
  }
  return null;
}

function calculateRisk(item, rule) {
  let score = 0;
  if (item.aged > 0) score += 4;
  if (item.excess > 0) score += 3;
  if (item.daysSupply >= 180) score += 3;
  else if (item.daysSupply >= 90) score += 1;
  if (item.available > 0 && item.sales30 === 0) score += 3;
  const risk = score >= 9 ? "高" : score >= 4 ? "中" : "低";
  const action = risk === "高"
    ? (item.sales30 === 0 ? "停止补货并优先清算/移除" : "优先评估清算")
    : risk === "中" ? "促销、降价或暂停补货" : "继续观察";
  return { score, risk, action };
}

function mergeDefined(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && value !== undefined && value !== "") target[key] = value;
  }
}

function mergeMissing(target, source) {
  for (const [key, value] of Object.entries(source)) {
    const missing = target[key] === null || target[key] === undefined || target[key] === "";
    const emptyNumeric = ["price", "productCost", "productCostRate", "firstMileCost", "firstMileRate", "fulfillmentFee", "fulfillmentFeeRate", "referralFee"].includes(key) && !Number.isFinite(target[key]);
    if ((missing || emptyNumeric) && value !== null && value !== undefined && value !== "") target[key] = value;
  }
}

export function analyzeSources(parsedSources, marketplace = "US", options = {}) {
  const rule = MARKET_RULES[marketplace];
  if (!rule) throw new Error(`Unsupported marketplace: ${marketplace}`);
  const analysisDate = String(options.analysisDate || new Date().toISOString().slice(0, 10));
  if (analysisDate < rule.effectiveFrom) {
    throw new Error(`${marketplace} 费率从 ${rule.effectiveFrom} 起生效，不能用于 ${analysisDate} 的测算。`);
  }
  const byType = { inventory: [], age: [], charge: [], commission: [], products: [], costs: [] };
  for (const source of parsedSources) {
    if (byType[source.type]) byType[source.type].push(...source.rows);
  }

  const items = new Map();
  const ensure = (source) => {
    const key = source.sku || source.fnsku || source.asin;
    if (!key) return null;
    if (!items.has(key)) items.set(key, { sku: source.sku || "", fnsku: source.fnsku || "", asin: source.asin || "", age: {}, ageMode: "" });
    return items.get(key);
  };

  for (const row of byType.inventory) mergeDefined(ensure(row), row);
  if (!items.size) for (const row of byType.age) mergeDefined(ensure(row), row);

  const skuIndex = () => new Map([...items.values()].filter((item) => item.sku).map((item) => [item.sku, item]));
  let bySku = skuIndex();
  for (const type of ["products", "commission", "costs"]) {
    for (const row of byType[type]) {
      const item = bySku.get(row.sku);
      if (item) mergeMissing(item, row);
    }
  }

  const latestAge = new Map();
  byType.age.forEach((row, index) => {
    const rank = stableSnapshotRank(row.snapshot, index);
    const current = latestAge.get(row.sku);
    if (!current || rank > current.rank) latestAge.set(row.sku, { rank, row });
  });
  bySku = skuIndex();
  for (const { row } of latestAge.values()) {
    const item = bySku.get(row.sku);
    if (item) {
      item.age = row.age;
      item.ageMode = "detailed";
      item.ageSnapshot = row.snapshot || item.ageSnapshot || "";
      if (!item.asin) item.asin = row.asin;
      if (!item.product) item.product = row.product;
    }
  }

  const byFnsku = new Map([...items.values()].filter((item) => item.fnsku).map((item) => [item.fnsku, item]));
  const byAsin = new Map([...items.values()].filter((item) => item.asin).map((item) => [item.asin, item]));
  for (const row of byType.charge) {
    const item = byFnsku.get(row.fnsku) || byAsin.get(row.asin) || bySku.get(row.sku);
    if (!item) continue;
    item.storageFee = valueOrZero(item.storageFee) + row.storageFee;
    if (!Number.isFinite(item.weight) && Number.isFinite(row.weight)) item.weight = row.weight;
    if (!Number.isFinite(item.volume) && Number.isFinite(row.volume)) item.volume = row.volume;
    item.sizeTier = row.sizeTier || item.sizeTier || "standard";
    item.chargeMonth = row.chargeMonth || item.chargeMonth;
  }

  const parsedAnalysisDate = new Date(`${analysisDate}T00:00:00`);
  const month = options.month ?? (Number.isFinite(parsedAnalysisDate.getTime()) ? parsedAnalysisDate.getMonth() + 1 : new Date().getMonth() + 1);
  const defaultProductCostRate = rateOrNull(options.defaultProductCostRate);
  const defaultFulfillmentFeeRate = rateOrNull(options.defaultFulfillmentFeeRate);
  const defaultFirstMileRate = rateOrNull(options.defaultFirstMileRate);
  const analyzed = [...items.values()].map((item, index) => {
    const available = Number.isFinite(item.available) ? Math.max(0, item.available) : sumAge(item.age);
    const sales30 = Math.max(0, valueOrZero(item.sales30));
    const excess = Number.isFinite(item.excess) ? Math.max(0, item.excess) : Math.max(0, available - sales30 * 3);
    const daysSupply = available === 0 ? 0 : sales30 > 0 ? Math.min(999, Math.round(available / sales30 * 30)) : 999;
    const normalized = {
      ...item,
      sku: item.sku || `UNMATCHED-${index + 1}`,
      product: item.product || "未提供商品名称",
      available,
      sales30,
      excess,
      daysSupply,
      price: valueOrZero(item.price),
      sizeTier: item.sizeTier || "standard",
    };
    normalized.productCostRate = Number.isFinite(normalized.productCostRate) ? normalized.productCostRate : defaultProductCostRate;
    normalized.fulfillmentFeeRate = Number.isFinite(normalized.fulfillmentFeeRate) ? normalized.fulfillmentFeeRate : defaultFulfillmentFeeRate;
    normalized.firstMileRate = Number.isFinite(normalized.firstMileRate) ? normalized.firstMileRate : defaultFirstMileRate;
    normalized.productCost = Number.isFinite(normalized.productCost)
      ? normalized.productCost
      : Number.isFinite(normalized.productCostRate) && normalized.price > 0
        ? normalized.price * normalized.productCostRate
        : null;
    normalized.fulfillmentFee = Number.isFinite(normalized.fulfillmentFee)
      ? normalized.fulfillmentFee
      : Number.isFinite(normalized.fulfillmentFeeRate) && normalized.price > 0
        ? normalized.price * normalized.fulfillmentFeeRate
        : null;
    normalized.firstMileCost = Number.isFinite(normalized.firstMileCost)
      ? normalized.firstMileCost
      : Number.isFinite(normalized.firstMileRate) && normalized.price > 0
        ? normalized.price * normalized.firstMileRate
        : null;
    normalized.aged = agedUnits(normalized, rule);
    normalized.actionUnits = normalized.aged;
    normalized.storageEstimate = monthlyStorage(normalized, rule, month);
    normalized.agedFee = ageFee(normalized, rule);
    normalized.removalFeeUnit = feeFromTier(rule.removal[normalized.sizeTier], normalized.weight, rule.incrementRounding);
    normalized.processingFeeUnit = feeFromTier(rule.processing[normalized.sizeTier], normalized.weight, rule.incrementRounding);
    normalized.liquidationGross = normalized.price * normalized.actionUnits * LIQUIDATION.grossRecoveryRate;
    normalized.liquidationReferral = normalized.liquidationGross * LIQUIDATION.referralFeeRate;
    normalized.liquidationNet = normalized.processingFeeUnit === null
      ? null
      : normalized.liquidationGross - normalized.liquidationReferral - normalized.processingFeeUnit * normalized.actionUnits;
    normalized.removalFee = normalized.removalFeeUnit === null ? null : normalized.removalFeeUnit * normalized.actionUnits;
    normalized.knownProductCost = Number.isFinite(normalized.productCost) ? normalized.productCost * normalized.actionUnits : null;
    normalized.knownFirstMileCost = Number.isFinite(normalized.firstMileCost) ? normalized.firstMileCost * normalized.actionUnits : null;
    normalized.removalTotalLoss = Number.isFinite(normalized.removalFee)
      && Number.isFinite(normalized.knownProductCost)
      && Number.isFinite(normalized.knownFirstMileCost)
      ? -(normalized.removalFee + normalized.knownProductCost + normalized.knownFirstMileCost)
      : null;
    normalized.normalSaleNetPerUnit = normalized.price > 0
      && Number.isFinite(normalized.referralFee)
      && Number.isFinite(normalized.fulfillmentFee)
      ? normalized.price - normalized.referralFee - normalized.fulfillmentFee
      : null;
    normalized.normalSaleFullProfitPerUnit = Number.isFinite(normalized.normalSaleNetPerUnit)
      && Number.isFinite(normalized.productCost)
      && Number.isFinite(normalized.firstMileCost)
      ? normalized.normalSaleNetPerUnit - normalized.productCost - normalized.firstMileCost
      : null;
    normalized.liquidationBookProfit = Number.isFinite(normalized.liquidationNet)
      && Number.isFinite(normalized.knownProductCost)
      && Number.isFinite(normalized.knownFirstMileCost)
      ? normalized.liquidationNet - normalized.knownProductCost - normalized.knownFirstMileCost
      : null;
    Object.assign(normalized, calculateRisk(normalized, rule));
    normalized.forecasts = FORECAST_HORIZONS.map((horizonDays) => forecastHolding(normalized, rule, horizonDays, month));
    normalized.breakEvenDays = breakEvenDays(normalized, rule, month);
    return normalized;
  });

  analyzed.sort((a, b) => b.score - a.score || b.excess - a.excess);
  const sum = (field) => analyzed.reduce((total, row) => total + (Number.isFinite(row[field]) ? row[field] : 0), 0);
  const countReady = (field) => analyzed.filter((row) => Number.isFinite(row[field])).length;
  const actionRows = analyzed.filter((row) => row.actionUnits > 0);
  const decisionBreakEvenDays = portfolioBreakEvenDays(analyzed, rule, month);
  const detailedAgeRows = analyzed.filter((row) => row.ageMode === "detailed");
  const ageBuckets = DETAILED_AGE_BUCKETS.map((bucket) => {
    const rowsWithUnits = detailedAgeRows.filter((row) => valueOrZero(row.age?.[bucket]) > 0);
    return {
      bucket,
      units: detailedAgeRows.reduce((total, row) => total + valueOrZero(row.age?.[bucket]), 0),
      skuCount: rowsWithUnits.length,
      charged: bucket !== "0-180" && Number(bucket.split("-")[0].replace("+", "")) >= rule.ageStart,
    };
  });
  const ageSnapshot = detailedAgeRows.map((row) => row.ageSnapshot).find((value) => value) || "";
  const forecasts = FORECAST_HORIZONS.map((horizonDays) => {
    const rowForecasts = actionRows.map((row) => row.forecasts.find((forecast) => forecast.horizonDays === horizonDays));
    const sumForecast = (field) => rowForecasts.reduce((total, forecast) => total + (Number.isFinite(forecast?.[field]) ? forecast[field] : 0), 0);
    const countForecastReady = (field) => rowForecasts.filter((forecast) => Number.isFinite(forecast?.[field])).length;
    const baseStorageCost = sumForecast("baseStorageCost");
    const agedSurchargeCost = sumForecast("agedSurchargeCost");
    const totalHoldingCost = sumForecast("totalHoldingCost");
    const holdThenLiquidateValue = sumForecast("holdThenLiquidateValue");
    const complete = actionRows.length > 0 && countForecastReady("holdThenLiquidateValue") === actionRows.length;
    const recommendation = complete
      ? recommendScenario(holdThenLiquidateValue, sum("liquidationNet"), horizonDays)
      : { key: "pending", label: actionRows.length ? "补全费用后再比较" : "无需处理", value: null };
    const sensitivity = SALES_SCENARIOS.map((scenario) => {
      const scenarioForecasts = actionRows.map((row) => forecastHolding(row, rule, horizonDays, month, scenario.multiplier));
      const scenarioReady = scenarioForecasts.filter((item) => Number.isFinite(item.holdThenLiquidateValue)).length;
      const scenarioHoldValue = scenarioForecasts.reduce((total, item) => total + (Number.isFinite(item.holdThenLiquidateValue) ? item.holdThenLiquidateValue : 0), 0);
      const scenarioHoldingCost = scenarioForecasts.reduce((total, item) => total + (Number.isFinite(item.totalHoldingCost) ? item.totalHoldingCost : 0), 0);
      return {
        ...scenario,
        totalHoldingCost: scenarioHoldingCost,
        holdThenLiquidateValue: scenarioReady === actionRows.length && actionRows.length > 0 ? scenarioHoldValue : null,
        recommendation: scenarioReady === actionRows.length && actionRows.length > 0
          ? recommendScenario(scenarioHoldValue, sum("liquidationNet"), horizonDays)
          : { key: "pending", label: actionRows.length ? "补全费用后再比较" : "无需处理", value: null },
      };
    });
    return {
      horizonDays,
      expectedSoldUnits: sumForecast("expectedSoldUnits"),
      remainingUnits: sumForecast("remainingUnits"),
      baseStorageCost,
      agedSurchargeCost,
      totalHoldingCost,
      holdThenLiquidateValue: complete ? holdThenLiquidateValue : null,
      recommendation,
      sensitivity,
      readiness: {
        actionSkuCount: actionRows.length,
        storage: countForecastReady("totalHoldingCost"),
        comparison: countForecastReady("holdThenLiquidateValue"),
      },
    };
  });
  const warnings = [];
  if (!byType.charge.length) warnings.push("未识别仓储收费报告：重量、体积、仓储费、清算处理费和移除费可能无法完整测算。");
  if (!detailedAgeRows.length) warnings.push("未识别详细库龄数据：UK/DE 的 241–270 天库存无法从合并区间中准确拆分。");
  if (!analyzed.some((row) => row.price > 0)) warnings.push("未识别售价数据：缺少价格的 SKU 无法测算清算预计净回收。");
  if (!analyzed.some((row) => Number.isFinite(row.productCost))) warnings.push("未提供采购成本占售价比例或单件金额：清算预计净回收不能换算为账面损益。");
  if (!analyzed.some((row) => Number.isFinite(row.fulfillmentFee))) warnings.push("未提供 FBA 配送费占售价比例或单件金额：不能计算正常销售单件净回款和完整利润。");
  if (!analyzed.some((row) => Number.isFinite(row.firstMileCost))) warnings.push("未提供头程占售价比例或单件头程：完整利润暂不扣除头程。");
  warnings.push("清算和移除费用仅按进入长期仓储计费区间的库存测算，不按预计冗余库存测算。");
  warnings.push("继续持有预测仅覆盖当前已进入长期仓储计费区间的库存；按当前 30 天销量线性延续、最老库存优先售出，并按月累计基础仓储费与库存龄附加费。");
  warnings.push("库龄区间预测按各区间下限推进，属于偏保守的收费时点估算；执行前应以 Seller Central 费率预览为准。");
  if (actionRows.some((row) => row.forecasts.some((forecast) => !Number.isFinite(forecast.totalHoldingCost)))) warnings.push("部分计费 SKU 缺少体积或仓储收费数据，继续持有费用为已覆盖部分，不能视为完整预算。");
  warnings.push("未填写移除后回收价值和下游处理成本：移除总损失包含采购成本、头程和 Amazon 移除费，但不参与最终收益比较。");

  return {
    marketplace,
    rule,
    analysisDate,
    rows: analyzed,
    reports: parsedSources.map(({ fileName, sheetName, type, label, rows }) => ({ fileName, sheetName, type, label, rowCount: rows.length })),
    warnings,
    summary: {
      skuCount: analyzed.length,
      available: sum("available"),
      transfer: sum("transfer"),
      excess: sum("excess"),
      aged: sum("aged"),
      actionUnits: sum("actionUnits"),
      cappedActionUnits: analyzed.reduce((total, row) => total + Math.min(row.actionUnits, row.available), 0),
      storage: sum("storageEstimate"),
      agedFee: sum("agedFee"),
      liquidationNet: sum("liquidationNet"),
      liquidationBookProfit: sum("liquidationBookProfit"),
      removalFee: sum("removalFee"),
      removalTotalLoss: sum("removalTotalLoss"),
      forecasts,
      decisionBreakEvenDays,
      ageBuckets,
      ageSnapshot,
      riskCounts: {
        high: analyzed.filter((row) => row.risk === "高").length,
        medium: analyzed.filter((row) => row.risk === "中").length,
        low: analyzed.filter((row) => row.risk === "低").length,
      },
      readiness: {
        price: analyzed.filter((row) => row.price > 0).length,
        fee: countReady("removalFee"),
        age: analyzed.filter((row) => sumAge(row.age) > 0).length,
        detailedAge: detailedAgeRows.length,
        productCost: countReady("productCost"),
        fulfillmentFee: countReady("fulfillmentFee"),
        firstMile: countReady("firstMileCost"),
        saleProfit: countReady("normalSaleFullProfitPerUnit"),
        bookPnl: actionRows.filter((row) => Number.isFinite(row.liquidationBookProfit)).length,
        removalLoss: actionRows.filter((row) => Number.isFinite(row.removalTotalLoss)).length,
        actionSkuCount: actionRows.length,
      },
    },
  };
}

export function createDemoAnalysis(marketplace = "US", options = {}) {
  const demoAnalysisDate = options.analysisDate ?? "2026-07-16";
  const parsedDemoDate = new Date(`${demoAnalysisDate}T00:00:00`);
  const inventory = [
    ["DEMO-001", "B0DEMO0001", "手工编织工具套装", 180, 0, 0, 180, 24.99],
    ["DEMO-002", "B0DEMO0002", "派对装饰组合", 96, 3, 87, 60, 16.99],
    ["DEMO-003", "B0DEMO0003", "木质绘画手工包", 240, 42, 114, 18, 21.99],
    ["DEMO-004", "B0DEMO0004", "节日礼品袋套装", 72, 0, 72, 40, 12.99],
    ["DEMO-005", "B0DEMO0005", "儿童串珠活动套装", 140, 65, 0, 0, 19.99],
    ["DEMO-006", "B0DEMO0006", "家居礼品篮", 58, 8, 34, 22, 34.99],
    ["DEMO-007", "B0DEMO0007", "毛线补充包", 44, 28, 0, 0, 26.99],
    ["DEMO-008", "B0DEMO0008", "主题生日横幅", 110, 5, 95, 30, 14.99],
  ].map(([sku, asin, product, available, sales30, excess, aged, price], index) => ({
    sku, fnsku: `X00DEMO0${index + 1}`, asin, product, available, transfer: index % 3,
    sales30, excess, price, ageMode: "detailed",
    age: { "0-180": Math.max(0, available - aged), "181-210": aged * 0.55, "211-240": aged * 0.25, "241-270": aged * 0.2, "271-300": 0, "301-330": 0, "331-365": 0, "366-455": 0, "456+": 0 },
  }));
  const rule = MARKET_RULES[marketplace];
  const charge = inventory.map((row, index) => ({
    fnsku: row.fnsku, asin: row.asin, storageFee: row.available * (1.1 + index * 0.17),
    weight: rule.weightUnit === "lb" ? 0.7 + index * 0.35 : 0.32 + index * 0.16,
    volume: rule.volumeUnit === "cuft" ? 0.08 + index * 0.01 : 0.0023 + index * 0.0003,
    sizeTier: index === 5 ? "oversize" : "standard", chargeMonth: "2026-07",
  }));
  const costs = inventory.map((row, index) => ({
    sku: row.sku,
    productCostRate: 0.28 + index * 0.005,
    fulfillmentFeeRate: 0.18,
    referralFee: row.price * 0.15,
    firstMileRate: 0.08,
  }));
  return analyzeSources([
    { fileName: "脱敏演示库存.xlsx", sheetName: "Demo", type: "inventory", label: REPORT_LABELS.inventory, rows: inventory },
    { fileName: "脱敏演示收费.xlsx", sheetName: "Demo", type: "charge", label: REPORT_LABELS.charge, rows: charge },
    { fileName: "脱敏演示成本.xlsx", sheetName: "Demo", type: "costs", label: REPORT_LABELS.costs, rows: costs },
  ], marketplace, {
    month: options.month ?? (Number.isFinite(parsedDemoDate.getTime()) ? parsedDemoDate.getMonth() + 1 : 7),
    analysisDate: demoAnalysisDate,
  });
}

export function exportRowsToCsv(rows, currency) {
  const forecastHeaders = FORECAST_HORIZONS.flatMap((horizonDays) => [
    `Hold${horizonDays}ExpectedSoldUnits`, `Hold${horizonDays}RemainingUnits`,
    `Hold${horizonDays}BaseStorage_${currency}`, `Hold${horizonDays}AgedSurcharge_${currency}`,
    `Hold${horizonDays}TotalHoldingCost_${currency}`, `Hold${horizonDays}ThenLiquidateValue_${currency}`,
    `Hold${horizonDays}Recommendation`,
  ]);
  const headers = ["SKU", "ASIN", "Product", "Risk", "Action", "Available", "Sales30", "DaysSupply", "AgedUnits", "ActionUnits_AgedOnly", "ExcessUnits", `SalePrice_${currency}`, "ProductCostRate", `ProductCost_${currency}`, "FBAFulfillmentFeeRate", `FBAFulfillmentFee_${currency}`, "FirstMileRate", `FirstMileCost_${currency}`, `NormalSaleNetPerUnit_${currency}`, `NormalSaleFullProfitPerUnit_${currency}`, `Storage_${currency}`, `AgedFee_${currency}`, `LiquidationNet_${currency}`, `LiquidationBookProfit_${currency}`, `AmazonRemovalFee_${currency}`, `RemovalTotalLoss_${currency}`, "BreakEvenDays", ...forecastHeaders];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((row) => {
    const forecastValues = FORECAST_HORIZONS.flatMap((horizonDays) => {
      const forecast = row.forecasts.find((item) => item.horizonDays === horizonDays);
      return [
        forecast.expectedSoldUnits, forecast.remainingUnits, forecast.baseStorageCost,
        forecast.agedSurchargeCost, forecast.totalHoldingCost, forecast.holdThenLiquidateValue,
        forecast.recommendation.label,
      ];
    });
    return [row.sku, row.asin, row.product, row.risk, row.action, row.available, row.sales30,
    row.daysSupply, row.aged, row.actionUnits, row.excess, row.price, row.productCostRate, row.productCost,
    row.fulfillmentFeeRate, row.fulfillmentFee, row.firstMileRate, row.firstMileCost,
    row.normalSaleNetPerUnit, row.normalSaleFullProfitPerUnit,
    row.storageEstimate, row.agedFee, row.liquidationNet, row.liquidationBookProfit, row.removalFee, row.removalTotalLoss,
    row.breakEvenDays, ...forecastValues,
  ].map(escape).join(",");
  });
  return ["\ufeff" + headers.join(","), ...lines].join("\r\n");
}
