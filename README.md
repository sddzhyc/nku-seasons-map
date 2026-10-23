# 南开一叶 · 津南校区赏叶地图

基于真实 OpenStreetMap 植物要素的校园地图，支持物种搜索、无年份物候库、按日期查询秋叶/花期、阶段高亮及 GitHub Actions / Pages 部署。代码位于 `F:/code/nku-autumn-map`。

## 本地运行

使用 Node.js 24（最低 22.12）：

```powershell
Set-Location F:/code/nku-autumn-map
npm ci
npm run dev
```

打开终端打印的地址。开发服务会校验并生成数据；修改 `data/phenology.yaml` 后自动重新编译和刷新页面，错误配置不会覆盖有效数据包。

```powershell
npm test
npm run build
npm run check:dist
npm run preview
```

`check:dist` 验证根路径和 `/nku-autumn-map/` 仓库子路径下的 JS/CSS、地图数据及物种索引可访问。构建产物为 `dist/`。

## 使用

- **按日期看物候**：选择日期、秋叶/花期和阶段。颜色表示初染/浓色/落叶或初绽/盛开/落花，落叶轮廓使用虚线。
- **今天**：按北京时间选择当前日期；保持页面打开时会随北京时间跨日更新。
- **全部物种分布**：不受日期或资料缺失影响，按物种着色。支持原始 species 标签和物候库名称别名搜索。
- **含待校准参考**：默认包含资料支持的初始推定；关闭后只看标记为已核实的资料。当前尚无已核实的校园日期，因此关闭后显示明确的空状态。
- **物候日历**：查看日期区间、所选日期阶段、来源及适用范围。可点物种返回地图，也可复制当前筛选链接。
- **地图与弹窗**：点、树列、树林和多多边形均保留真实轮廓；弹窗有 OSM 标签、阶段、资料说明与原始链接。校园简图与在线 OSM 标准底图可以切换。

**日期匹配是物候参考，不是现场实时叶况。** 初始库为银杏秋叶、山桃花期提供了待校准日期；其他 10 个物种保留条目但不编造日期。缺少记录不代表没有秋叶或花期。填写、校准方法见 [物候库维护](docs/PHENOLOGY.md)。

## 数据更新

```powershell
npm run data:build
npm run data:sync
npm run data:sync -- --with-basemap
npm run data:sync -- --with-basemap --allow-stale
```

- `data:build` 校验 YAML，按 OSM 快照生成物种索引、物候 JSON 及原子更新的一体数据包。
- `data:sync` 从 Overpass 获取校园物种并更新索引与数据包；`--with-basemap` 同时获取道路、建筑、水面等校园简图。
- 默认同步失败会报错并保留旧快照。部署使用 `--allow-stale`：发出明确警告，允许采用最后有效快照继续构建；无效 YAML 仍会使部署失败。
- 网页打开时读取站点数据，之后每 15 分钟检查新发布数据并尝试查询 Overpass；隐藏页面跳过查询。可手动同步，最短间隔 1 分钟。
- 公共 Overpass 在本环境曾返回 406/429 或超时，无法承诺即时更新；网页显示实际获取时间。GitHub Actions 可在不同网络中尝试同步。

仅在初始化/手动恢复时，可以执行 `npm run data:bootstrap` 从 OSM 编辑 API 获取一次范围数据和校园简图。该主 API 不用于定时轮询。原始范围文件 `osm-research.json` 若存在也可用 `npm run data:import` 导入，但构建不依赖该文件。

## 数据口径

校园范围来自 [OSM way/476603067](https://www.openstreetmap.org/way/476603067)，保留与校园边界相交的植物要素。2026-10-23 初始范围提取含 39 个带 species 的对象，合并多多边形的重复成员后为 **12 个物种、31 个独立要素，银杏 10 处**，包含 [way/1448582302](https://www.openstreetmap.org/way/1448582302)。数量随之后 OSM 编辑更新，不固定写入代码。

一个树列或多多边形关系计为一个要素，可能包含多片树林；要素数不等于树木株数。分号分隔的多物种进入各自分组。species 也可能标注月季、芍药等花卉。保留 OSM 标签原值，包括部分记录中可能不准确的 leaf_cycle；不据此自动生成物候。

`public/data/` 包含：

| 文件 | 内容 |
| --- | --- |
| `species.json` | 最近有效 OSM 植物快照、边界、来源、获取时间 |
| `campus.json` | OSM 道路、建筑、水面等校园简图 |
| `phenology.json` | 经校验的物候库 |
| `species-index.json` | 后台统计的物种、数量、OSM ID 与物候记录关联 |
| `site-data.json` | 一体数据包，避免前端读到不一致的索引、物候和地理数据 |

## 发布至 GitHub Pages

项目仓库为 [sddzhyc/nku-autumn-map](https://github.com/sddzhyc/nku-autumn-map)。已提供每 6 小时同步并部署的工作流，以及拉取请求检查。**启用步骤、权限、失败恢复见 [部署说明](docs/DEPLOYMENT.md)**。部署成功后的站点地址为 `https://sddzhyc.github.io/nku-autumn-map/`，实际运行情况见仓库 Actions。

## 资料与许可

技术选型与调研见 [设计说明](docs/ARCHITECTURE.md)。地图数据 © [OpenStreetMap 贡献者](https://www.openstreetmap.org/copyright)，按 ODbL 使用；标准底图遵守 [OSM 瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)，不批量抓取或预取瓦片。

物候资料来源写在 YAML 中，前端逐条展示。界面与代码独立实现，未复制参考地图代码或图片。依赖许可随各包保留。Google Fonts 不可用时回落系统中文字体。
