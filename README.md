# FBA Inventory Decision Web

面向运营人员的静态网页工具，用于分析 Amazon FBA 库存、库龄、仓储费、清算预计净回收与移除费。

## 隐私设计

- 公开仓库只包含脱敏演示数据。
- 运营报告通过浏览器本地读取，不会上传到 GitHub 或其他服务器。
- 页面刷新后，已选择的报告和分析结果会被清除。

## 支持的文件

- FBA 库存报告
- FBA 库龄报告
- 月度仓储收费报告
- 销售佣金预览报告
- 所有商品报告
- 包含兼容字段的 CSV / TSV

支持 XLSX、XLS、XLTX、CSV、TSV，可一次选择多个文件。当前费率表覆盖 US、CA、UK、DE，页面会显示规则版本和数据缺口。

## 本地运行

```bash
pnpm install
pnpm run dev
```

## 验证

```bash
pnpm test
pnpm run privacy-check
pnpm run build
```
