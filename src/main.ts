import L from "leaflet";
import {
  createIcons,
  Leaf,
  ArrowUpRight,
  Search,
  X,
  Layers,
  Crosshair,
  RefreshCw,
  MapPin,
  Info,
  ArrowRight,
  Check,
  Trees,
} from "lucide";
import "leaflet/dist/leaflet.css";
import "./style.css";
import type { Feature } from "geojson";
import {
  CENTER,
  convertOsm,
  ENDPOINTS,
  filterSpecies,
  groupSpecies,
  OVERPASS_QUERY,
  overpassUrl,
  speciesColor,
  validDataset,
} from "./data";
import type { Dataset, SpeciesFeature, SpeciesGroup } from "./data";
import {
  chinaToday,
  validDate,
  PHASES,
  phaseFor,
  recordFor,
  matchesFor,
  phaseColor,
  validateCatalog,
} from "./phenology";
import type { Catalog, Category, Match, SiteData } from "./phenology";
import { groupsForView, isDevMode } from "./view";
import { basemapConfig } from "./basemap";
import type { CampusBasemap } from "./basemap";
import { describeLocation } from "./locations";
import type { LocationData } from "./locations";

const DEV_MODE = isDevMode(location.search);
const devHidden = DEV_MODE ? "" : "hidden";
const streetConfig = basemapConfig(import.meta.env.VITE_TIANDITU_KEY ?? "");

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function icons() {
  createIcons({
    icons: {
      Leaf,
      ArrowUpRight,
      Search,
      X,
      Layers,
      Crosshair,
      RefreshCw,
      MapPin,
      Info,
      ArrowRight,
      Check,
      Trees,
    },
  });
}

