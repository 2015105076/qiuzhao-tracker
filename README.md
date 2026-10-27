# 投递簿 · 秋招投递手帐

一本安静、清晰的秋招投递记录本。把投递时间、企业、岗位和进度收进同一个页面，让每一次投递都有迹可循。

**在线使用：** https://2015105076.github.io/qiuzhao-tracker/

[![投递簿预览](assets/preview.jpg)](https://2015105076.github.io/qiuzhao-tracker/)

## 功能

- **记录投递**：企业、岗位、投递时间、当前状态四项必填，支持补充投递渠道、工作城市和备注。
- **状态管理**：已投递、筛选中、笔试、面试中、已获 Offer、未通过，可在列表中直接切换。
- **列表 / 看板双视图**：列表适合快速查找，看板支持拖拽卡片更新状态。
- **筛选与搜索**：按状态筛选，按企业、岗位、城市、渠道或备注搜索。
- **数据概览**：累计投递、正在推进、进入笔面、Offer 数量与本季推进率。
- **本地优先**：数据自动保存在浏览器 `localStorage`，无需注册，也不会发送到任何服务器。
- **数据备份**：支持导出 CSV 表格、导出/导入 JSON 备份。
- **响应式布局**：桌面端、平板和手机均可使用。
- **快捷键**：按 `N` 新增投递，按 `/` 聚焦搜索框。

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
│   ├── app.js                  # 数据、交互与本地存储
│   ├── favicon.svg
│   ├── og-cover.jpg
│   └── preview.jpg
├── .github/workflows/
│   └── deploy-pages.yml        # GitHub Pages 自动部署
└── README.md
```

## 技术栈

原生 HTML、CSS 和 JavaScript，无框架、无构建步骤。部署后就是一个纯静态站点。
