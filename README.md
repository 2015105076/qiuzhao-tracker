# 投递簿 · 秋招投递手帐

一本安静、清晰的秋招投递记录本。把投递时间、企业、岗位和进度收进同一个页面，支持 Excel 批量导入，让每一次投递都有迹可循。

**在线使用：** https://2015105076.github.io/qiuzhao-tracker/

[![投递簿预览](assets/preview.jpg)](https://2015105076.github.io/qiuzhao-tracker/)

## 功能

- **记录投递**：企业、岗位、投递时间、当前状态四项必填，支持补充投递渠道、工作城市和备注。
- **Excel 批量导入**：上传编辑好的 Excel 文件，自动识别字段、校验数据、预览后批量写入；支持跳过重复记录，并提供带状态下拉的模板与填写说明。
- **状态管理**：已投递、筛选中、笔试、面试中、已获 Offer、未通过，可在列表中直接切换。
- **列表 / 看板双视图**：列表适合快速查找，看板支持拖拽卡片更新状态。
- **筛选与搜索**：按状态筛选，按企业、岗位、城市、渠道或备注搜索。
- **数据概览**：累计投递、正在推进、进入笔面、Offer 数量与本季推进率。
- **本地优先**：数据自动保存在浏览器 `localStorage`，无需注册，也不会发送到任何服务器。
- **数据备份**：支持导出 CSV 表格、导出/导入 JSON 备份。
- **响应式布局**：桌面端、平板和手机均可使用。
- **快捷键**：按 `N` 新增投递，按 `/` 聚焦搜索框。

## Excel 批量导入

点击投递清单上方或右上角「数据」菜单中的「导入 Excel」，即可上传编辑好的表格。第一次使用建议先下载模板：

![Excel 批量导入预览](assets/import-preview.jpg)

1. 在「投递记录」工作表中填写数据，**不要修改第一行字段名**。
2. 每行填写一条投递记录，空行会自动跳过。
3. 上传后会先显示校验预览，重复记录默认跳过，确认无误后点击「导入」。
4. 有问题的行会标红并说明原因，可以回 Excel 修正后重新上传。

支持字段：

| 字段 | 必填 | 可识别的表头写法 |
| --- | --- | --- |
| 企业 | 是 | 企业、公司、企业名称、公司名称、单位、company |
| 岗位 | 是 | 岗位、职位、投递岗位、应聘岗位、position |
| 投递时间 | 是 | 投递时间、投递日期、申请日期、日期、date |
| 状态 | 否 | 状态、投递状态、当前状态、进度、status |
| 投递渠道 | 否 | 渠道、投递渠道、来源、channel |
| 工作城市 | 否 | 城市、工作城市、地点、location |
| 备注 | 否 | 备注、说明、notes |

状态可填写：`已投递`、`筛选中`、`笔试`、`面试中`、`已获 Offer`、`未通过`。状态留空时按「已投递」导入。

投递时间推荐使用 `YYYY-MM-DD` 格式，也支持 Excel 日期单元格、`2026/10/24`、`2026年10月24日` 等写法。

文件限制：支持 `.xlsx`、`.xls`、`.csv`，单次最多 1,000 条记录，文件不超过 8 MB。重复判断依据为「企业 + 岗位 + 投递时间」，导入前可选择是否跳过重复项。

## 本地运行

项目没有构建依赖，直接打开 `index.html` 或启动一个静态服务器即可：

```bash
python3 -m http.server 8000
```

然后访问 `http://localhost:8000`。

## 部署到 GitHub Pages

仓库已包含 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)。推送到 `main` 分支后，GitHub Actions 会自动发布静态站点。

首次部署时，在仓库的 **Settings → Pages → Build and deployment** 中将 Source 设为 **GitHub Actions** 即可。

## 数据说明

- 所有记录只保存在当前浏览器中，站点本身不包含任何个人投递数据。
- 清理浏览器网站数据、更换浏览器或使用无痕模式，记录可能丢失，建议定期从右上角「数据」导出 JSON 备份。
- CSV 使用 UTF-8 BOM 编码，可直接用 Excel 或 Numbers 打开。

## 项目结构

```text
.
├── index.html                  # 页面结构
├── assets/
│   ├── styles.css              # 视觉样式与响应式布局
│   ├── app.js                  # 数据、交互、Excel 导入与本地存储
│   ├── favicon.svg
│   ├── og-cover.jpg
│   ├── preview.jpg
│   ├── import-preview.jpg      # Excel 导入界面预览
│   ├── import-template.xlsx    # Excel 批量导入模板
│   └── vendor/                 # 按需加载的 SheetJS 及许可证
├── tools/
│   └── create_import_template.py  # 重新生成 Excel 模板
├── .github/workflows/
│   └── deploy-pages.yml        # GitHub Pages 自动部署
└── README.md
```

## 技术栈

原生 HTML、CSS 和 JavaScript，无框架、无构建步骤。Excel 解析使用按需加载的 [SheetJS Community Edition](https://sheetjs.com/)（Apache-2.0），详见 [`assets/vendor/README.md`](assets/vendor/README.md)。部署后就是一个纯静态站点。

## 第三方依赖

- [SheetJS Community Edition 0.20.3](https://sheetjs.com/)（Apache-2.0）：浏览器端 Excel 解析与模板生成，仅在导入时加载。