document.querySelector("#app")!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="南开大学津南校区赏秋地图首页"><span class="brand-symbol"><i data-lucide="leaf"></i></span><span><b>南开大学津南校区赏秋地图</b><small>NANKAI · SEASONS ATLAS</small></span></a>
    <nav aria-label="主导航"><span class="nav-active">赏叶地图</span><a href="#phenology-calendar">物候日历</a><button id="about-button" ${devHidden}>数据说明 <i data-lucide="arrow-up-right"></i></button></nav>
    <span class="header-location"><span class="live-dot"></span> 天津 · 津南校区</span>
  </header>
  <main>
    <section class="intro" aria-labelledby="page-title">
      <div><div class="eyebrow"><span></span> 一叶知秋，一步一景</div><h1 id="page-title">把秋天，走成一张地图<span>。</span></h1><p>从一片银杏开始，发现津南校园的季节色彩。</p></div>
      <div class="intro-note"><span class="edition">CAMPUS FIELD NOTES / 01</span><span>南开大学 · 津南校区</span><small>基于 OpenStreetMap 的校园植物探索</small></div>
    </section>
    <section class="season-panel" aria-label="物候筛选">
      <div class="season-toolbar"><div class="view-tabs" aria-label="展示方式"><button id="view-season" aria-pressed="true">按日期看物候</button><button id="view-distribution" aria-pressed="false">全部物种分布</button></div><div class="date-controls"><label for="view-date">观赏日期</label><input type="date" id="view-date" aria-label="观赏日期"/><button id="today-button">今天</button><span class="time-zone">北京时间</span></div></div>
      <div id="season-options" class="season-options"><div class="category-tabs" aria-label="物候类型"><button data-category="autumn_leaf" aria-pressed="true">赏秋叶</button><button data-category="flowering" aria-pressed="false">看花开</button></div><div id="phase-filters" class="phase-filters" aria-label="物候阶段"></div><label class="reference-toggle"><input type="checkbox" id="include-reference" checked/>含待校准参考</label></div>
      <div class="season-note"><i data-lucide="info"></i><span id="season-summary" role="status" aria-live="polite">正在读取物候资料…</span><button id="calendar-jump">查看日期依据 <i data-lucide="arrow-right"></i></button></div>
    </section>
    <section class="explorer" aria-label="校园树种地图浏览器">
      <aside class="sidebar">
        <div class="sidebar-top"><div class="section-kicker">EXPLORE BY SPECIES</div><h2>循叶寻树 <span id="species-total">—</span></h2><p>选一个物种，看看它在哪里。</p></div>
        <div class="search-wrap"><i data-lucide="search"></i><input id="species-search" type="search" placeholder="搜索物种，如「银杏」" aria-label="搜索物种" autocomplete="off"/><button id="clear-search" aria-label="清除搜索" hidden><i data-lucide="x"></i></button></div>
        <div class="list-heading"><span id="list-title">校园物种</span><span>${DEV_MODE ? "OSM 要素数" : "分布处数"}</span></div>
        <div id="species-list" class="species-list" aria-label="物种选择"><div class="loading">正在读取校园植物数据…</div></div>
        <div class="sidebar-note"><span class="note-icon"><i data-lucide="leaf"></i></span><div><b>让每一片叶子有迹可循</b><p id="sidebar-guidance">物种位置来自 OSM，日期来自物候库。<br/>未登记日期的植物仍可在分布模式查看。</p></div></div>
      </aside>
      <div class="map-panel">
        <div id="map" role="region" aria-label="南开大学津南校区交互式地图"></div>
        <div class="map-topbar"><div class="map-heading"><span class="live-dot"></span><b>津南校园</b><span class="separator">/</span><span id="map-selection">全部物种</span></div><div class="map-view"><button id="base-toggle" aria-label="切换到${streetConfig.name}"><i data-lucide="layers"></i><span>校园简图</span></button></div></div>
        <div id="quick-filters" class="quick-filters" aria-label="快捷物种筛选"></div>
        <div id="map-empty" class="map-empty" hidden><i data-lucide="leaf"></i><b>暂无符合条件的物候记录</b><p id="empty-description">可以换个日期，或查看全部植物分布。</p><button id="empty-distribution">查看物种分布 <i data-lucide="arrow-right"></i></button></div>
        <div class="map-controls"><div class="north" aria-label="正北方向"><span>N</span><svg width="16" height="23" viewBox="0 0 16 23" aria-hidden="true"><path d="M8 1L15 21L8 16L1 21Z" fill="#435449"/><path d="M8 1V16L1 21Z" fill="#a0ada0"/></svg></div><button id="fit-campus" aria-label="回到校园全景" title="回到校园全景"><i data-lucide="crosshair"></i></button><button id="zoom-in" aria-label="放大地图">+</button><button id="zoom-out" aria-label="缩小地图">−</button></div>
        <div id="selection-card" class="selection-card"><span class="card-icon"><i data-lucide="trees"></i></span><div><b id="selection-title">校园植物图鉴</b><p id="selection-description">正在加载真实 OSM 要素</p></div><span id="selection-number">—</span></div>
        <div class="map-caption"><span class="outline-swatch"></span>校园边界 <span id="context-caption"><span class="caption-divider">·</span> 周边随距离淡化</span> <span class="caption-divider">·</span> 点击标记查看植物</div>
        <div id="tile-warning" class="tile-warning" role="status" hidden>标准底图暂未加载，可切回校园简图。</div>
      </div>
    </section>
    <section class="data-bar" aria-label="数据更新时间"><div><span class="status-dot" ${devHidden}></span><span id="data-status" role="status" aria-live="polite" ${devHidden}>正在读取数据</span><span class="data-divider" ${devHidden}></span><span id="data-time">暂无数据同步日期</span></div><button id="refresh-data" ${devHidden}><i data-lucide="refresh-cw"></i><span>同步 OSM 数据</span></button></section>
    <section id="phenology-calendar" class="calendar-section" aria-labelledby="calendar-title"><div class="calendar-header"><div><div class="section-kicker">FOLLOW THE SEASONS</div><h2 id="calendar-title">校园物候日历<span>每一年，都值得期待</span></h2></div><button id="copy-link">复制当前地图链接 <i data-lucide="arrow-up-right"></i></button></div><p class="calendar-intro" id="calendar-disclaimer"></p><div class="calendar-table-wrap"><table class="calendar-table"><thead><tr><th>${DEV_MODE ? "物种 / OSM 要素" : "物种 / 分布处数"}</th><th>所选日期的参考状态</th><th>全年日期区间（无年份）</th><th>资料依据</th></tr></thead><tbody id="calendar-body"></tbody></table></div></section>
    <footer><span>在南开，拾起一整个秋天。</span><span>地图数据 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap 贡献者</a> <span class="footer-dot">·</span> <button id="source-button">数据说明 <i data-lucide="arrow-up-right"></i></button></span></footer>
  </main>
  <dialog id="about-dialog" aria-labelledby="about-title"><div class="dialog-top"><span class="eyebrow">ABOUT THE ATLAS</span><button id="close-dialog" aria-label="关闭说明"><i data-lucide="x"></i></button></div><h2 id="about-title">关于这张地图</h2><p>沿着真实的植物分布，读懂校园的季节。</p><div class="dialog-block"><h3>真实位置，开放数据</h3><p>点、树列及树林轮廓来自 OSM，按津南校区边界筛选。一个多多边形要素可能包含数片树林；要素数不等于树木株数。species 标签也可能标注花卉或灌木。</p></div><div class="dialog-block"><h3>日期参考与现场叶况</h3><p>分布模式按物种着色；物候模式按所选日期的阶段着色。日期由 YAML 物候库维护，历史资料和初始推定标为“待校准参考”。当前没有接入现场观测，不能把日期匹配当作实时实景。未登记区间表示资料缺失，不代表该植物没有秋叶或花期。</p></div><div class="dialog-block"><h3>每年重复的日期</h3><p>使用北京时间，日期区间包含首尾两天。开始晚于结束表示跨年。日历可查看不同年份，物候库本身不绑定年份；2月29日仅能在闰年选择。</p></div><div class="dialog-block"><h3>地图如何保持更新</h3><p>每15分钟先检查站点发布数据，再尝试 Overpass 获取最新物种。Actions 每6小时同步物种和简图并发布；失败时保留最近有效快照。OSM 编辑、Overpass 和瓦片更新各有延迟，页面始终显示数据获取时间。</p></div><a class="dialog-link" href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">参与完善 OpenStreetMap <i data-lucide="arrow-up-right"></i></a></dialog>
