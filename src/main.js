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
    <nav aria-label="页面导航"><a href="#setup">数据设置</a><a href="#decision">决策结果</a><a href="#sku-list">SKU 清单</a></nav>
    <div class="privacy-pill"><span></span>文件仅在当前浏览器处理</div>
  </header>

  <main>
    <section class="product-intro">
      <div>
        <p class="eyebrow">FBA INVENTORY DECISION WORKSPACE</p>
        <h1>先确认数据，再决定库存是留、清还是移</h1>
        <p>面向运营人员的库存处置工作台：识别多份报告，预测继续持有成本，并把立即清算与移除成本放在同一页复核。</p>
      </div>
      <div class="workflow-steps" aria-label="工作流程">
        <span><b>1</b>上传报告</span><i></i><span><b>2</b>核对覆盖</span><i></i><span><b>3</b>执行建议</span>
      </div>
    </section>

    <section class="intake-panel" id="setup">
      <div class="section-heading">
        <div><p class="eyebrow">STEP 01 · INPUT</p><h2>数据与测算口径</h2></div>
        <span class="local-badge">US / CA / UK / DE · XLSX / CSV</span>
      </div>
      <div class="intake-grid">
        <div class="settings-card">
          <h3>先设定站点和日期</h3>
          <div class="field-grid two">
            <label>Amazon 站点
              <select id="marketplace">
                <option value="US">美国 · USD</option>
                <option value="CA">加拿大 · CAD</option>
                <option value="UK">英国 · GBP</option>
                <option value="DE">德国 · EUR</option>
              </select>
            </label>
            <label>测算起始日
              <input id="analysis-date" type="date" value="2026-07-16" />
            </label>
          </div>
          <div class="cost-heading"><div><h3>统一预估成本</h3><p>按当前售价比例计算；成本表中的 SKU 金额或比例优先。</p></div><button id="template-button" class="link-button" type="button">下载成本模板</button></div>
          <div class="field-grid three">
            <label>采购成本（%）<input id="product-cost-rate" type="number" min="0" max="100" step="0.1" placeholder="例如 30" /></label>
            <label>FBA配送费（%）<input id="fulfillment-fee-rate" type="number" min="0" max="100" step="0.1" placeholder="例如 18" /></label>
            <label>头程（%）<input id="first-mile-rate" type="number" min="0" max="100" step="0.1" placeholder="例如 8" /></label>
          </div>
          <p class="field-note">采购成本和头程用于账面损益；未来现金推荐不会重复扣除已经发生的历史成本。</p>
        </div>

        <div class="upload-card">
          <label class="dropzone" id="dropzone">
            <input id="file-input" type="file" multiple accept=".xlsx,.xls,.xltx,.csv,.tsv" />
            <span class="upload-icon">＋</span>
            <strong>拖入或选择多个运营报告</strong>
            <small>可分多次选择；建议包含库存、库龄、收费、佣金和商品报告</small>
          </label>
          <div id="selected-files" class="selected-files"></div>
          <div class="upload-actions">
            <button id="analyze-button" class="primary-button" disabled>开始本地分析</button>
            <button id="clear-button" class="secondary-button" disabled>清空文件</button>
            <button id="demo-button" class="secondary-button">查看脱敏演示</button>
          </div>
          <p class="privacy-note">页面不会将文件发送到 GitHub。刷新或关闭页面后，本次文件和结果会被清除。</p>
        </div>
      </div>
    </section>

    <section class="workspace" id="decision">
      <div class="workspace-heading">
        <div><p class="eyebrow">STEP 02 · DECIDE</p><h2 id="result-title">脱敏演示结果</h2><p id="result-context" class="result-context"></p></div>
        <div class="result-actions"><span id="rule-version" class="rule-version"></span><button id="export-button" class="text-button">导出完整 CSV</button></div>
      </div>
      <div id="status-box"></div>
      <div id="report-strip" class="report-strip"></div>

      <section class="readiness-panel" aria-label="数据完整度与决策可信度">
        <div class="readiness-summary"><span>决策可信度</span><strong id="confidence-level"></strong><small id="confidence-note"></small></div>
        <div id="readiness-grid" class="readiness-grid"></div>
      </section>

      <div id="summary-grid" class="summary-grid"></div>

      <section class="decision-panel">
        <div class="decision-panel-head">
          <div><p class="eyebrow">DECISION FIRST</p><h2>当前建议</h2></div>
          <div class="horizon-control" aria-label="选择继续持有天数"><span>决策窗口</span><div id="horizon-buttons"></div></div>
        </div>
        <div id="recommendation-banner" class="recommendation-banner"></div>
        <div id="scenario-grid" class="scenario-grid"></div>

        <div class="sensitivity-panel">
          <div class="subsection-head"><div><p class="eyebrow">SALES SENSITIVITY</p><h3>销量变化后，建议是否仍然成立</h3></div><p>以最近30日销量为基准，分别测算 −30%、基准和 +30%。</p></div>
          <div id="sensitivity-grid" class="sensitivity-grid"></div>
        </div>

        <div class="forecast-panel">
          <div class="subsection-head">
            <div><p class="eyebrow">HOLDING COST FORECAST</p><h3>继续放置预计新增仓储费</h3></div>
            <div class="forecast-meta"><b id="forecast-coverage"></b><div class="forecast-legend"><span class="base-dot"></span>基础仓储费 <span class="aged-dot"></span>库存龄附加费</div></div>
          </div>
          <div id="forecast-chart" class="forecast-chart"></div>
          <div id="forecast-driver" class="forecast-driver"></div>
        </div>
      </section>

      <section class="age-panel">
        <div class="age-panel-head"><div><p class="eyebrow">AGED INVENTORY BUCKETS</p><h2>库龄收费区间库存</h2></div><p id="age-coverage"></p></div>
        <div id="age-bucket-grid" class="age-bucket-grid"></div>
        <p class="age-note">库龄来自最新快照；区间预测按区间下限推进。与当前可售库存存在差异时，会在可信度区域提示。</p>
      </section>

      <section class="table-panel" id="sku-list">
        <div class="table-head">
          <div><p class="eyebrow">STEP 03 · ACT</p><h2>SKU 执行清单</h2></div>
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

      <section class="method-panel">
        <div><p class="eyebrow">RULES & ASSUMPTIONS</p><h2>规则、口径与执行边界</h2><p>推荐比较的是未来现金：正常销售净回款 + 期末清算回收 − 新增仓储费。移除因缺少回收价值与下游成本，只展示费用，不参与推荐。</p><a id="rule-source" target="_blank" rel="noreferrer">查看 Amazon 费率来源</a></div>
        <ul id="warning-list"></ul>
      </section>
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
}

