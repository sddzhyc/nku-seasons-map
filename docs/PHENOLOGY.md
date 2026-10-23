# 物候库维护

编辑 `data/phenology.yaml`。运行 `npm run data:build` 校验/生成 JSON；`npm run dev` 开发服务也会监听此 YAML，成功后刷新网页，失败时在终端说明原因并保留有效包。正式构建会自动编译，不要直接修改生成的 JSON。

## 字段

| 字段 | 意义 |
| --- | --- |
| `schema_version` / `timezone` | 当前为 1 / Asia/Shanghai |
| `updated_at` | 资料维护日期，YYYY-MM-DD，手动更新 |
| `sources` | 来源 ID、标题、HTTPS URL、适用范围与局限 |
| `species[].id` | 稳定英文 ID，唯一 |
| `display_name` | 网页使用的名称 |
| `osm_species_values` | 对应的 OSM species 原值/明确别名；不区分拉丁名大小写，去除多余空格 |
| `verification` | reference 待校准参考；verified 已核实参考 |
| `source_ids` | 与来源列表关联 |
| `note` | 这条记录的推定方法、局限或观测说明 |
| `phases` | 多个无年份起止区间，可为空 |

区间有 `category`、`id`、`start`、`end`、`label`、`description`。时间必须是加引号的月日字符串，例如 `'11-01'`。秋叶类别 `autumn_leaf` 允许 `coloring`、`peak`、`falling`；花期类别 `flowering` 允许 `budding`、`bloom`、`fading`。同一阶段可以有多个互不重叠的区间，例如复花。

## 日期语义

- 开始与结束都包含。前一区间结束11月12日，后一区间最早从11月13日开始。
- 开始月日晚于结束月日表示跨年，如12月20日至1月10日。
- 同物种同类别的任意区间都不得重叠，跨年重叠也会被拒绝。不同类别可以同日存在。
- 采用北京时间的当前日，不受浏览器所在时区影响。
- 2月29日可作为年度边界，但非闰年不提供该日。仅在2月29日有效的区间在非闰年没有匹配；区间不会自动平移一天。
- 多物种 OSM 值按分号拆开后匹配，不擅自把同属不同种合并。

## 如何补资料

1. 在 OSM 中确认具体物种或品种，以及位置是否属于津南校区。
2. 记录多次本地观察或可靠资料的日期、年份、来源与适用范围。
3. 在 sources 中登记出处，再填写相应区间。粗略资料只支持粗略参考；不要把一篇报道的发布日期当作固定物候日界。
4. 有充分校园校准证据后再标为 verified。即便已核实，年度区间仍然是参考，不能表示当天现场的实测结果。
5. 运行数据校验、测试与构建，再提交 YAML 变更。Actions 会重新生成前端资料。

初始银杏资料采用[天津秋景资料](https://www.tjftz.gov.cn/contents/5992/376689.html)及[南开历史落叶活动记录](https://shxy.nankai.edu.cn/info/1870/2495.htm)作背景，具体阶段日界仍是维护者推定。山桃采用[南开三月花开记录](https://news.nankai.edu.cn/ywsd/system/2022/03/16/030050611.shtml)及[天津园林负责人访谈](https://news.enorth.com.cn/system/2026/03/21/059242643.shtml)。来源局限也随每条记录显示在网页上。
