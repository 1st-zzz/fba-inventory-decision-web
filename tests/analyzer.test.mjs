import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  analyzeSources,
  createDemoAnalysis,
  detectReportType,
  workbookToSources,
} from "../src/analyzer.js";

test("detects the five supported report types", () => {
  assert.equal(detectReportType(["sku", "available", "units-shipped-t30"]), "inventory");
  assert.equal(detectReportType(["merchant_sku", "0 - 180", "181 - 210"]), "age");
  assert.equal(detectReportType(["fnsku", "estimated_monthly_storage_fee"]), "charge");
  assert.equal(detectReportType(["seller-sku", "estimated-referral-fee-per-item"]), "commission");
  assert.equal(detectReportType(["seller-sku", "item-name", "asin1"]), "products");
});

test("parses and merges synthetic reports without server state", () => {
  const workbook = XLSX.utils.book_new();
  const inventory = XLSX.utils.aoa_to_sheet([
    ["snapshot-date", "sku", "fnsku", "asin", "product-name", "available", "fc-transfer", "units-shipped-t30", "estimated-excess-quantity", "your-price"],
    ["2026-07-14", "DEMO-TEST-001", "X00DEMO001", "B0DEMO0001", "Demo Product", 100, 5, 10, 70, 20],
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
  assert.equal(result.summary.storage, 12.5);
  assert.ok(Math.abs(result.rows[0].removalFee - 107.1) < 1e-9);
  assert.equal(result.rows[0].liquidationNet, 68.25);
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
      excess: 10,
      price: 100,
      productCost: 30,
      firstMileCost: 5,
      ageMode: "detailed",
      age: {},
      weight: 0.4,
      sizeTier: "standard",
    }],
  }], "US");
  const row = result.rows[0];
  assert.equal(row.liquidationNet, 61.25);
  assert.equal(row.knownProductCost, 300);
  assert.equal(row.knownFirstMileCost, 50);
});

test("public demo uses only synthetic identifiers", () => {
  for (const marketplace of ["US", "CA", "UK", "DE"]) {
    const result = createDemoAnalysis(marketplace);
    assert.equal(result.rows.length, 8);
    assert.ok(result.rows.every((row) => row.sku.startsWith("DEMO-")));
    assert.equal(result.rule.marketplace, marketplace);
  }
});
