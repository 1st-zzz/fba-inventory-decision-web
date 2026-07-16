import "./styles.css";
import {
  analyzeSources,
  createDemoAnalysis,
  exportRowsToCsv,
  FORECAST_HORIZONS,
  workbookToSources,
} from "./analyzer.js";

const root = document.querySelector("#app");
let parsedSources = [];
let selectedFiles = [];
let current = createDemoAnalysis("US");
let usingDemo = true;
let query = "";
let riskFilter = "全部";
let selectedHorizon = 90;
let xlsxModule;

async function getXlsx() {
  xlsxModule ??= await import("xlsx");
  return xlsxModule;
}

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const number = (value, digits = 0) => new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: digits,
  minimumFractionDigits: digits,
}).format(Number(value || 0));

const money = (value) => new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: current.rule.currency,
  maximumFractionDigits: 2,
}).format(Number(value || 0));

const dateLabel = (value) => {
  if (!value) return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

root.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="FBA 库存决策台首页">
      <span class="brand-mark">F</span>
      <span>FBA 库存决策台<small>GitHub Pages · 本地分析版</small></span>
    </a>
    <div class="privacy-pill"><span></span>文件仅在当前浏览器处理</div>
  </header>

  <section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">FBA INVENTORY DECISION WORKSPACE</p>
      <h1>上传运营报告，<br><em>直接判断留、清、移</em></h1>
      <p>先给处理建议，再展开仓储费、长期仓储费、清算回收与移除损失。继续持有可预测 30 / 60 / 90 / 180 天。</p>
      <div class="hero-facts">
        <span>US / CA / UK / DE</span><span>XLSX / XLS / XLTX / CSV / TSV</span><span>不保存真实数据</span>
      </div>
    </div>
    <div class="upload-panel">
      <div class="upload-head">
        <div><span class="step">01</span><h2>选择站点与报告</h2></div>
        <label>Amazon 站点
          <select id="marketplace">
            <option value="US">美国 · USD</option>
            <option value="CA">加拿大 · CAD</option>
            <option value="UK">英国 · GBP</option>
            <option value="DE">德国 · EUR</option>
          </select>
        </label>
      </div>
      <label class="dropzone" id="dropzone">
        <input id="file-input" type="file" multiple accept=".xlsx,.xls,.xltx,.csv,.tsv" />
        <span class="upload-icon">＋</span>
        <strong>拖入或选择多个运营报告</strong>
        <small>可分多次选择；建议上传库存、库龄、收费、佣金、商品及成本补充表</small>
      </label>
      <div id="selected-files" class="selected-files"></div>
      <div class="cost-controls">
        <div class="cost-control-heading"><b>统一预估成本</b><small>全部按当前售价比例计算；成本表中的 SKU 比例优先</small></div>
        <label>采购成本（%）<input id="product-cost-rate" type="number" min="0" max="100" step="0.1" placeholder="例如 30" /></label>
        <label>FBA配送费（%）<input id="fulfillment-fee-rate" type="number" min="0" max="100" step="0.1" placeholder="例如 18" /></label>
        <label>头程（%）<input id="first-mile-rate" type="number" min="0" max="100" step="0.1" placeholder="例如 8" /></label>
        <button id="template-button" class="secondary-button" type="button">下载成本补充模板</button>
      </div>
      <div class="upload-actions">
        <button id="analyze-button" class="primary-button" disabled>开始本地分析</button>
        <button id="clear-button" class="secondary-button" disabled>清空文件</button>
        <button id="demo-button" class="secondary-button">恢复脱敏演示</button>
      </div>
      <p class="privacy-note"><b>隐私说明：</b>页面不会把文件发送到 GitHub。刷新或关闭页面后，本次选择和结果即被清除。</p>
    </div>
  </section>

  <section class="workspace">
    <div class="workspace-heading">
      <div><p class="eyebrow">DECISION OUTPUT</p><h2 id="result-title">脱敏演示结果</h2></div>
      <div class="result-actions">
        <span id="rule-version" class="rule-version"></span>
        <button id="export-button" class="text-button">导出分析 CSV</button>
      </div>
    </div>

    <div id="status-box"></div>
    <div id="report-strip" class="report-strip"></div>
    <div id="summary-grid" class="summary-grid"></div>

    <section class="decision-panel">
      <div class="decision-panel-head">
        <div><p class="eyebrow">DECISION FIRST</p><h2>现在怎么处理</h2></div>
        <div class="horizon-control" aria-label="选择继续持有天数">
          <span>继续持有</span>
          <div id="horizon-buttons"></div>
        </div>
      </div>
      <div id="recommendation-banner" class="recommendation-banner"></div>
      <div id="scenario-grid" class="scenario-grid"></div>
      <div class="forecast-panel">
        <div class="forecast-head">
          <div><p class="eyebrow">HOLDING COST FORECAST</p><h3>继续放置预计新增仓储费</h3></div>
          <div class="forecast-meta"><b id="forecast-coverage"></b><div class="forecast-legend"><span class="base-dot"></span>基础仓储费 <span class="aged-dot"></span>库存龄附加费</div></div>
        </div>
        <div id="forecast-chart" class="forecast-chart"></div>
        <p class="forecast-note">仅预测当前已进入长期仓储计费区间的库存；按当前 30 日销量线性延续、最老库存优先售出。金额为累计新增费用。</p>
      </div>
    </section>

    <section class="age-panel">
      <div class="age-panel-head">
        <div><p class="eyebrow">AGED INVENTORY BUCKETS</p><h2>库龄收费区间库存</h2></div>
        <p id="age-coverage"></p>
      </div>
      <div id="age-bucket-grid" class="age-bucket-grid"></div>
      <p class="age-note">数据来自最新库龄报告快照；与当前可售库存可能因快照日期、在途和调拨状态不同。</p>
    </section>

    <section class="table-panel">
      <div class="table-head">
        <div><p class="eyebrow">SKU ACTION LIST</p><h2>库存处理清单</h2></div>
        <div class="filters">
          <input id="search-input" type="search" placeholder="搜索 SKU / ASIN / 商品" />
          <select id="risk-filter">
            <option>全部</option><option>高</option><option>中</option><option>低</option>
          </select>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>SKU / 商品</th><th>风险</th><th>可售</th><th>30日销量</th><th>可售天数</th>
            <th>计费库龄</th><th>预计售出</th><th>期末剩余</th><th>继续放置费</th>
            <th>立即清算净回收</th><th>移除总损失</th><th>建议动作</th>
          </tr></thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>
      <p id="table-count" class="table-count"></p>
    </section>

    <section class="boundary">
      <div><p class="eyebrow">DATA READINESS</p><h2>结果边界与缺口</h2></div>
      <ul id="warning-list"></ul>
    </section>
  </section>

  <footer>
    <span>FBA 库存决策台</span>
    <p>公开页面仅含脱敏演示数据 · 运营报告只在浏览器内存中处理 · 不会自动创建清算或移除订单</p>
  </footer>
`;

const fileInput = document.querySelector("#file-input");
const dropzone = document.querySelector("#dropzone");
const analyzeButton = document.querySelector("#analyze-button");
const clearButton = document.querySelector("#clear-button");
const marketplace = document.querySelector("#marketplace");
const productCostRateInput = document.querySelector("#product-cost-rate");
const fulfillmentFeeRateInput = document.querySelector("#fulfillment-fee-rate");
const firstMileRateInput = document.querySelector("#first-mile-rate");

const fileKey = (file) => `${file.name}::${file.size}::${file.lastModified}`;

function appendFiles(files) {
  const known = new Set(selectedFiles.map(fileKey));
  for (const file of files) {
    if (!/\.(xlsx|xls|xltx|csv|tsv)$/i.test(file.name)) continue;
    const key = fileKey(file);
    if (!known.has(key)) {
      selectedFiles.push(file);
      known.add(key);
    }
  }
}

function inputRate(input) {
  const value = Number(input.value);
  return Number.isFinite(value) && input.value !== "" ? value / 100 : null;
}

function defaultCostRates() {
  return {
    defaultProductCostRate: inputRate(productCostRateInput),
    defaultFulfillmentFeeRate: inputRate(fulfillmentFeeRateInput),
    defaultFirstMileRate: inputRate(firstMileRateInput),
  };
}

function setStatus(message, kind = "info") {
  document.querySelector("#status-box").innerHTML = message
    ? `<div class="status ${kind}">${escapeHtml(message)}</div>`
    : "";
}

function updateSelectedFiles() {
  const container = document.querySelector("#selected-files");
  container.innerHTML = selectedFiles.map((file) => `
    <span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}<small>${number(file.size / 1024, 0)} KB</small><button type="button" data-file-key="${escapeHtml(fileKey(file))}" aria-label="移除 ${escapeHtml(file.name)}">×</button></span>
  `).join("");
  analyzeButton.disabled = selectedFiles.length === 0;
  clearButton.disabled = selectedFiles.length === 0;
}

function filteredRows() {
  const lowered = query.toLowerCase();
  return current.rows.filter((row) => {
    const matchesSearch = !lowered || [row.sku, row.asin, row.product].some((value) => String(value || "").toLowerCase().includes(lowered));
    return matchesSearch && (riskFilter === "全部" || row.risk === riskFilter);
  });
}

function riskBadge(risk) {
  return `<span class="risk risk-${risk === "高" ? "high" : risk === "中" ? "medium" : "low"}">${risk}</span>`;
}

function metric(label, value, note, tone = "") {
  return `<article class="metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function moneyOrPending(value) {
  return Number.isFinite(value) ? money(value) : "待补数据";
}

