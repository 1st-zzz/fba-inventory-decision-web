import "./styles.css";
import {
  analyzeSources,
  createDemoAnalysis,
  exportRowsToCsv,
  workbookToSources,
} from "./analyzer.js";

const root = document.querySelector("#app");
let parsedSources = [];
let selectedFiles = [];
let current = createDemoAnalysis("US");
let usingDemo = true;
let query = "";
let riskFilter = "全部";
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
      <h1>上传运营报告，<br><em>当场得到处理建议</em></h1>
      <p>自动识别库存、库龄、仓储收费、佣金和商品报告，估算仓储费、长期仓储费、清算预计净回收与移除费。</p>
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
        <small>建议同时上传库存、库龄、收费、佣金和商品报告</small>
      </label>
      <div id="selected-files" class="selected-files"></div>
      <div class="upload-actions">
        <button id="analyze-button" class="primary-button" disabled>开始本地分析</button>
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

    <section class="decision-section">
      <article class="decision-card keep">
        <span>继续持有</span><h3>需结合净销售回款</h3>
        <p>若缺少 FBA 配送费、产品成本和头程，页面不会强行判定继续销售的最终利润。</p>
      </article>
      <article class="decision-card liquidate">
        <span>清算预计净回收</span><h3 id="liquidation-total"></h3>
        <p>已扣清算转介费和处理费；<b>尚未扣产品成本、头程等成本项</b>，不等于最终利润。</p>
      </article>
      <article class="decision-card remove">
        <span>立即移除费用</span><h3 id="removal-total"></h3>
        <p>仅估算 Amazon 移除费用，不含退回物流、回收价值及下游处理成本。</p>
      </article>
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
            <th>计费库龄</th><th>冗余</th><th>仓储费</th><th>长期仓储费</th>
            <th>清算预计净回收</th><th>移除费</th><th>建议动作</th>
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
const marketplace = document.querySelector("#marketplace");

function setStatus(message, kind = "info") {
  document.querySelector("#status-box").innerHTML = message
    ? `<div class="status ${kind}">${escapeHtml(message)}</div>`
    : "";
}

function updateSelectedFiles() {
  const container = document.querySelector("#selected-files");
  container.innerHTML = selectedFiles.map((file) => `
    <span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}<small>${number(file.size / 1024, 0)} KB</small></span>
  `).join("");
  analyzeButton.disabled = selectedFiles.length === 0;
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

function render() {
  const { summary, rule } = current;
  document.querySelector("#result-title").textContent = usingDemo ? "脱敏演示结果" : "本地报告分析结果";
  document.querySelector("#rule-version").textContent = `${rule.marketplace} · ${rule.version} · ${rule.currency}`;
  document.querySelector("#summary-grid").innerHTML = [
    metric("高风险 SKU", number(summary.riskCounts.high), `共 ${number(summary.skuCount)} 个 SKU`, "danger"),
    metric("可售库存", number(summary.available), `在途 / 调拨 ${number(summary.transfer)}`),
    metric("计费库龄库存", number(summary.aged), `${rule.marketplace} 从 ${rule.ageStart} 天起`, "warning"),
    metric("预计冗余库存", number(summary.excess), "按 90 天销量覆盖估算", "warning"),
    metric("月度仓储费", money(summary.storage), `费用可计算 ${summary.readiness.fee}/${summary.skuCount}`),
    metric("长期仓储费", money(summary.agedFee), "缺体积时不计入汇总"),
  ].join("");
  document.querySelector("#liquidation-total").textContent = money(summary.liquidationNet);
  document.querySelector("#removal-total").textContent = money(summary.removalFee);

  const reports = current.reports.filter((report) => report.type !== "unknown");
  document.querySelector("#report-strip").innerHTML = reports.length
    ? reports.map((report) => `<span><b>${escapeHtml(report.label)}</b>${number(report.rowCount)} 行<small>${escapeHtml(report.fileName)}</small></span>`).join("")
    : "";

  const rows = filteredRows();
  document.querySelector("#table-body").innerHTML = rows.slice(0, 200).map((row) => `
    <tr>
      <td><b>${escapeHtml(row.sku)}</b><span>${escapeHtml(row.asin)}</span><small>${escapeHtml(row.product)}</small></td>
      <td>${riskBadge(row.risk)}</td>
      <td>${number(row.available)}</td>
      <td>${number(row.sales30)}</td>
      <td>${row.daysSupply >= 999 ? "无销量" : number(row.daysSupply)}</td>
      <td>${number(row.aged)}</td>
      <td>${number(row.excess)}</td>
      <td>${Number.isFinite(row.storageEstimate) ? money(row.storageEstimate) : "待补数据"}</td>
      <td>${Number.isFinite(row.agedFee) ? money(row.agedFee) : "待补数据"}</td>
      <td>${Number.isFinite(row.liquidationNet) ? money(row.liquidationNet) : "待补数据"}</td>
      <td>${Number.isFinite(row.removalFee) ? money(row.removalFee) : "待补数据"}</td>
      <td><b class="action">${escapeHtml(row.action)}</b></td>
    </tr>
  `).join("");
  document.querySelector("#table-count").textContent = rows.length > 200
    ? `匹配 ${number(rows.length)} 个 SKU，当前展示前 200 个；完整结果请导出 CSV。`
    : `当前展示 ${number(rows.length)} 个 SKU。`;

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
    current = analyzeSources(parsedSources, marketplace.value);
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
  selectedFiles = [...event.target.files];
  updateSelectedFiles();
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
  selectedFiles = [...event.dataTransfer.files].filter((file) => /\.(xlsx|xls|xltx|csv|tsv)$/i.test(file.name));
  updateSelectedFiles();
});

analyzeButton.addEventListener("click", analyzeSelectedFiles);
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
  current = usingDemo ? createDemoAnalysis(marketplace.value) : analyzeSources(parsedSources, marketplace.value);
  render();
});
document.querySelector("#search-input").addEventListener("input", (event) => {
  query = event.target.value.trim();
  render();
});
document.querySelector("#risk-filter").addEventListener("change", (event) => {
  riskFilter = event.target.value;
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