`;
icons();

const map = L.map("map", {
  center: CENTER,
  zoom: 16,
  zoomSnap: 0.25,
  minZoom: 13,
  maxZoom: 20,
  zoomControl: false,
  attributionControl: true,
});
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution(
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
);
L.control
  .scale({ imperial: false, position: "bottomleft", maxWidth: 90 })
  .addTo(map);
map.createPane("base");
map.getPane("base")!.style.zIndex = "210";
map.createPane("labels");
map.getPane("labels")!.style.zIndex = "390";
map.getPane("labels")!.style.pointerEvents = "none";
map.createPane("species");
map.getPane("species")!.style.zIndex = "420";
const base = L.layerGroup().addTo(map);
const labels = L.layerGroup().addTo(map);
const highlights = L.layerGroup().addTo(map);
let boundary: L.GeoJSON | undefined;
let data: Dataset | undefined;
let groups: SpeciesGroup[] = [];
const initial = new URLSearchParams(location.search);
let selected: string | null = initial.get("species");
let mode: "season" | "distribution" =
  initial.get("view") === "distribution" ? "distribution" : "season";
let date = validDate(initial.get("date") ?? "")
  ? initial.get("date")!
  : chinaToday();
let followsToday = !initial.has("date");
let category: Category =
  initial.get("category") === "flowering" ? "flowering" : "autumn_leaf";
let phaseFilter = PHASES[category].some((p) => p.id === initial.get("phase"))
  ? initial.get("phase")!
  : "all";
let includeReferences = initial.get("refs") !== "0";
let catalog: Catalog | undefined;
let locationData: LocationData | undefined;
let revision = "";
let query = "";
let refreshBusy = false;
let lastAttempt = 0;
let standardBase = false;
let labelVisibilityHandler: (() => void) | undefined;
const tileLayers = streetConfig.urls.map((url, index) =>
  L.tileLayer(url, {
    maxNativeZoom: streetConfig.maxNativeZoom,
    maxZoom: 20,
    subdomains: streetConfig.subdomains,
    attribution: index === 0 ? streetConfig.attribution : undefined,
  }),
);
const streetLayer = L.layerGroup(tileLayers);
const popupOptions: L.PopupOptions = {
  maxWidth: 310,
  maxHeight: 260,
  autoPanPaddingTopLeft: L.point(20, 110),
  autoPanPaddingBottomRight: L.point(45, 105),
};
for (const tileLayer of tileLayers) {
  tileLayer.on("tileerror", () => {
    $("tile-warning").textContent =
      `${streetConfig.name}暂未加载，可切回校园简图。`;
    $("tile-warning").hidden = !standardBase;
  });
  tileLayer.on("tileload", () => {
    $("tile-warning").hidden = true;
  });
}

function fitCampus() {
  if (boundary)
    map.fitBounds(boundary.getBounds(), {
      paddingTopLeft: [40, 95],
      paddingBottomRight: [40, 95],
      maxZoom: 16,
    });
}
$("fit-campus").onclick = fitCampus;
$("zoom-in").onclick = () => map.zoomIn();
$("zoom-out").onclick = () => map.zoomOut();
$("base-toggle").onclick = () => {
  standardBase = !standardBase;
  $("context-caption").hidden = standardBase;
  if (standardBase) {
    map.removeLayer(base);
    map.removeLayer(labels);
    streetLayer.addTo(map);
  } else {
    map.removeLayer(streetLayer);
    base.addTo(map);
    labels.addTo(map);
    $("tile-warning").hidden = true;
  }
  $("base-toggle").innerHTML =
    `<i data-lucide="layers"></i><span>${standardBase ? streetConfig.name : "校园简图"}</span>`;
  $("base-toggle").setAttribute(
    "aria-label",
    `切换到${standardBase ? "校园简图" : streetConfig.name}`,
  );
  icons();
};

function addCampusBase(collection: CampusBasemap) {
  base.clearLayers();
  labels.clearLayers();
  const areas = collection.features.filter((f) =>
    /Polygon/.test(f.geometry.type),
  );
  const rank = (f: Feature) =>
    f.properties?.building
      ? 3
      : f.properties?.water || f.properties?.natural === "water"
        ? 2
        : 1;
  areas.sort((a, b) => rank(a) - rank(b));
  L.geoJSON(areas, {
    pane: "base",
    interactive: false,
    style: (feature) => {
      const t = feature?.properties ?? {};
      if (t.building)
        return {
          fillColor: "#deded2",
          fillOpacity: 1,
          color: "#c8ccbc",
          weight: 0.8,
        };
      if (t.water || t.natural === "water")
        return {
          fillColor: "#c7dcd7",
          fillOpacity: 1,
          color: "#b6d1cc",
          weight: 1,
        };
      if (t.leisure === "pitch" || t.leisure === "track")
        return {
          fillColor: "#d3ddbd",
          fillOpacity: 1,
          color: "#c1cfae",
          weight: 1,
        };
      return {
        fillColor: "#e0e8cf",
        fillOpacity: 0.75,
        color: "#d0dbbe",
        weight: 0.6,
      };
    },
  }).addTo(base);
  const roads = collection.features.filter(
    (f) => /LineString/.test(f.geometry.type) && f.properties?.highway,
  );
  const weight = (f: Feature) =>
    ["footway", "path", "steps"].includes(f.properties?.highway) ? 1.6 : 4.5;
  L.geoJSON(roads, {
    pane: "base",
    interactive: false,
    style: (f) => ({
      color: "#d5d9c9",
      weight: weight(f!) + 1.5,
      opacity: 0.85,
      lineCap: "round",
    }),
  }).addTo(base);
  L.geoJSON(roads, {
    pane: "base",
    interactive: false,
    style: (f) => ({
      color: "#fbfbf2",
      weight: weight(f!),
      opacity: 1,
      lineCap: "round",
    }),
  }).addTo(base);
  // Geographic bands follow the real boundary. Draw above all background
  // geometry so a road crossing campus also fades along its outside portion.
  if (collection.context?.fadeBands) {
    L.geoJSON(collection.context.fadeBands, {
      pane: "base",
      interactive: false,
      style: (f) => ({
        className: "context-fade-band",
        stroke: false,
        fillColor: "#edf1e1",
        fillOpacity: Number(f?.properties?.fadeOpacity ?? 0),
        fillRule: "evenodd",
      }),
    }).addTo(base);
  }
  const named = collection.features.filter(
    (f) =>
      f.properties?.name &&
      (f.properties.building ||
        f.properties.natural === "water" ||
        (f.geometry.type === "Point" && f.properties.amenity)),
  );
  for (const f of named) {
    const point = L.geoJSON(f).getBounds().getCenter();
    const opacity = Number(f.properties?.contextOpacity ?? 1);
    const outside = opacity < 1;
    const important =
      !outside &&
      /湖|中心图书馆|学一食堂|学二食堂|体育馆/.test(String(f.properties!.name));
    L.marker(point, {
      interactive: false,
      keyboard: false,
      pane: "labels",
      opacity,
      icon: L.divIcon({
        className: `campus-label${important ? " key-label" : ""}${outside ? " context-label" : ""}`,
        html: esc(String(f.properties!.name)),
        iconSize: [110, 20],
        iconAnchor: [55, 10],
      }),
    }).addTo(labels);
  }
  const showLabels = () => {
    $("map").classList.toggle("show-labels", map.getZoom() >= 16.5);
    $("map").classList.toggle("show-key-labels", map.getZoom() >= 15);
  };
  if (labelVisibilityHandler) map.off("zoomend", labelVisibilityHandler);
  labelVisibilityHandler = showLabels;
  map.on("zoomend", showLabels);
  showLabels();
}

function popup(feature: SpeciesFeature) {
  const root = document.createElement("div");
  root.className = "plant-popup";
  const title = document.createElement("h3");
  title.textContent = feature.properties.species.join(" · ");
  root.append(title);
  const position = describeLocation(
    feature,
    data!.campus,
    locationData?.landmarks ?? [],
    locationData?.overrides,
  );
  const address = document.createElement("div");
  address.className = "popup-location";
  const addressLabel = document.createElement("strong");
  addressLabel.textContent = "大致位置";
  const addressText = document.createElement("p");
  addressText.className = "location-description";
  addressText.textContent = position.text;
  const addressNote = document.createElement("small");
  addressNote.textContent =
    position.source === "manual"
      ? "维护者补充的位置描述"
      : position.source === "fallback"
        ? "附近地标资料不足，可结合地图查看。"
        : "按附近地标估算；树列和树林可能延伸至周边。";
  address.append(addressLabel, addressText, addressNote);
  root.append(address);
  if (DEV_MODE || feature.properties.tags.name) {
    const subtitle = document.createElement("p");
    subtitle.textContent =
      feature.properties.tags.name ||
      (/Polygon/.test(feature.geometry.type)
        ? "树林 / 植物区域"
        : /Line/.test(feature.geometry.type)
          ? "树列 / 线状要素"
          : "单株 / 点要素");
    root.append(subtitle);
  }
  if (DEV_MODE) {
    const dl = document.createElement("dl");
    for (const [key, value] of Object.entries(feature.properties.tags)) {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dl.append(dt, dd);
    }
    root.append(dl);
  }
  const note = document.createElement("p");
  note.className = "popup-note";
  const matching = feature.properties.species
    .map((name) =>
      catalog
        ? phaseFor(name, date, category, catalog, includeReferences)
        : undefined,
    )
    .filter((m): m is Match => !!m);
  note.textContent = matching.length
    ? `${date} · ${matching.map((m) => `${m.record.display_name}：${m.phase.label}（${m.record.verification === "verified" ? "已核实参考" : "待校准参考"}）`).join("；")}。日期参考不代表现场实时叶况。`
    : "所选日期暂无符合当前资料条件的物候区间；仍可查看真实植物分布。";
  root.append(note);
  if (catalog)
    for (const name of feature.properties.species) {
      const record = recordFor(name, catalog);
      if (!record) continue;
      const detail = document.createElement("p");
      detail.textContent = record.note;
      detail.className = "popup-note";
      root.append(detail);
      for (const source of catalog.sources.filter((s) =>
        record.source_ids.includes(s.id),
      )) {
        const a = document.createElement("a");
        a.href = source.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = `资料：${source.title}`;
        a.className = "popup-source";
        root.append(a);
      }
    }
  if (DEV_MODE) {
    const link = document.createElement("a");
    link.href = `https://www.openstreetmap.org/${feature.properties.osmId}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "查看 OSM 原始要素 ↗";
    root.append(link);
  }
  return root;
}