function selectedSummaryForecast() {
  return current.summary.forecasts.find((forecast) => forecast.horizonDays === selectedHorizon);
}

function rowForecast(row) {
  return row.forecasts.find((forecast) => forecast.horizonDays === selectedHorizon);
}

function recommendationAmount(forecast, summary) {
  if (forecast.recommendation.key === "hold") return forecast.holdThenLiquidateValue;
  if (forecast.recommendation.key === "liquidate") return summary.liquidationNet;
  if (forecast.recommendation.key === "remove") return -summary.removalFee;
  return null;
}

function render() {
  const { summary, rule } = current;
  const forecast = selectedSummaryForecast();
  document.querySelector("#result-title").textContent = usingDemo ? "脱敏演示结果" : "本地报告分析结果";
  document.querySelector("#rule-version").textContent = `${rule.marketplace} · ${rule.version} · ${rule.currency}`;
  document.querySelector("#summary-grid").innerHTML = [
    metric("需处理计费库存", number(summary.actionUnits), `${number(summary.readiness.actionSkuCount)} 个 SKU`, "warning"),
    metric("高风险 SKU", number(summary.riskCounts.high), `共 ${number(summary.skuCount)} 个 SKU`, "danger"),
    metric("预计冗余库存", number(summary.excess), "按 90 天销量覆盖估算", "warning"),
    metric("本月基础仓储费", money(summary.storage), `全部 ${number(summary.available)} 件库存`),
    metric("本月库存龄附加费", money(summary.agedFee), `${rule.marketplace} 从 ${rule.ageStart} 天起`),
  ].join("");

  document.querySelector("#horizon-buttons").innerHTML = FORECAST_HORIZONS.map((horizonDays) => `
    <button type="button" data-horizon="${horizonDays}" class="${horizonDays === selectedHorizon ? "active" : ""}">${horizonDays} 天</button>
  `).join("");

  const recommendationValue = recommendationAmount(forecast, summary);
  const completeComparison = forecast.readiness.actionSkuCount > 0
    && forecast.readiness.comparison === forecast.readiness.actionSkuCount;
  const recommendationTitle = summary.actionUnits <= 0 ? "当前无需处理计费库龄库存" : forecast.recommendation.label;
  const recommendationNote = completeComparison
    ? `已比较继续销售 ${selectedHorizon} 天后清算剩余、立即清算、立即移除三种未来现金路径。`
    : `当前可比较 ${number(forecast.readiness.comparison)}/${number(forecast.readiness.actionSkuCount)} 个计费 SKU；请补全价格、佣金、FBA 配送费、体积或重量。`;
  document.querySelector("#recommendation-banner").className = `recommendation-banner tone-${forecast.recommendation.key}`;
  document.querySelector("#recommendation-banner").innerHTML = `
    <div><span>当前建议 · 按 ${selectedHorizon} 天决策窗口</span><h3>${escapeHtml(recommendationTitle)}</h3><p>${escapeHtml(recommendationNote)}</p></div>
    <div class="recommendation-value"><span>该路径预计净现金贡献</span><strong>${moneyOrPending(recommendationValue)}</strong><small>不重复扣除已发生的采购成本与头程</small></div>
  `;

  const fullBookPnl = summary.readiness.actionSkuCount > 0
    && summary.readiness.bookPnl === summary.readiness.actionSkuCount;
  const liquidationBookPnl = summary.readiness.actionSkuCount === 0
    ? "无计费库存"
    : fullBookPnl ? money(summary.liquidationBookProfit) : `待补 ${number(summary.readiness.actionSkuCount - summary.readiness.bookPnl)} 个 SKU`;
  const fullRemovalLoss = summary.readiness.actionSkuCount > 0
    && summary.readiness.removalLoss === summary.readiness.actionSkuCount;
  const removalTotalLoss = summary.readiness.actionSkuCount === 0
    ? "无计费库存"
    : fullRemovalLoss ? money(summary.removalTotalLoss) : `待补 ${number(summary.readiness.actionSkuCount - summary.readiness.removalLoss)} 个 SKU`;
  document.querySelector("#scenario-grid").innerHTML = `
    <article class="scenario-card hold ${forecast.recommendation.key === "hold" ? "recommended" : ""}">
      <div><span>继续销售 ${selectedHorizon} 天，再清算剩余</span><b>${forecast.recommendation.key === "hold" ? "建议" : "路径一"}</b></div>
      <h3>${moneyOrPending(forecast.holdThenLiquidateValue)}</h3>
      <dl><div><dt>预计新增仓储费</dt><dd>-${moneyOrPending(forecast.totalHoldingCost)}</dd></div><div><dt>预计售出 / 期末剩余</dt><dd>${number(forecast.expectedSoldUnits)} / ${number(forecast.remainingUnits)} 件</dd></div></dl>
    </article>
    <article class="scenario-card liquidate ${forecast.recommendation.key === "liquidate" ? "recommended" : ""}">
      <div><span>立即清算</span><b>${forecast.recommendation.key === "liquidate" ? "建议" : "路径二"}</b></div>
      <h3>${money(summary.liquidationNet)}</h3>
      <dl><div><dt>清算预计净回收</dt><dd>${money(summary.liquidationNet)}</dd></div><div><dt>扣采购与头程后账面损益</dt><dd>${liquidationBookPnl}</dd></div></dl>
    </article>
    <article class="scenario-card remove ${forecast.recommendation.key === "remove" ? "recommended" : ""}">
      <div><span>立即移除</span><b>${forecast.recommendation.key === "remove" ? "建议" : "路径三"}</b></div>
      <h3>${money(-summary.removalFee)}</h3>
      <dl><div><dt>Amazon 移除费现金影响</dt><dd>${money(-summary.removalFee)}</dd></div><div><dt>含采购与头程的总损失</dt><dd>${removalTotalLoss}</dd></div></dl>
    </article>
  `;

  const maxForecastCost = Math.max(1, ...summary.forecasts.map((item) => item.totalHoldingCost || 0));
  document.querySelector("#forecast-coverage").textContent = `费用覆盖 ${number(forecast.readiness.storage)}/${number(forecast.readiness.actionSkuCount)} 个计费 SKU`;
  document.querySelector("#forecast-chart").innerHTML = summary.forecasts.map((item) => {
    const baseWidth = Math.max(0, item.baseStorageCost / maxForecastCost * 100);
    const agedWidth = Math.max(0, item.agedSurchargeCost / maxForecastCost * 100);
    return `
      <article class="forecast-row ${item.horizonDays === selectedHorizon ? "active" : ""}">
        <div class="forecast-label"><b>${item.horizonDays} 天</b><span>剩余 ${number(item.remainingUnits)} 件</span></div>
        <div class="forecast-bar" aria-label="${item.horizonDays} 天预计新增仓储费 ${money(item.totalHoldingCost)}">
          <span class="base" style="width:${baseWidth}%"></span><span class="aged" style="width:${agedWidth}%"></span>
        </div>
        <strong>${money(item.totalHoldingCost)}</strong>
      </article>`;
  }).join("");

  const ageBuckets = summary.ageBuckets || [];
  const ageCoverage = summary.readiness.detailedAge || 0;
  document.querySelector("#age-coverage").textContent = ageCoverage
    ? `明细覆盖 ${number(ageCoverage)}/${number(summary.skuCount)} 个 SKU${summary.ageSnapshot ? ` · 快照 ${dateLabel(summary.ageSnapshot)}` : ""}`
    : "未识别详细库龄报告";
  document.querySelector("#age-bucket-grid").innerHTML = ageCoverage
    ? ageBuckets.map((bucket) => `
      <article class="age-bucket ${bucket.charged ? "charged" : "not-charged"}">
        <div><b>${escapeHtml(bucket.bucket)} 天</b><span>${bucket.charged ? "计费区间" : "未计费"}</span></div>
        <strong>${number(bucket.units)}<small> 件</small></strong>
        <p>${number(bucket.skuCount)} 个 SKU</p>
      </article>
    `).join("")
    : `<div class="age-empty">上传详细库龄报告后，这里会显示各收费区间的库存件数和 SKU 数。</div>`;
  const reports = current.reports.filter((report) => report.type !== "unknown");
  document.querySelector("#report-strip").innerHTML = reports.length
    ? reports.map((report) => `<span><b>${escapeHtml(report.label)}</b>${number(report.rowCount)} 行<small>${escapeHtml(report.fileName)}</small></span>`).join("")
    : "";

  const rows = filteredRows();
  document.querySelector("#table-body").innerHTML = rows.map((row) => {
    const itemForecast = rowForecast(row);
    return `<tr>
      <td><b>${escapeHtml(row.sku)}</b><span>${escapeHtml(row.asin)}</span><small>${escapeHtml(row.product)}</small></td>
      <td>${riskBadge(row.risk)}</td>
      <td>${number(row.available)}</td>
      <td>${number(row.sales30)}</td>
      <td>${row.daysSupply >= 999 ? "无销量" : number(row.daysSupply)}</td>
      <td>${number(row.aged)}</td>
      <td>${number(itemForecast.expectedSoldUnits)}</td>
      <td>${number(itemForecast.remainingUnits)}</td>
      <td>${moneyOrPending(itemForecast.totalHoldingCost)}</td>
      <td>${moneyOrPending(row.liquidationNet)}</td>
      <td>${moneyOrPending(row.removalTotalLoss)}</td>
      <td><b class="action action-${itemForecast.recommendation.key}">${escapeHtml(itemForecast.recommendation.label)}</b></td>
    </tr>`;
  }).join("");
  document.querySelector("#table-count").textContent = `当前展示 ${number(rows.length)} 个 SKU，继续持有按 ${selectedHorizon} 天计算；导出 CSV 可获得完整成本、损益与 90 天预测字段。`;

  const warnings = current.warnings.length ? current.warnings : ["当前报告组合已覆盖主要测算字段；执行前仍应复核费率版本和实际批次库龄。"];
  document.querySelector("#warning-list").innerHTML = warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
}

