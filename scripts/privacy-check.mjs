import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignored = new Set(["node_modules", "dist", ".git"]);
const allowedExtensions = new Set([".js", ".mjs", ".html", ".css", ".json", ".md", ".yml", ".yaml"]);
const findings = [];

function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(fullPath);
      continue;
    }
    if (!allowedExtensions.has(path.extname(entry.name))) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    const withoutDemo = content
      .replaceAll("B0DEMO0001", "")
      .replaceAll("B0DEMO0002", "")
      .replace(/B0DEMO\d{4}/g, "")
      .replace(/X00DEMO\d+/g, "")
      .replace(/DEMO-[A-Z0-9-]+/g, "");
    const asin = withoutDemo.match(/\bB0[A-Z0-9]{8}\b/);
    const fnsku = withoutDemo.match(/\bX00[A-Z0-9]{7,}\b/);
    const sellerSku = withoutDemo.match(/\bM\d{1,2}-[A-Z0-9_]{5,}-[A-Z]{2}\b/);
    if (asin || fnsku || sellerSku) findings.push({ file: path.relative(root, fullPath), match: asin?.[0] || fnsku?.[0] || sellerSku?.[0] });
  }
}

scan(root);
if (findings.length) {
  console.error("Privacy check failed:", findings);
  process.exit(1);
}
console.log("Privacy check passed: no seller identifiers detected.");