function activeMatch(feature: SpeciesFeature): Match | undefined {
  if (!catalog) return;
  const matches = selected
    ? [phaseFor(selected, date, category, catalog, includeReferences)].filter(
        (m): m is Match => !!m,
      )
    : matchesFor(feature, date, category, catalog, includeReferences);
  return matches
    .filter((m) => phaseFilter === "all" || m.phase.id === phaseFilter)
    .sort(
      (a, b) =>
        PHASES[category].findIndex((p) => p.id === b.phase.id) -
        PHASES[category].findIndex((p) => p.id === a.phase.id),
    )[0];
}

function renderHighlights(focus = false) {
  highlights.clearLayers();
  if (!data) return;
  let features = selected
    ? data.features.filter((f) => f.properties.species.includes(selected!))
    : data.features;
  if (mode === "season")
    features = features.filter((feature) => activeMatch(feature));
  const bounds = L.latLngBounds([]);
  for (const feature of features) {
    const match = activeMatch(feature);
    const color =
      mode === "season" && match
        ? phaseColor(category, match.phase.id)
        : speciesColor(selected ?? feature.properties.species[0], groups);
    const layer = L.geoJSON(feature, {
      pane: "species",
      style: {
        color,
        weight: selected ? 2.8 : 1.7,
        fillColor: color,
        fillOpacity: selected ? 0.48 : 0.35,
        opacity: 0.95,
        dashArray:
          mode === "season" && match?.phase.id === "falling"
            ? "5 3"
            : undefined,
      },
      pointToLayer: (_, latlng) =>
        L.circleMarker(latlng, {
          radius: 7,
          color: "#fff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
          pane: "species",
        }),
      onEachFeature: (_, child) => {
        child.bindPopup(() => popup(feature), popupOptions);
        child.bindTooltip(feature.properties.species.join(" · "), {
          sticky: true,
          direction: "top",
        });
      },
    }).addTo(highlights);
    bounds.extend(layer.getBounds());
    if (feature.geometry.type !== "Point") {
      const marker = L.marker(layer.getBounds().getCenter(), {
        title: feature.properties.species.join(" · "),
        icon: L.divIcon({
          className: "plant-marker",
          html: `<span style="--plant-color:${color}" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 15C3 14 2 7 4 3C9 3 10 6 10 8C10 5 14 3 17 3C18 9 15 14 10 15Z" fill="currentColor"/><path d="M10 8v10" stroke="currentColor" stroke-width="1.6"/></svg></span>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      })
        .bindPopup(() => popup(feature), popupOptions)
        .addTo(highlights);
    }
  }
  $("map-empty").hidden = features.length > 0;
  $("empty-description").textContent = !includeReferences
    ? "仅看已核实资料时，暂未找到匹配记录。可以勾选“含待校准参考”。"
    : "所选日期、物种或阶段暂无匹配记录。缺少日期不代表没有植物。";
  $("map-selection").textContent =
    selected ??
    (mode === "season"
      ? category === "autumn_leaf"
        ? "秋叶参考"
        : "花期参考"
      : "全部物种");
  $("selection-title").textContent =
    mode === "season"
      ? `${date.slice(5).replace("-", "月")}日 · ${category === "autumn_leaf" ? "秋叶" : "花期"}参考`
      : selected
        ? `${selected}的校园足迹`
        : "校园植物图鉴";
  $("selection-description").textContent =
    mode === "season"
      ? `${new Set(features.flatMap((f) => f.properties.species.filter((n) => catalog && phaseFor(n, date, category, catalog, includeReferences)))).size} 个匹配物种 · ${includeReferences ? "含待校准参考" : "仅已核实资料"}`
      : selected
        ? DEV_MODE
          ? "处 OSM 要素 · 点击地图标记了解详情"
          : "处植物分布 · 点击地图标记了解详情"
        : `${groups.length} 个物种 · 点、线与树林轮廓`;
  $("selection-number").textContent = String(features.length);
  $("selection-card").style.setProperty(
    "--selection-color",
    selected ? speciesColor(selected, groups) : "#62764d",
  );
  if (focus && bounds.isValid())
    map.fitBounds(bounds, {
      paddingTopLeft: [55, 140],
      paddingBottomRight: [55, 120],
      maxZoom: 17,
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
}

function selectSpecies(name: string | null) {
  selected = name;
  renderView(true);
}

function eligibleGroups() {
  return groupsForView(groups, catalog, mode, category, includeReferences);
}
function allSpeciesLabel() {
  return mode === "season"
    ? category === "autumn_leaf"
      ? "全部秋叶物种"
      : "全部花期物种"
    : "全部物种";
}

function renderList() {
  const available = eligibleGroups();
  const baseMatches = filterSpecies(available, query);
  const filtered = available.filter(
    (g) =>
      baseMatches.includes(g) ||
      (catalog &&
        recordFor(g.name, catalog)?.osm_species_values.some((a) =>
          a.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        )),
  );
  $("species-total").textContent = String(available.length);
  $("clear-search").hidden = !query;
  $("list-title").textContent = query
    ? `找到 ${filtered.length} 个物种`
    : mode === "season"
      ? "已有对应物候日期的物种"
      : "校园物种";
  const availableCount = new Set(
    available.flatMap((g) => g.features.map((f) => f.properties.osmId)),
  ).size;
  const all = `<button class="species-row all-row ${selected === null ? "selected" : ""}" data-index="all" aria-pressed="${selected === null}"><span class="species-icon all-icon"><i data-lucide="layers"></i></span><span class="species-name">${allSpeciesLabel()}<small>${mode === "season" ? "仅列已登记此类日期的物种" : "看见校园的每一抹色彩"}</small></span><span class="species-count">${availableCount}</span></button>`;
  $("species-list").innerHTML =
    all +
    (filtered.length
      ? filtered
          .map((g) => {
            const color = speciesColor(g.name, groups);
            const match = catalog
              ? phaseFor(g.name, date, category, catalog, includeReferences)
              : undefined;
            const detail =
              mode === "season"
                ? match
                  ? `${match.phase.label} · ${match.record.verification === "reference" ? "待校准" : "已核实"}`
                  : catalog &&
                      recordFor(g.name, catalog)?.phases.some(
                        (p) => p.category === category,
                      )
                    ? "日期未匹配 / 资料已筛选"
                    : "暂无此类物候日期"
                : g.features.some((f) => /Polygon/.test(f.geometry.type))
                  ? "含树林 / 植物区域"
                  : "点状 / 线状植物";
            return `<button class="species-row ${selected === g.name ? "selected" : ""}" data-index="${groups.indexOf(g)}" aria-pressed="${selected === g.name}" style="--species-color:${mode === "season" && match ? phaseColor(category, match.phase.id) : color}"><span class="species-icon"><i data-lucide="leaf"></i></span><span class="species-name">${esc(g.name)}<small>${esc(detail)}</small></span><span class="species-count">${g.count}</span><i class="row-arrow" data-lucide="arrow-right"></i></button>`;
          })
          .join("")
      : `<div class="empty-state"><i data-lucide="search"></i><b>${query ? "还没有找到这个物种" : "暂无符合条件的物候资料"}</b><p>${query ? "可清空搜索，或切换到全部物种分布。" : "可包含待校准参考，或查看全部物种分布。"}</p></div>`);
  icons();
}
function renderQuickFilters() {
  const names = eligibleGroups().filter((g) =>
    ["银杏", "山桃", "毛白杨"].includes(g.name),
  );
  $("quick-filters").innerHTML =
    `<button data-index="all" aria-pressed="${selected === null}" class="${selected === null ? "active" : ""}">${allSpeciesLabel()}</button>` +
    names
      .map(
        (g) =>
          `<button data-index="${groups.indexOf(g)}" aria-pressed="${selected === g.name}" class="${selected === g.name ? "active" : ""}"><span style="background:${speciesColor(g.name, groups)}"></span>${esc(g.name)}</button>`,
      )
      .join("");
}

function renderCalendar() {
  if (!catalog) return;
  $("calendar-disclaimer").textContent = catalog.disclaimer;
  $("calendar-body").innerHTML = eligibleGroups()
    .map((g) => {
      const index = groups.indexOf(g);
      const record = recordFor(g.name, catalog!);
      const matching = phaseFor(
        g.name,
        date,
        category,
        catalog!,
        includeReferences,
      );
      const ranges =
        record?.phases
          .map(
            (p) =>
              `<span class="calendar-range" style="--phase-color:${phaseColor(p.category, p.id)}"><b>${esc(p.label)}</b> ${p.start.replace("-", "/")}—${p.end.replace("-", "/")}<small>${esc(p.description)} · ${p.category === "flowering" ? "花期" : "秋叶"}</small></span>`,
          )
          .join("") || '<span class="muted">暂无日期，等待本地观测补充</span>';
      const sources =
        record?.source_ids
          .map((id) => catalog!.sources.find((s) => s.id === id)!)
          .map(
            (s) =>
              `<a href="${esc(s.url)}" title="${esc(s.scope)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`,
          )
          .join("") ?? "";
      return `<tr><td><button class="calendar-species" data-index="${index}">${esc(g.name)} <i data-lucide="arrow-up-right"></i></button><small>${g.count} ${DEV_MODE ? "处独立 OSM 要素" : "处植物分布"}</small></td><td>${matching ? `<span class="phase-badge" style="--phase-color:${phaseColor(category, matching.phase.id)}">${esc(matching.phase.label)}</span><small>${matching.record.verification === "verified" ? "已核实参考" : "待校准参考"}</small>` : `<span class="muted">${record?.phases.some((p) => p.category === category) ? "日期未匹配 / 资料已筛选" : "暂无此类物候日期"}</span>`}</td><td><div class="calendar-ranges">${ranges}</div></td><td><details><summary>${record?.phases.length ? (record.verification === "verified" ? "已核实资料" : "待校准参考 · 查看依据") : "待补充资料"}</summary><p>${esc(record?.note ?? "新增 OSM 物种尚未关联物候库。")}</p>${sources}</details></td></tr>`;
    })
    .join("");
}

function renderView(focus = false) {
  if (selected && !eligibleGroups().some((g) => g.name === selected))
    selected = null;
  $("view-season").setAttribute("aria-pressed", String(mode === "season"));
  $("view-distribution").setAttribute(
    "aria-pressed",
    String(mode === "distribution"),
  );
  $<HTMLInputElement>("view-date").value = date;
  $<HTMLInputElement>("view-date").disabled = mode === "distribution";
  $("season-options").hidden = mode === "distribution";
  $<HTMLInputElement>("include-reference").checked = includeReferences;
  document
    .querySelectorAll<HTMLButtonElement>("[data-category]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.category === category)),
    );
  $("phase-filters").innerHTML =
    `<button data-phase="all" aria-pressed="${phaseFilter === "all"}">全部阶段</button>` +
    PHASES[category]
      .map(
        (p) =>
          `<button data-phase="${p.id}" aria-pressed="${phaseFilter === p.id}" style="--phase-color:${p.color}"><span></span>${p.label}</button>`,
      )
      .join("");
  const configured = groups.filter(
    (g) =>
      catalog &&
      recordFor(g.name, catalog)?.phases.some((p) => p.category === category),
  ).length;
  const active = groups.filter(
    (g) =>
      catalog && phaseFor(g.name, date, category, catalog, includeReferences),
  ).length;
  $("season-summary").textContent =
    mode === "distribution"
      ? "分布模式：颜色区分物种；点击物候日历可查看日期与资料来源。"
      : `${date} · ${category === "autumn_leaf" ? "秋叶" : "花期"}参考，${active} 个物种匹配日期；${groups.length - configured} 个物种暂无此类日期。${includeReferences ? "含待校准推定，不代表现场实况。" : "仅显示已核实资料，未核实记录已隐藏。"}`;
  renderList();
  renderQuickFilters();
  renderHighlights(focus);
  renderCalendar();
  icons();
  const params = new URLSearchParams({ view: mode, date, category });
  if (selected) params.set("species", selected);
  if (phaseFilter !== "all") params.set("phase", phaseFilter);
  if (!includeReferences) params.set("refs", "0");
  if (DEV_MODE) params.set("dev", "1");
  history.replaceState(
    null,
    "",
    `${location.pathname}?${params}${location.hash}`,
  );
}

$("view-season").onclick = () => {
  mode = "season";
  renderView();
};
$("view-distribution").onclick = $("empty-distribution").onclick = () => {
  mode = "distribution";
  renderView(true);
};
$<HTMLInputElement>("view-date").onchange = (event) => {
  const value = (event.target as HTMLInputElement).value;
  if (validDate(value)) {
    date = value;
    followsToday = false;
    renderView();
  }
};
$("today-button").onclick = () => {
  date = chinaToday();
  followsToday = true;
  mode = "season";
  renderView();
};
$<HTMLInputElement>("include-reference").onchange = (event) => {
  includeReferences = (event.target as HTMLInputElement).checked;
  renderView();
};
document.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((b) => {
  b.onclick = () => {
    category = b.dataset.category as Category;
    phaseFilter = "all";
    renderView();
  };
});
$("phase-filters").onclick = (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-phase]",
  );
  if (button) {
    phaseFilter = button.dataset.phase!;
    renderView();
  }
};
$("calendar-body").onclick = (event) => {
  onSpeciesClick(event);
  if ((event.target as HTMLElement).closest("button[data-index]"))
    $("map").scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
};
$("calendar-jump").onclick = () =>
  $("phenology-calendar").scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
$("copy-link").onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $("copy-link").textContent = "当前地图链接已复制";
  } catch {
    window.prompt("复制当前地图链接", location.href);
  }
};
setInterval(() => {
  if (followsToday && date !== chinaToday()) {
    date = chinaToday();
    renderView();
  }
}, 60_000);
function onSpeciesClick(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-index]",
  );
  if (button)
    selectSpecies(
      button.dataset.index === "all"
        ? null
        : groups[Number(button.dataset.index)].name,
    );
}
$("species-list").onclick = onSpeciesClick;
$("quick-filters").onclick = onSpeciesClick;
$<HTMLInputElement>("species-search").oninput = (event) => {
  query = (event.target as HTMLInputElement).value;
  renderList();
};
$("clear-search").onclick = () => {
  query = "";
  $<HTMLInputElement>("species-search").value = "";
  renderList();
  $("species-search").focus();
};