async function analyzeSelectedFiles() {
  analyzeButton.disabled = true;
  setStatus("正在本地读取并识别报告，请稍候…");
  try {
    const XLSX = await getXlsx();
    const nextSources = [];
    for (const file of selectedFiles) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { cellDates: true });
      nextSources.push(...workbookToSources(workbook, file.name, XLSX, marketplace.value));
    }
    const recognized = nextSources.filter((source) => source.type !== "unknown" && source.rows.length);
    if (!recognized.length) throw new Error("没有识别到可用报告，请检查文件类型和表头。");
    parsedSources = recognized;
    current = analyzeSources(parsedSources, marketplace.value, defaultCostRates());
    usingDemo = false;
    setStatus(`已在浏览器本地完成分析：识别 ${recognized.length} 个有效工作表，未上传任何文件。`, "success");
    render();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "文件解析失败，请检查报告格式。", "error");
  } finally {
    analyzeButton.disabled = selectedFiles.length === 0;
  }
}

fileInput.addEventListener("change", (event) => {
  appendFiles([...event.target.files]);
  fileInput.value = "";
  updateSelectedFiles();
});

document.querySelector("#selected-files").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-file-key]");
  if (!button) return;
  selectedFiles = selectedFiles.filter((file) => fileKey(file) !== button.dataset.fileKey);
  updateSelectedFiles();
  setStatus("文件列表已更新，点击“开始本地分析”即可重新计算。", "info");
});

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  });
}
dropzone.addEventListener("drop", (event) => {
  appendFiles([...event.dataTransfer.files]);
  updateSelectedFiles();
});

