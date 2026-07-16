import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  analyzeSources,
  createDemoAnalysis,
  detectReportType,
  exportRowsToCsv,
  workbookToSources,
} from "../src/analyzer.js";

test("detects the six supported report types", () => {
  assert.equal(detectReportType(["sku", "available", "units-shipped-t30"]), "inventory");
  assert.equal(detectReportType(["merchant_sku", "0 - 180", "181 - 210"]), "age");
  assert.equal(detectReportType(["fnsku", "estimated_monthly_storage_fee"]), "charge");
  assert.equal(detectReportType(["seller-sku", "estimated-referral-fee-per-item"]), "commission");
  assert.equal(detectReportType(["seller-sku", "item-name", "asin1"]), "products");
  assert.equal(detectReportType(["seller-sku", "unit-cost-rate", "fulfillment-fee-rate", "first-mile-cost-rate"]), "costs");
});

test("parses and merges synthetic reports without server state", () => {
  const workbook = XLSX.utils.book_new();
  const inventory = XLSX.utils.aoa_to_sheet([
    ["snapshot-date", "sku", "fnsku", "asin", "product-name", "available", "fc-transfer", "units-shipped-t30", "estimated-excess-quantity", "your-price", "inv-age-181-to-270-days"],
    ["2026-07-14", "DEMO-TEST-001", "X00DEMO001", "B0DEMO0001", "Demo Product", 100, 5, 10, 70, 20, 70],
  ]);
  XLSX.utils.book_append_sheet(workbook, inventory, "Inventory");
  const parsed = workbookToSources(workbook, "demo-inventory.xlsx", XLSX, "US");
  assert.equal(parsed[0].type, "inventory");
  assert.equal(parsed[0].rows.length, 1);

  const result = analyzeSources([
    ...parsed,
    {
      fileName: "demo-charge.xlsx",
      sheetName: "Charge",
      type: "charge",
      label: "仓储收费报告",
      rows: [{ fnsku: "X00DEMO001", asin: "B0DEMO0001", storageFee: 12.5, weight: 1, volume: 0.1, sizeTier: "standard" }],
    },
  ], "US", { month: 7 });
  assert.equal(result.summary.skuCount, 1);
  assert.equal(result.summary.excess, 70);
  assert.equal(result.summary.actionUnits, 70);
  assert.equal(result.summary.storage, 12.5);
  assert.ok(Math.abs(result.rows[0].removalFee - 107.1) < 1e-9);
  assert.equal(result.rows[0].liquidationGross, 105);
  assert.equal(result.rows[0].liquidationReferral, 15.75);
  assert.equal(result.rows[0].liquidationProcessing, 21);
  assert.equal(result.rows[0].liquidationFee, 36.75);
  assert.equal(result.rows[0].liquidationNet, 68.25);
  assert.equal(result.summary.liquidationFee, 36.75);
});

test("liquidation headline excludes product and first-mile costs", () => {
  const result = analyzeSources([{
    fileName: "demo.csv",
    sheetName: "Sheet1",
    type: "inventory",
    label: "库存报告",
    rows: [{
      sku: "DEMO-COST-001",
      asin: "B0DEMO0002",
      product: "Demo Cost Product",
      available: 10,
      sales30: 0,
      excess: 4,
      price: 100,
      productCost: 30,
      firstMileCost: 5,
      referralFee: 15,
      fulfillmentFee: 10,
      ageMode: "detailed",
      age: { "181-210": 10 },
      weight: 0.4,
      sizeTier: "standard",
    }],
  }], "US");
  const row = result.rows[0];
  assert.equal(row.liquidationNet, 61.25);
  assert.equal(row.actionUnits, 10);
  assert.equal(row.excess, 4);
  assert.equal(row.knownProductCost, 300);
  assert.equal(row.knownFirstMileCost, 50);
  assert.equal(row.normalSaleNetPerUnit, 75);
  assert.equal(row.normalSaleFullProfitPerUnit, 40);
  assert.equal(row.liquidationBookProfit, -288.75);
  assert.ok(Math.abs(row.removalFee - 8.4) < 1e-9);
  assert.ok(Math.abs(row.removalTotalLoss + 358.4) < 1e-9);
});

test("uses global sale-price percentages for all three estimated costs", () => {
  const result = analyzeSources([{
    fileName: "demo.csv",
    sheetName: "Sheet1",
    type: "inventory",
    label: "库存报告",
    rows: [{
      sku: "DEMO-RATE-001",
      available: 5,
      sales30: 1,
      excess: 2,
      price: 100,
      referralFee: 15,
      weight: 0.4,
      sizeTier: "standard",
      ageMode: "detailed",
      age: { "181-210": 2 },
    }],
  }], "US", { defaultProductCostRate: 30, defaultFulfillmentFeeRate: 18, defaultFirstMileRate: 8 });
  const row = result.rows[0];
  assert.equal(row.productCostRate, 0.3);
  assert.equal(row.productCost, 30);
  assert.equal(row.fulfillmentFeeRate, 0.18);
  assert.equal(row.fulfillmentFee, 18);
  assert.equal(row.firstMileRate, 0.08);
  assert.equal(row.firstMileCost, 8);
  assert.equal(row.normalSaleFullProfitPerUnit, 29);
});