function render() {
  const { summary, rule } = current;
  const forecast = selectedSummaryForecast();
  document.querySelector("#result-title").textContent = usingDemo ? "脱敏演示结果" : "本地报告分析结果";
  document.querySelector("#result-context").textContent = `测算起始日 ${current.analysisDate} · ${rule.marketplace} · ${rule.currency}${summary.ageSnapshot ? ` · 库龄快照 ${dateLabel(summary.ageSnapshot)}` : ""}`;
  document.querySelector("#rule-version").textContent = `${rule.version} · 生效 ${rule.effectiveFrom}`;
  document.querySelector("#rule-source").href = rule.sourceUrl;
  document.querySelector("#rule-source").textContent = `${rule.sourceLabel} ↗`;

  const reports = current.reports.filter((report) => report.type !== "unknown");
  document.querySelector("#report-strip").innerHTML = reports.map((report) => `<span><b>${escapeHtml(report.label)}</b>${number(report.rowCount)} 行<small>${escapeHtml(report.fileName)}</small></span>`).join("");
  renderReadiness(summary, forecast);

  const snapshotDelta = summary.actionUnits - summary.cappedActionUnits;
  document.querySelector("#summary-grid").innerHTML = [
    metric("需处理计费库存", number(summary.actionUnits), `${number(summary.readiness.actionSkuCount)} 个 SKU${snapshotDelta > 0 ? ` · 比当前可售多 ${number(snapshotDelta)} 件` : ""}`, "warning"),
    metric("预计冗余库存", number(summary.excess), "仅作风险提示，不计入清算/移除", "neutral"),
    metric("高风险 SKU", number(summary.riskCounts.high), `共 ${number(summary.skuCount)} 个 SKU`, "danger"),
    metric("本月基础仓储费", money(summary.storage), `全部 ${number(summary.available)} 件库存`),
    metric("本月库存龄附加费", money(summary.agedFee), `${rule.marketplace} 从 ${rule.ageStart} 天起`),
  ].join("");

  document.querySelector("#horizon-buttons").innerHTML = FORECAST_HORIZONS.map((days) => `<button type="button" data-horizon="${days}" class="${days === selectedHorizon ? "active" : ""}">${days} 天</button>`).join("");

  const completeComparison = forecast.readiness.actionSkuCount > 0 && forecast.readiness.comparison === forecast.readiness.actionSkuCount;
  const recommendationTitle = summary.actionUnits <= 0 ? "当前无需处理计费库龄库存" : forecast.recommendation.label;
  const recommendationValue = forecast.recommendation.key === "hold" ? forecast.holdThenLiquidateValue : forecast.recommendation.key === "liquidate" ? summary.liquidationNet : null;
  const breakEvenText = summary.decisionBreakEvenDays ? `预计最晚处理窗口：${summary.decisionBreakEvenDays} 天` : "365 天内未出现整体清算临界点";
  document.querySelector("#recommendation-banner").className = `recommendation-banner tone-${forecast.recommendation.key}`;
  document.querySelector("#recommendation-banner").innerHTML = `
    <div><span>当前建议 · ${selectedHorizon} 天窗口</span><h3>${escapeHtml(recommendationTitle)}</h3><p>${completeComparison ? "已比较继续销售后清算剩余与立即清算两种未来现金路径。" : `只覆盖 ${number(forecast.readiness.comparison)}/${number(forecast.readiness.actionSkuCount)} 个计费 SKU，暂不建议直接执行。`}</p></div>
    <div class="recommendation-value"><span>该路径预计净现金贡献</span><strong>${moneyOrPending(recommendationValue)}</strong><small>${escapeHtml(breakEvenText)}</small></div>
  `;

  const fullBookPnl = summary.readiness.actionSkuCount > 0 && summary.readiness.bookPnl === summary.readiness.actionSkuCount;
  const fullRemovalLoss = summary.readiness.actionSkuCount > 0 && summary.readiness.removalLoss === summary.readiness.actionSkuCount;
  const liquidationBookPnl = summary.actionUnits <= 0 ? "无计费库存" : fullBookPnl ? money(summary.liquidationBookProfit) : `待补 ${number(summary.readiness.actionSkuCount - summary.readiness.bookPnl)} 个 SKU`;
  const removalTotalLoss = summary.actionUnits <= 0 ? "无计费库存" : fullRemovalLoss ? money(summary.removalTotalLoss) : `待补 ${number(summary.readiness.actionSkuCount - summary.readiness.removalLoss)} 个 SKU`;
  document.querySelector("#scenario-grid").innerHTML = `
    <article class="scenario-card hold ${forecast.recommendation.key === "hold" ? "recommended" : ""}"><div><span>继续销售 ${selectedHorizon} 天，再清算剩余</span><b>${forecast.recommendation.key === "hold" ? "建议" : "路径一"}</b></div><h3>${moneyOrPending(forecast.holdThenLiquidateValue)}</h3><dl><div><dt>新增仓储费</dt><dd>-${moneyOrPending(forecast.totalHoldingCost)}</dd></div><div><dt>预计售出 / 剩余</dt><dd>${number(forecast.expectedSoldUnits)} / ${number(forecast.remainingUnits)} 件</dd></div></dl></article>
    <article class="scenario-card liquidate ${forecast.recommendation.key === "liquidate" ? "recommended" : ""}"><div><span>立即清算</span><b>${forecast.recommendation.key === "liquidate" ? "建议" : "路径二"}</b></div><h3>${money(summary.liquidationNet)}</h3><dl><div><dt>预计净回收</dt><dd>${money(summary.liquidationNet)}</dd></div><div><dt>扣历史成本后账面损益</dt><dd>${liquidationBookPnl}</dd></div></dl></article>
    <article class="scenario-card remove reference"><div><span>立即移除</span><b>仅作成本参考</b></div><h3>${money(-summary.removalFee)}</h3><dl><div><dt>Amazon 移除费现金影响</dt><dd>${money(-summary.removalFee)}</dd></div><div><dt>含采购与头程的总损失</dt><dd>${removalTotalLoss}</dd></div></dl><p>缺少移除后回收价值和下游成本，因此不参与最终推荐。</p></article>
  `;

  document.querySelector("#sensitivity-grid").innerHTML = forecast.sensitivity.map((scenario) => `
    <article class="sensitivity-item ${scenario.key === "baseline" ? "baseline" : ""}"><div><span>${scenario.label}情景</span><b>销量 ${scenario.multiplier === 1 ? "基准" : scenario.multiplier < 1 ? "−30%" : "+30%"}</b></div><strong>${escapeHtml(scenario.recommendation.label)}</strong><dl><div><dt>继续持有后净现金</dt><dd>${moneyOrPending(scenario.holdThenLiquidateValue)}</dd></div><div><dt>新增仓储费</dt><dd>${money(scenario.totalHoldingCost)}</dd></div></dl></article>
  `).join("");

  const maxForecastCost = Math.max(1, ...summary.forecasts.map((item) => item.totalHoldingCost || 0));
  document.querySelector("#forecast-coverage").textContent = `费用覆盖 ${number(forecast.readiness.storage)}/${number(forecast.readiness.actionSkuCount)} 个计费 SKU`;
  document.querySelector("#forecast-chart").innerHTML = summary.forecasts.map((item) => {
    const baseWidth = Math.max(0, item.baseStorageCost / maxForecastCost * 100);
    const agedWidth = Math.max(0, item.agedSurchargeCost / maxForecastCost * 100);
    return `<article class="forecast-row ${item.horizonDays === selectedHorizon ? "active" : ""}"><div class="forecast-label"><b>${item.horizonDays} 天</b><span>剩余 ${number(item.remainingUnits)} 件</span></div><div class="forecast-bar" aria-label="${item.horizonDays} 天累计新增仓储费 ${money(item.totalHoldingCost)}"><span class="base" style="width:${baseWidth}%"></span><span class="aged" style="width:${agedWidth}%"></span></div><strong>${money(item.totalHoldingCost)}</strong></article>`;
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
    if (scrollToResults) requestAnimationFrame(() => document.querySelector("#decision").scrollIntoView({ behavior: "smooth", block: "start" }));
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
  requestAnimationFrame(() => document.querySelector("#decision").scrollIntoView({ behavior: "smooth", block: "start" }));
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