analyzeButton.addEventListener("click", analyzeSelectedFiles);
clearButton.addEventListener("click", () => {
  selectedFiles = [];
  parsedSources = [];
  fileInput.value = "";
  updateSelectedFiles();
  setStatus("已清空待分析文件。", "success");
});
document.querySelector("#template-button").addEventListener("click", () => {
  const csv = "\ufeffseller-sku,unit-cost-rate,fulfillment-fee-rate,first-mile-cost-rate\r\nDEMO-SKU-001,30,18,8\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fba-cost-input-template.csv";
  link.click();
  URL.revokeObjectURL(url);
});
document.querySelector("#demo-button").addEventListener("click", () => {
  selectedFiles = [];
  parsedSources = [];
  fileInput.value = "";
  usingDemo = true;
  current = createDemoAnalysis(marketplace.value);
  updateSelectedFiles();
  setStatus("已恢复公开脱敏演示数据。", "success");
  render();
});
marketplace.addEventListener("change", () => {
  current = usingDemo
    ? createDemoAnalysis(marketplace.value)
    : analyzeSources(parsedSources, marketplace.value, defaultCostRates());
  render();
});
for (const input of [productCostRateInput, fulfillmentFeeRateInput, firstMileRateInput]) {
  input.addEventListener("change", () => {
    if (!usingDemo && parsedSources.length) {
      current = analyzeSources(parsedSources, marketplace.value, defaultCostRates());
      render();
    }
  });
}
document.querySelector("#search-input").addEventListener("input", (event) => {
  query = event.target.value.trim();
  render();
});
document.querySelector("#risk-filter").addEventListener("change", (event) => {
  riskFilter = event.target.value;
  render();
});
document.querySelector("#horizon-buttons").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-horizon]");
  if (!button) return;
  selectedHorizon = Number(button.dataset.horizon);
  render();
});
document.querySelector("#export-button").addEventListener("click", () => {
  const blob = new Blob([exportRowsToCsv(current.rows, current.rule.currency)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fba-inventory-analysis-${current.marketplace.toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

render();