test("parses a cost supplement and merges it by seller SKU", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["seller-sku", "unit-cost-rate", "fulfillment-fee-rate", "first-mile-cost-rate"],
    ["DEMO-COST-002", "30%", 18, "7.5%"],
  ]), "Costs");
  const parsed = workbookToSources(workbook, "costs.xlsx", XLSX, "US");
  assert.equal(parsed[0].type, "costs");
  assert.equal(parsed[0].rows[0].productCostRate, 0.3);
  assert.equal(parsed[0].rows[0].fulfillmentFeeRate, 0.18);
  assert.equal(parsed[0].rows[0].firstMileRate, 0.075);

  const result = analyzeSources([{
    fileName: "inventory.xlsx",
    sheetName: "Inventory",
    type: "inventory",
    label: "库存报告",
    rows: [{ sku: "DEMO-COST-002", available: 10, sales30: 2, excess: 4, price: 20, referralFee: 3, weight: 0.5, sizeTier: "standard", ageMode: "detailed", age: { "181-210": 3 } }],
  }, ...parsed], "US");
  const row = result.rows[0];
  assert.equal(row.productCost, 6);
  assert.ok(Math.abs(row.fulfillmentFee - 3.6) < 1e-9);
  assert.equal(row.firstMileCost, 1.5);
  assert.ok(Math.abs(row.normalSaleFullProfitPerUnit - 5.9) < 1e-9);
});

test("public demo uses only synthetic identifiers", () => {
  for (const marketplace of ["US", "CA", "UK", "DE"]) {
    const result = createDemoAnalysis(marketplace);
    assert.equal(result.rows.length, 8);
    assert.ok(result.rows.every((row) => row.sku.startsWith("DEMO-")));
    assert.equal(result.rule.marketplace, marketplace);
    assert.equal(result.summary.ageBuckets.length, 9);
    assert.equal(result.summary.forecasts.length, 4);
    assert.ok(result.summary.forecasts.every((forecast) => Number.isFinite(forecast.totalHoldingCost)));
    const bucketUnits = result.summary.ageBuckets.reduce((total, bucket) => total + bucket.units, 0);
    assert.ok(Math.abs(bucketUnits - result.summary.available) < 1e-9);
  }
  const us = createDemoAnalysis("US");
  assert.equal(us.summary.ageBuckets.find((bucket) => bucket.bucket === "181-210").charged, true);
  const uk = createDemoAnalysis("UK");
  assert.equal(uk.summary.ageBuckets.find((bucket) => bucket.bucket === "181-210").charged, false);
  assert.equal(uk.summary.ageBuckets.find((bucket) => bucket.bucket === "241-270").charged, true);
});

test("forecasts cumulative holding cost and remaining charged inventory", () => {
  const result = analyzeSources([{
    fileName: "forecast.csv",
    sheetName: "Sheet1",
    type: "inventory",
    label: "库存报告",
    rows: [{
      sku: "DEMO-FORECAST-001",
      available: 10,
      sales30: 1,
      price: 100,
      referralFee: 15,
      fulfillmentFee: 10,
      weight: 0.4,
      volume: 0.1,
      sizeTier: "standard",
      ageMode: "detailed",
      age: { "181-210": 10 },
    }],
  }], "US", { month: 7 });
  const forecast30 = result.rows[0].forecasts.find((forecast) => forecast.horizonDays === 30);
  const forecast90 = result.rows[0].forecasts.find((forecast) => forecast.horizonDays === 90);
  assert.equal(forecast30.expectedSoldUnits, 1);
  assert.equal(forecast30.remainingUnits, 9);
  assert.ok(Math.abs(forecast30.baseStorageCost - 0.741) < 1e-9);
  assert.ok(Math.abs(forecast30.agedSurchargeCost - 0.9) < 1e-9);
  assert.ok(forecast90.totalHoldingCost > forecast30.totalHoldingCost);
  assert.equal(forecast90.remainingUnits, 7);
  assert.equal(forecast30.recommendation.key, "hold");
  assert.equal(result.summary.forecasts.length, 4);
});

test("CSV export includes auditable forecasts for every decision horizon", () => {
  const result = createDemoAnalysis("US");
  const csv = exportRowsToCsv(result.rows, result.rule.currency);
  assert.match(csv, /Hold30TotalHoldingCost_USD/);
  assert.match(csv, /Hold90TotalHoldingCost_USD/);
  assert.match(csv, /Hold180TotalHoldingCost_USD/);
  assert.match(csv, /Hold90Recommendation/);
  assert.match(csv, /BreakEvenDays/);
});

test("removal stays outside recommendations when recovery is unknown", () => {
  const result = createDemoAnalysis("US");
  for (const row of result.rows) {
    assert.notEqual(row.forecasts.find((forecast) => forecast.horizonDays === 90).recommendation.key, "remove");
  }
  assert.notEqual(result.summary.forecasts.find((forecast) => forecast.horizonDays === 90).recommendation.key, "remove");
});

test("forecast includes three sales sensitivity scenarios", () => {
  const result = createDemoAnalysis("US");
  const forecast = result.summary.forecasts.find((item) => item.horizonDays === 90);
  assert.deepEqual(forecast.sensitivity.map((item) => item.multiplier), [0.7, 1, 1.3]);
  assert.ok(forecast.sensitivity.every((item) => Number.isFinite(item.totalHoldingCost)));
  assert.equal(result.summary.decisionBreakEvenDays, 31);
});

test("rejects analysis dates before the selected fee version", () => {
  assert.throws(() => createDemoAnalysis("UK", { analysisDate: "2026-06-30", month: 6 }), /费率从 2026-07-01 起生效/);
});