function useData(next: Dataset, status: string) {
  data = next;
  groups = groupSpecies(data.features);
  if (selected && !groups.some((g) => g.name === selected)) selected = null;
  if (boundary) map.removeLayer(boundary);
  boundary = L.geoJSON(data.campus, {
    interactive: false,
    style: {
      color: "#94a687",
      weight: 1.5,
      dashArray: "6 6",
      fillColor: "#ebefdd",
      fillOpacity: 0.15,
    },
  }).addTo(map);
  $("data-status").textContent = status;
  $("data-time").textContent =
    (DEV_MODE ? "数据同步时间：" : "最近数据同步：") +
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(DEV_MODE
        ? { hour: "2-digit" as const, minute: "2-digit" as const }
        : {}),
      hour12: false,
    }).format(new Date(data.fetchedAt));
  $("data-time").title = DEV_MODE
    ? `获取时间（北京时间）：${data.fetchedAt}${data.osmTimestamp ? "\nOSM 数据时间：" + data.osmTimestamp : ""}`
    : "北京时间";
  renderView();
}

async function refresh(manual = false) {
  if (refreshBusy || (!manual && document.hidden)) return;
  if (Date.now() - lastAttempt < 60_000) {
    if (manual)
      $("data-status").textContent = "请稍候再同步，两次查询至少间隔 1 分钟。";
    return;
  }
  refreshBusy = true;
  lastAttempt = Date.now();
  const button = $<HTMLButtonElement>("refresh-data");
  button.disabled = true;
  button.classList.add("syncing");
  $("data-status").textContent = "正在向 OSM / Overpass 查询最新物种数据…";
  const failures: string[] = [];
  let publishedUpdated = false;
  try {
    try {
      publishedUpdated = await loadPublished();
      if (publishedUpdated) await loadBasemap();
    } catch (error) {
      failures.push(`站点快照：${String(error)}`);
    }
    for (const endpoint of ENDPOINTS) {
      try {
        const response = await fetch(overpassUrl(endpoint, OVERPASS_QUERY), {
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = convertOsm(await response.json(), endpoint);
        useData(next, "已同步 OSM · 下次自动查询约 15 分钟后");
        try {
          localStorage.setItem("nku-osm-cache-v1", JSON.stringify(next));
        } catch {
          /* Storage is optional. */
        }
        return;
      } catch (error) {
        failures.push(`${endpoint}: ${String(error)}`);
      }
    }
    $("data-status").textContent = publishedUpdated
      ? "已载入站点更新 · OSM 实时查询暂不可用"
      : "同步暂不可用 · 已保留上次有效数据";
    $("data-status").title = failures.join("\n");
  } finally {
    refreshBusy = false;
    button.disabled = false;
    button.classList.remove("syncing");
  }
}
$("refresh-data").onclick = () => {
  void refresh(true);
};
const dialog = $<HTMLDialogElement>("about-dialog");
$("about-button").onclick = $("source-button").onclick = () =>
  dialog.showModal();
$("close-dialog").onclick = () => dialog.close();
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  }
});
new ResizeObserver(() => map.invalidateSize()).observe($("map"));

