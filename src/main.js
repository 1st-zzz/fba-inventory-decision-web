import "./styles.css";
import {
  analyzeSources,
  createDemoAnalysis,
  exportRowsToCsv,
  FORECAST_HORIZONS,
  workbookToSources,
} from "./analyzer.js";

const root = document.querySelector("#app");
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
let parsedSources = [];
let selectedFiles = [];
let current = createDemoAnalysis("US", { analysisDate: today });
let usingDemo = true;
let query = "";
let riskFilter = "全部";
let actionFilter = "all";
let sortMode = "impact";
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
  .replace(/\"/g, "&quot;")
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

const moneyOrPending = (value) => Number.isFinite(value) ? money(value) : "待补数据";

const dateLabel = (value) => {
  if (!value) return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

root.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#setup" aria-label="FBA 库存决策台首页">
      <span class="brand-mark">F</span>
      <span>FBA 库存决策台<small>本地分析 · 不保存卖家数据</small></span>
    </a>
    <nav aria-label="页面导航"><a href="#setup">数据设置</a><a href="#inventory-overview">库存概况</a><a href="#fee-calculation">费用测算</a><a href="#sku-list">SKU 清单</a></nav>
    <div class="privacy-pill"><span></span>文件仅在当前浏览器处理</div>
  </header>

  <main>
    <section class="app-header">
      <div>
        <p class="eyebrow">FBA INVENTORY DECISION WORKSPACE</p>
        <h1>FBA 库存处置决策</h1>
        <p>上传运营报告，核对数据覆盖，判断计费库龄库存应继续持有还是立即清算。</p>
      </div>
      <div class="header-meta"><span>四国费率</span><span>本地处理</span><span>可审计导出</span></div>
    </section>

    <section class="intake-panel" id="setup">
      <div class="section-heading">
        <div><p class="eyebrow">STEP 01 · INPUT</p><h2>上传报告并设置口径</h2></div>
        <span class="local-badge">US / CA / UK / DE · XLSX / CSV</span>
      </div>
      <div class="control-strip">
        <label>Amazon 站点<select id="marketplace"><option value="US">美国 · USD</option><option value="CA">加拿大 · CAD</option><option value="UK">英国 · GBP</option><option value="DE">德国 · EUR</option></select></label>
        <label>测算起始日<input id="analysis-date" type="date" value="${today}" /></label>
        <label>采购成本（%）<input id="product-cost-rate" type="number" min="0" max="100" step="0.1" placeholder="例如 30" /></label>
        <label>FBA配送费（%）<input id="fulfillment-fee-rate" type="number" min="0" max="100" step="0.1" placeholder="例如 18" /></label>
        <label>头程（%）<input id="first-mile-rate" type="number" min="0" max="100" step="0.1" placeholder="例如 8" /></label>
        <button id="template-button" class="link-button" type="button">下载成本模板</button>
      </div>
      <div class="upload-layout">
        <label class="dropzone" id="dropzone"><input id="file-input" type="file" multiple accept=".xlsx,.xls,.xltx,.csv,.tsv" /><span class="upload-icon">＋</span><span><strong>拖入或选择多个运营报告</strong><small>支持分多次选择；建议包含库存、库龄、收费、佣金和商品报告</small></span></label>
        <div class="upload-side">
          <div id="selected-files" class="selected-files"></div>
          <div class="upload-actions"><button id="analyze-button" class="primary-button" disabled>开始本地分析</button><button id="clear-button" class="secondary-button" disabled>清空文件</button><button id="demo-button" class="secondary-button">查看脱敏演示</button></div>
          <p class="privacy-note">文件只在当前浏览器处理。采购成本和头程仅用于账面损益，不会在未来现金推荐中重复扣除。</p>
        </div>
      </div>
    </section>

    <section class="workspace" id="inventory-overview">
      <div class="workspace-heading">
        <div><p class="eyebrow">STEP 02 · REVIEW</p><h2 id="result-title">脱敏演示 · 库存概况</h2><p id="result-context" class="result-context"></p></div>
        <div class="result-actions"><span id="rule-version" class="rule-version"></span><button id="export-button" class="text-button">导出完整 CSV</button></div>
      </div>
      <div id="status-box"></div>
      <div class="result-overview-bar">
        <div class="readiness-summary"><span>数据完整度</span><strong id="confidence-level"></strong><small id="confidence-note"></small></div>
        <details id="coverage-details" class="coverage-details"><summary>数据覆盖与已识别报告 <span>展开查看</span></summary><div id="readiness-grid" class="readiness-grid"></div><div id="report-strip" class="report-strip"></div></details>
      </div>

      <section class="inventory-overview-panel">
        <div class="secondary-metrics-head"><p class="eyebrow">SKU & INVENTORY</p><h2>SKU 与库存概况</h2></div>
        <div id="summary-grid" class="summary-grid"></div>

        <section class="age-panel">
          <div class="age-panel-head"><div><p class="eyebrow">AGED INVENTORY BUCKETS</p><h2>各库龄区间库存</h2></div><p id="age-coverage"></p></div>
          <div class="age-panel-body"><div id="age-bucket-grid" class="age-bucket-grid"></div><p class="age-note">库存件数来自最新库龄快照。橙色区间表示当前站点已进入长期仓储计费范围。</p></div>
        </section>
      </section>

      <section class="decision-panel" id="fee-calculation">
        <div class="decision-panel-head">
          <div><p class="eyebrow">STEP 03 · CALCULATE</p><h2>费用测算与处置比较</h2><p class="section-note">先看当前处置费用，再看继续放置不同阶段会增加多少仓储费。</p></div>
          <div class="horizon-control" aria-label="选择继续持有天数"><span>选择继续放置阶段</span><div id="horizon-buttons"></div></div>
        </div>
        <div id="decision-scope" class="decision-scope"></div>
        <div id="fee-summary-grid" class="fee-summary-grid"></div>

        <section class="support-panel forecast-panel cost-forecast-panel">
          <div class="subsection-head"><div><p class="eyebrow">HOLDING COST BY STAGE</p><h3>继续放置各阶段仓储费</h3></div><b id="forecast-coverage"></b></div>
          <p id="forecast-summary" class="forecast-summary"></p>
          <div id="forecast-chart" class="forecast-chart"></div>
          <div class="forecast-legend"><span class="base-dot"></span>基础仓储费 <span class="aged-dot"></span>库存龄附加费</div>
          <div id="forecast-driver" class="forecast-driver"></div>
        </section>

        <div class="decision-section-label"><p class="eyebrow">ACTION COMPARISON</p><h3>继续销售还是现在清算</h3></div>
        <div id="recommendation-banner" class="recommendation-banner"></div>
        <div id="scenario-grid" class="scenario-grid"></div>
        <div id="decision-reason" class="decision-reason"></div>
        <div id="removal-reference" class="removal-reference"></div>

        <section class="support-panel sensitivity-panel">
          <div class="subsection-head"><div><p class="eyebrow">SALES CHECK</p><h3>销量变动会改变结论吗？</h3></div><p>按最近30日销量上下浮动30%</p></div>
          <p id="sensitivity-conclusion" class="sensitivity-conclusion"></p>
          <div id="sensitivity-grid" class="sensitivity-grid"></div>
        </section>
      </section>

      <section class="table-panel" id="sku-list">
        <div class="table-head">
          <div><p class="eyebrow">STEP 04 · ACT</p><h2>SKU 执行清单</h2></div>
          <div class="filters">
            <input id="search-input" type="search" placeholder="搜索 SKU / ASIN / 商品" />
            <select id="risk-filter" aria-label="风险筛选"><option>全部</option><option>高</option><option>中</option><option>低</option></select>
            <select id="action-filter" aria-label="建议动作筛选"><option value="all">全部动作</option><option value="liquidate">立即清算</option><option value="hold">继续持有</option><option value="none">无需处理</option><option value="pending">待补数据</option></select>
            <select id="sort-mode" aria-label="排序方式"><option value="impact">按经济影响排序</option><option value="holding">按继续放置费排序</option><option value="break-even">按最晚处理日排序</option><option value="sku">按 SKU 排序</option></select>
          </div>
        </div>
        <div class="table-scroll"><table><thead><tr>
          <th>SKU / 商品</th><th>风险</th><th>可售</th><th>30日销量</th><th>计费库龄</th><th>期末剩余</th>
          <th>继续放置费</th><th>最晚处理窗口</th><th>立即清算净回收</th><th>移除总损失</th><th>建议动作</th>
        </tr></thead><tbody id="table-body"></tbody></table></div>
        <p id="table-count" class="table-count"></p>
      </section>

      <details class="method-panel"><summary><span>规则、口径与执行边界</span><small>展开查看计算假设与费率来源</small></summary><div class="method-body"><div><p>推荐比较的是未来现金：正常销售净回款 + 期末清算回收 − 新增仓储费。移除因缺少回收价值与下游成本，只展示费用，不参与推荐。</p><a id="rule-source" target="_blank" rel="noreferrer">查看 Amazon 费率来源</a></div><ul id="warning-list"></ul></div></details>
    </section>
  </main>

  <footer><span>FBA 库存决策台</span><p>公开页面仅含脱敏演示数据 · 不会自动创建清算或移除订单</p></footer>
`;

const fileInput = document.querySelector("#file-input");
const dropzone = document.querySelector("#dropzone");
const analyzeButton = document.querySelector("#analyze-button");
const clearButton = document.querySelector("#clear-button");
const marketplace = document.querySelector("#marketplace");
const analysisDateInput = document.querySelector("#analysis-date");
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

function analysisOptions() {
  return {
    analysisDate: analysisDateInput.value,
    defaultProductCostRate: inputRate(productCostRateInput),
    defaultFulfillmentFeeRate: inputRate(fulfillmentFeeRateInput),
    defaultFirstMileRate: inputRate(firstMileRateInput),
  };
}

function setStatus(message, kind = "info") {
  document.querySelector("#status-box").innerHTML = message ? `<div class="status ${kind}">${escapeHtml(message)}</div>` : "";
}

function updateSelectedFiles() {
  document.querySelector("#selected-files").innerHTML = selectedFiles.map((file) => `
    <span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}<small>${number(file.size / 1024)} KB</small><button type="button" data-file-key="${escapeHtml(fileKey(file))}" aria-label="移除 ${escapeHtml(file.name)}">×</button></span>
  `).join("");
  analyzeButton.disabled = selectedFiles.length === 0;
  clearButton.disabled = selectedFiles.length === 0;
}

function selectedSummaryForecast() {
  return current.summary.forecasts.find((forecast) => forecast.horizonDays === selectedHorizon);
}

function rowForecast(row) {
  return row.forecasts.find((forecast) => forecast.horizonDays === selectedHorizon);
}

function actionLabel(key) {
  if (key === "hold") return "继续持有";
  if (key === "liquidate") return "立即清算";
  if (key === "none") return "无需处理";
  return "待补数据";
}

function filteredRows() {
  const lowered = query.toLowerCase();
  const rows = current.rows.filter((row) => {
    const forecast = rowForecast(row);
    const matchesSearch = !lowered || [row.sku, row.asin, row.product].some((value) => String(value || "").toLowerCase().includes(lowered));
    const matchesRisk = riskFilter === "全部" || row.risk === riskFilter;
    const matchesAction = actionFilter === "all" || forecast.recommendation.key === actionFilter;
    return matchesSearch && matchesRisk && matchesAction;
  });
  return rows.sort((a, b) => {
    const af = rowForecast(a);
    const bf = rowForecast(b);
    if (sortMode === "holding") return (bf.totalHoldingCost || 0) - (af.totalHoldingCost || 0);
    if (sortMode === "break-even") return (a.breakEvenDays ?? 9999) - (b.breakEvenDays ?? 9999);
    if (sortMode === "sku") return String(a.sku).localeCompare(String(b.sku));
    const aImpact = Number.isFinite(af.holdThenLiquidateValue) && Number.isFinite(a.liquidationNet) ? Math.abs(af.holdThenLiquidateValue - a.liquidationNet) : 0;
    const bImpact = Number.isFinite(bf.holdThenLiquidateValue) && Number.isFinite(b.liquidationNet) ? Math.abs(bf.holdThenLiquidateValue - b.liquidationNet) : 0;
    return bImpact - aImpact;
  });
}

function riskBadge(risk) {
  return `<span class="risk risk-${risk === "高" ? "high" : risk === "中" ? "medium" : "low"}">${risk}</span>`;
}

function metric(label, value, note, tone = "") {
  return `<article class="metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function feeMetric(label, value, note, tone = "") {
  return `<article class="fee-metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function confidenceModel(summary, forecast) {
  if (!summary.actionUnits) return { level: "无需处理", tone: "neutral", note: "当前没有进入计费区间的库存" };
  const completeComparison = forecast.readiness.comparison === forecast.readiness.actionSkuCount;
  const completeStorage = forecast.readiness.storage === forecast.readiness.actionSkuCount;
  const detailedAge = summary.readiness.detailedAge === summary.skuCount;
  if (completeComparison && completeStorage && detailedAge) return { level: "高", tone: "high", note: "关键费用和库龄覆盖完整" };
  if (forecast.readiness.comparison > 0 && completeStorage) return { level: "中", tone: "medium", note: "部分 SKU 仍缺少销售或成本口径" };
  return { level: "低", tone: "low", note: "当前费用可看，但不宜直接执行推荐" };
}

function renderReadiness(summary, forecast) {
  const reportTypes = new Set(current.reports.map((report) => report.type));
  const costCoverage = Math.min(summary.readiness.productCost, summary.readiness.fulfillmentFee, summary.readiness.firstMile);
  const items = [
    ["库存基表", reportTypes.has("inventory") || summary.skuCount > 0, `${number(summary.skuCount)} 个 SKU`],
    ["详细库龄", summary.readiness.detailedAge > 0, `${number(summary.readiness.detailedAge)}/${number(summary.skuCount)}`],
    ["收费与体积", forecast.readiness.storage > 0, `${number(forecast.readiness.storage)}/${number(forecast.readiness.actionSkuCount)} 个计费 SKU`],
    ["售价与佣金", summary.readiness.price > 0, `${number(summary.readiness.price)}/${number(summary.skuCount)}`],
    ["三项成本", costCoverage > 0, `${number(costCoverage)}/${number(summary.skuCount)}`],
  ];
  document.querySelector("#readiness-grid").innerHTML = items.map(([label, ready, detail]) => `
    <article class="readiness-item ${ready ? "ready" : "missing"}"><span>${ready ? "✓" : "!"}</span><div><b>${label}</b><small>${detail}</small></div></article>
  `).join("");
  const confidence = confidenceModel(summary, forecast);
  const confidenceElement = document.querySelector("#confidence-level");
  confidenceElement.textContent = confidence.level;
  confidenceElement.className = `confidence-${confidence.tone}`;
  document.querySelector("#confidence-note").textContent = confidence.note;
  const coverageDetails = document.querySelector("#coverage-details");
  coverageDetails.open = confidence.tone === "low";
  coverageDetails.querySelector("summary span").textContent = confidence.tone === "high" ? "关键数据完整" : "展开检查缺口";
}

function render() {
  const { summary, rule } = current;
  const forecast = selectedSummaryForecast();
  document.querySelector("#result-title").textContent = usingDemo ? "脱敏演示 · 库存概况" : "上传数据 · 库存概况";
  document.querySelector("#result-context").textContent = `测算起始日 ${current.analysisDate} · ${rule.marketplace} · ${rule.currency}${summary.ageSnapshot ? ` · 库龄快照 ${dateLabel(summary.ageSnapshot)}` : ""}`;
  document.querySelector("#rule-version").textContent = `${rule.version} · 生效 ${rule.effectiveFrom}`;
  document.querySelector("#rule-source").href = rule.sourceUrl;
  document.querySelector("#rule-source").textContent = `${rule.sourceLabel} ↗`;

  const reports = current.reports.filter((report) => report.type !== "unknown");
  document.querySelector("#report-strip").innerHTML = reports.map((report) => `<span><b>${escapeHtml(report.label)}</b>${number(report.rowCount)} 行<small>${escapeHtml(report.fileName)}</small></span>`).join("");
  renderReadiness(summary, forecast);

  const snapshotDelta = summary.actionUnits - summary.cappedActionUnits;
  document.querySelector("#summary-grid").innerHTML = [
    metric("SKU 总数", number(summary.skuCount), `高风险 ${number(summary.riskCounts.high)} 个`),
    metric("可售库存", number(summary.available), "当前可售数量"),
    metric("调拨中库存", number(summary.transfer), "正在转入或转库"),
    metric("长期仓储计费库存", number(summary.actionUnits), `${number(summary.readiness.actionSkuCount)} 个 SKU${snapshotDelta > 0 ? ` · 比当前可售多 ${number(snapshotDelta)} 件` : ""}`, "warning"),
    metric("预计冗余库存", number(summary.excess), "仅作风险提示，不计入清算/移除", "neutral"),
    metric("高风险 SKU", number(summary.riskCounts.high), `中风险 ${number(summary.riskCounts.medium)} · 低风险 ${number(summary.riskCounts.low)}`, "danger"),
  ].join("");

  const fullRemovalLoss = summary.readiness.actionSkuCount > 0 && summary.readiness.removalLoss === summary.readiness.actionSkuCount;
  const removalTotalLoss = summary.actionUnits <= 0 ? "无计费库存" : fullRemovalLoss ? money(summary.removalTotalLoss) : `待补 ${number(summary.readiness.actionSkuCount - summary.readiness.removalLoss)} 个 SKU`;
  document.querySelector("#fee-summary-grid").innerHTML = [
    feeMetric("当前月基础仓储费", money(summary.storage), `全部 ${number(summary.available)} 件库存`),
    feeMetric("当前月长期仓储费", money(summary.agedFee), `${rule.marketplace} 从 ${rule.ageStart} 天起`, "warning"),
    feeMetric("清算费用", money(summary.liquidationFee), `转介费 ${money(summary.liquidationReferral)} + 处理费 ${money(summary.liquidationProcessing)}`),
    feeMetric("清算预计净回收", money(summary.liquidationNet), `毛回收 ${money(summary.liquidationGross)} − 清算费用`, "warning"),
    feeMetric("Amazon 移除费", money(summary.removalFee), "费用金额以正数显示"),
    feeMetric("移除总损失", removalTotalLoss, "含采购成本、头程与移除费", "danger"),
  ].join("");

  document.querySelector("#horizon-buttons").innerHTML = FORECAST_HORIZONS.map((days) => `<button type="button" data-horizon="${days}" class="${days === selectedHorizon ? "active" : ""}">${days} 天</button>`).join("");

  const completeComparison = forecast.readiness.actionSkuCount > 0 && forecast.readiness.comparison === forecast.readiness.actionSkuCount;
  const comparable = Number.isFinite(forecast.holdThenLiquidateValue) && Number.isFinite(summary.liquidationNet);
  const decisionDifference = comparable ? Math.abs(forecast.holdThenLiquidateValue - summary.liquidationNet) : null;
  const recommendationTitle = summary.actionUnits <= 0
    ? "当前无需处理"
    : forecast.recommendation.key === "liquidate"
      ? "现在清算"
      : forecast.recommendation.key === "hold"
        ? `继续销售 ${selectedHorizon} 天`
        : "先补全数据，再决定";
  const comparisonText = forecast.recommendation.key === "liquidate" && decisionDifference !== null
    ? `与继续销售 ${selectedHorizon} 天相比`
    : forecast.recommendation.key === "hold" && decisionDifference !== null
      ? "与现在清算相比"
      : completeComparison
        ? "两种方案的预计现金结果接近"
        : `仍有 ${number(Math.max(0, forecast.readiness.actionSkuCount - forecast.readiness.comparison))} 个计费 SKU 缺少比较数据`;
  const breakEvenText = summary.decisionBreakEvenDays
    ? summary.decisionBreakEvenDays <= 1
      ? "从现在起继续放置已不划算"
      : `继续销售超过约 ${summary.decisionBreakEvenDays} 天后，预计不如现在清算`
    : "未来 365 天内未出现整体清算临界点";

  document.querySelector("#decision-scope").innerHTML = summary.actionUnits > 0
    ? `当前月基础仓储费按全部可售库存测算；清算、移除和继续放置费用只针对长期仓储计费库存：<strong>${number(summary.actionUnits)} 件</strong>，涉及 <strong>${number(summary.readiness.actionSkuCount)} 个 SKU</strong>。`
    : "当前没有进入长期仓储计费区间的库存，无需比较清算或移除。";
  document.querySelector("#recommendation-banner").className = `recommendation-banner tone-${forecast.recommendation.key}`;
  document.querySelector("#recommendation-banner").innerHTML = `
    <div><span>建议怎么做</span><h3>${escapeHtml(recommendationTitle)}</h3><p>${escapeHtml(comparisonText)}</p></div>
    <div class="recommendation-value"><span>预计多保留现金</span><strong>${decisionDifference === null ? "待补数据" : money(decisionDifference)}</strong><small>${escapeHtml(breakEvenText)}</small></div>
  `;

  const fullBookPnl = summary.readiness.actionSkuCount > 0 && summary.readiness.bookPnl === summary.readiness.actionSkuCount;
  const liquidationBookPnl = summary.actionUnits <= 0 ? "无计费库存" : fullBookPnl ? money(summary.liquidationBookProfit) : `待补 ${number(summary.readiness.actionSkuCount - summary.readiness.bookPnl)} 个 SKU`;
  document.querySelector("#scenario-grid").innerHTML = `
    <article class="scenario-card hold ${forecast.recommendation.key === "hold" ? "recommended" : ""}"><div><span>方案 A · 继续销售 ${selectedHorizon} 天</span><b>${forecast.recommendation.key === "hold" ? "推荐" : "对比方案"}</b></div><p class="scenario-value-label">期末预计可留下的现金</p><h3>${moneyOrPending(forecast.holdThenLiquidateValue)}</h3><dl><div><dt>期间新增仓储费</dt><dd>-${moneyOrPending(forecast.totalHoldingCost)}</dd></div><div><dt>预计售出</dt><dd>${number(forecast.expectedSoldUnits)} 件</dd></div><div><dt>到期仍剩</dt><dd>${number(forecast.remainingUnits)} 件</dd></div></dl></article>
    <article class="scenario-card liquidate ${forecast.recommendation.key === "liquidate" ? "recommended" : ""}"><div><span>方案 B · 现在清算</span><b>${forecast.recommendation.key === "liquidate" ? "推荐" : "对比方案"}</b></div><p class="scenario-value-label">现在预计可收回的现金</p><h3>${money(summary.liquidationNet)}</h3><dl><div><dt>等待时间</dt><dd>0 天</dd></div><div><dt>新增仓储费</dt><dd>${money(0)}</dd></div><div><dt>扣历史成本后账面损益</dt><dd>${liquidationBookPnl}</dd></div></dl></article>
  `;

  const reasonText = forecast.recommendation.key === "liquidate" && decisionDifference !== null
    ? `继续放 ${selectedHorizon} 天预计还要支付 ${money(forecast.totalHoldingCost)} 仓储费，期末仍剩 ${number(forecast.remainingUnits)} 件；现在清算预计多保留 ${money(decisionDifference)} 现金。`
    : forecast.recommendation.key === "hold" && decisionDifference !== null
      ? `继续销售 ${selectedHorizon} 天预计售出 ${number(forecast.expectedSoldUnits)} 件，即使计入 ${money(forecast.totalHoldingCost)} 仓储费，仍比现在清算多保留 ${money(decisionDifference)} 现金。`
      : `两种方案只完成 ${number(forecast.readiness.comparison)}/${number(forecast.readiness.actionSkuCount)} 个计费 SKU 的比较，请先补全售价、佣金或 FBA 配送费。`;
  document.querySelector("#decision-reason").innerHTML = `<b>为什么：</b>${escapeHtml(reasonText)}`;
  document.querySelector("#removal-reference").innerHTML = `<div><b>移除费用参考（不参与建议）</b><span>缺少移除后的回收价值和下游处理成本，不能与清算直接比较。</span></div><dl><div><dt>Amazon 移除费</dt><dd>${money(summary.removalFee)}</dd></div><div><dt>含采购与头程的总损失</dt><dd>${removalTotalLoss}</dd></div></dl>`;

  const sensitivityKeys = forecast.sensitivity.map((scenario) => scenario.recommendation.key);
  const sensitivityStable = sensitivityKeys.length > 0 && sensitivityKeys.every((key) => key === sensitivityKeys[0]) && sensitivityKeys[0] !== "pending";
  const sensitivityRecommendation = sensitivityKeys[0] === "liquidate" ? "现在清算" : sensitivityKeys[0] === "hold" ? `继续销售 ${selectedHorizon} 天` : "待补数据";
  document.querySelector("#sensitivity-conclusion").textContent = sensitivityStable
    ? `结论稳定：销量下降 30%、保持不变或提高 30%，建议都仍是“${sensitivityRecommendation}”。`
    : "结论会随销量变化，请查看三个情景，并优先核对销量预测。";
  document.querySelector("#sensitivity-grid").innerHTML = forecast.sensitivity.map((scenario) => `
    <article class="sensitivity-item ${scenario.key === "baseline" ? "baseline" : ""}"><div><span>销量 ${scenario.multiplier === 1 ? "不变" : scenario.multiplier < 1 ? "下降 30%" : "提高 30%"}</span><b>${scenario.recommendation.key === "liquidate" ? "现在清算" : scenario.recommendation.key === "hold" ? `继续销售 ${selectedHorizon} 天` : "待补数据"}</b></div><small>继续销售后的现金结果 ${moneyOrPending(scenario.holdThenLiquidateValue)}</small></article>
  `).join("");

  const maxForecastCost = Math.max(1, ...summary.forecasts.map((item) => item.totalHoldingCost || 0));
  document.querySelector("#forecast-coverage").textContent = `费用覆盖 ${number(forecast.readiness.storage)}/${number(forecast.readiness.actionSkuCount)} 个计费 SKU`;
  document.querySelector("#forecast-summary").innerHTML = `继续放 <b>${selectedHorizon} 天</b>，预计累计新增 <strong>${money(forecast.totalHoldingCost)}</strong> 仓储费。`;
  document.querySelector("#forecast-chart").innerHTML = summary.forecasts.map((item) => {
    const baseWidth = Math.max(0, item.baseStorageCost / maxForecastCost * 100);
    const agedWidth = Math.max(0, item.agedSurchargeCost / maxForecastCost * 100);
    return `<article class="forecast-row ${item.horizonDays === selectedHorizon ? "active" : ""}"><div class="forecast-label"><b>${item.horizonDays} 天</b><span>剩余 ${number(item.remainingUnits)} 件</span></div><div class="forecast-bar" aria-label="${item.horizonDays} 天累计新增仓储费 ${money(item.totalHoldingCost)}"><span class="base" style="width:${baseWidth}%"></span><span class="aged" style="width:${agedWidth}%"></span></div><div class="forecast-cost"><strong>${money(item.totalHoldingCost)}</strong><small>基础 ${money(item.baseStorageCost)} + 长期 ${money(item.agedSurchargeCost)}</small></div></article>`;
  }).join("");
  const forecast90 = summary.forecasts.find((item) => item.horizonDays === 90);
  const forecast180 = summary.forecasts.find((item) => item.horizonDays === 180);
  const addedAfter90 = forecast180.totalHoldingCost - forecast90.totalHoldingCost;
  document.querySelector("#forecast-driver").innerHTML = `<b>为什么长期费用会上升：</b>从90天延长到180天预计再增加 ${money(addedAfter90)}。库存会进入更高库龄费率区间，跨入10–12月时基础仓储费也可能上升。`;

  const ageBuckets = summary.ageBuckets || [];
  document.querySelector("#age-coverage").textContent = summary.readiness.detailedAge ? `明细覆盖 ${number(summary.readiness.detailedAge)}/${number(summary.skuCount)} 个 SKU${summary.ageSnapshot ? ` · 快照 ${dateLabel(summary.ageSnapshot)}` : ""}` : "未识别详细库龄报告";
  document.querySelector("#age-bucket-grid").innerHTML = summary.readiness.detailedAge ? ageBuckets.map((bucket) => `<article class="age-bucket ${bucket.charged ? "charged" : "not-charged"} ${bucket.units === 0 ? "zero" : ""}"><div><b>${escapeHtml(bucket.bucket)} 天</b><span>${bucket.charged ? "计费" : "未计费"}</span></div><strong>${number(bucket.units)}<small> 件</small></strong><p>${number(bucket.skuCount)} 个 SKU</p></article>`).join("") : `<div class="age-empty">上传详细库龄报告后显示每个收费区间的库存件数。</div>`;

  const rows = filteredRows();
  document.querySelector("#table-body").innerHTML = rows.map((row) => {
    const itemForecast = rowForecast(row);
    const breakEven = row.actionUnits <= 0 ? "—" : row.breakEvenDays ? (row.breakEvenDays <= 1 ? "立即" : `${row.breakEvenDays} 天`) : ">365 天";
    return `<tr><td><b>${escapeHtml(row.sku)}</b><span>${escapeHtml(row.asin)}</span><small>${escapeHtml(row.product)}</small></td><td>${riskBadge(row.risk)}</td><td>${number(row.available)}</td><td>${number(row.sales30)}</td><td>${number(row.actionUnits)}</td><td>${number(itemForecast.remainingUnits)}</td><td>${moneyOrPending(itemForecast.totalHoldingCost)}</td><td>${breakEven}</td><td>${moneyOrPending(row.liquidationNet)}</td><td>${moneyOrPending(row.removalTotalLoss)}</td><td><b class="action action-${itemForecast.recommendation.key}">${escapeHtml(actionLabel(itemForecast.recommendation.key))}</b></td></tr>`;
  }).join("");
  document.querySelector("#table-count").textContent = `显示 ${number(rows.length)}/${number(summary.skuCount)} 个 SKU · 决策窗口 ${selectedHorizon} 天 · CSV 含全部四个预测周期。`;

  const warnings = current.warnings.length ? current.warnings : ["当前报告组合已覆盖主要字段；执行前仍应复核 Seller Central 费率预览。"];
  document.querySelector("#warning-list").innerHTML = warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
}

async function analyzeSelectedFiles({ scrollToResults = true } = {}) {
  analyzeButton.disabled = true;
  setStatus("正在浏览器本地识别和合并报告…");
  try {
    const XLSX = await getXlsx();
    const nextSources = [];
    for (const file of selectedFiles) {
      const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      nextSources.push(...workbookToSources(workbook, file.name, XLSX, marketplace.value));
    }
    const recognized = nextSources.filter((source) => source.type !== "unknown" && source.rows.length);
    if (!recognized.length) throw new Error("没有识别到可用报告，请检查文件类型和表头。");
    parsedSources = recognized;
    current = analyzeSources(parsedSources, marketplace.value, analysisOptions());
    usingDemo = false;
    setStatus(`分析完成：识别 ${recognized.length} 个有效工作表。文件未离开当前浏览器。`, "success");
    render();
    if (scrollToResults) requestAnimationFrame(() => document.querySelector("#inventory-overview").scrollIntoView({ behavior: "smooth", block: "start" }));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "文件解析失败，请检查报告格式。", "error");
  } finally {
    analyzeButton.disabled = selectedFiles.length === 0;
  }
}

function recalculate() {
  try {
    current = usingDemo ? createDemoAnalysis(marketplace.value, analysisOptions()) : analyzeSources(parsedSources, marketplace.value, analysisOptions());
    setStatus("测算口径已更新。", "success");
    render();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "重新计算失败。", "error");
  }
}

fileInput.addEventListener("change", (event) => { appendFiles([...event.target.files]); fileInput.value = ""; updateSelectedFiles(); });
document.querySelector("#selected-files").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-file-key]");
  if (!button) return;
  selectedFiles = selectedFiles.filter((file) => fileKey(file) !== button.dataset.fileKey);
  updateSelectedFiles();
  setStatus("文件列表已更新，重新分析后生效。", "info");
});
for (const eventName of ["dragenter", "dragover"]) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add("dragging"); });
for (const eventName of ["dragleave", "drop"]) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove("dragging"); });
dropzone.addEventListener("drop", (event) => { appendFiles([...event.dataTransfer.files]); updateSelectedFiles(); });

analyzeButton.addEventListener("click", () => analyzeSelectedFiles());
clearButton.addEventListener("click", () => { selectedFiles = []; parsedSources = []; fileInput.value = ""; updateSelectedFiles(); setStatus("已清空待分析文件。", "success"); });
document.querySelector("#template-button").addEventListener("click", () => {
  const csv = "\ufeffseller-sku,unit-cost-rate,fulfillment-fee-rate,first-mile-cost-rate\r\nDEMO-SKU-001,30,18,8\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "fba-cost-input-template.csv"; link.click(); URL.revokeObjectURL(url);
});
document.querySelector("#demo-button").addEventListener("click", () => {
  selectedFiles = []; parsedSources = []; fileInput.value = ""; usingDemo = true;
  current = createDemoAnalysis(marketplace.value, analysisOptions()); updateSelectedFiles(); setStatus("已恢复公开脱敏演示数据。", "success"); render();
  requestAnimationFrame(() => document.querySelector("#inventory-overview").scrollIntoView({ behavior: "smooth", block: "start" }));
});
marketplace.addEventListener("change", () => { if (!usingDemo && selectedFiles.length) analyzeSelectedFiles({ scrollToResults: false }); else recalculate(); });
analysisDateInput.addEventListener("change", recalculate);
for (const input of [productCostRateInput, fulfillmentFeeRateInput, firstMileRateInput]) input.addEventListener("change", recalculate);
document.querySelector("#horizon-buttons").addEventListener("click", (event) => { const button = event.target.closest("button[data-horizon]"); if (!button) return; selectedHorizon = Number(button.dataset.horizon); render(); });
document.querySelector("#search-input").addEventListener("input", (event) => { query = event.target.value.trim(); render(); });
document.querySelector("#risk-filter").addEventListener("change", (event) => { riskFilter = event.target.value; render(); });
document.querySelector("#action-filter").addEventListener("change", (event) => { actionFilter = event.target.value; render(); });
document.querySelector("#sort-mode").addEventListener("change", (event) => { sortMode = event.target.value; render(); });
document.querySelector("#export-button").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([exportRowsToCsv(current.rows, current.rule.currency)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `fba-inventory-analysis-${current.marketplace.toLowerCase()}.csv`; link.click(); URL.revokeObjectURL(url);
});

analysisDateInput.value = current.analysisDate;
render();