async function loadBasemap() {
  const response = await fetch(`${import.meta.env.BASE_URL}data/campus.json`, {
    cache: "no-cache",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("底图读取失败");
  addCampusBase(await response.json());
}
function applyPublished(payload: SiteData) {
  if (
    payload?.schemaVersion !== 1 ||
    typeof payload.revision !== "string" ||
    !validDataset(payload.dataset)
  )
    throw new Error("站点数据格式无效");
  const nextCatalog = validateCatalog(payload.catalog);
  if (revision === payload.revision) return false;
  catalog = nextCatalog;
  locationData = payload.locations;
  revision = payload.revision;
  let next = payload.dataset;
  if (data && Date.parse(data.fetchedAt) > Date.parse(next.fetchedAt))
    next = data;
  try {
    const cached: unknown = JSON.parse(
      localStorage.getItem("nku-osm-cache-v1") ?? "null",
    );
    if (
      validDataset(cached) &&
      Date.parse(cached.fetchedAt) > Date.parse(next.fetchedAt)
    )
      next = cached;
    localStorage.setItem("nku-site-cache-v1", JSON.stringify(payload));
  } catch {
    /* Published data works without browser storage. */
  }
  useData(
    next,
    next === payload.dataset
      ? "已载入 OSM 快照与物候库 · 支持在线同步"
      : "已载入较新 OSM 缓存与物候库",
  );
  return true;
}
async function loadPublished() {
  const response = await fetch(
    `${import.meta.env.BASE_URL}data/site-data.json`,
    { cache: "no-cache", signal: AbortSignal.timeout(12000) },
  );
  if (!response.ok) throw new Error(`站点数据 HTTP ${response.status}`);
  return applyPublished(await response.json());
}
async function start() {
  const basePromise = loadBasemap();
  try {
    try {
      await loadPublished();
    } catch (error) {
      try {
        applyPublished(
          JSON.parse(localStorage.getItem("nku-site-cache-v1") ?? "null"),
        );
        $("data-status").textContent =
          "网络暂不可用 · 已载入浏览器中的站点缓存";
      } catch {
        throw error;
      }
    }
    fitCampus();
    if (data && Date.now() - Date.parse(data.fetchedAt) > 15 * 60_000)
      void refresh();
  } catch (error) {
    $("species-list").innerHTML =
      '<div class="empty-state"><b>植物数据读取失败</b><p>请刷新页面重试，或检查数据文件。</p></div>';
    $("data-status").textContent = "数据未加载 · " + String(error);
    $("selection-description").textContent = "暂时无法读取植物分布";
    $("season-summary").textContent =
      "物候数据暂不可用，请检查站点数据文件或稍后刷新。";
  }
  await basePromise.catch(() => {
    $("tile-warning").textContent =
      `校园简图未能读取，可切换到${streetConfig.name}。`;
    $("tile-warning").hidden = false;
  });
}
void start();
setInterval(() => {
  void refresh();
}, 15 * 60_000);
