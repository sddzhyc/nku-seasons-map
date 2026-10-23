import { readFile, writeFile, rename } from "node:fs/promises";
import { BBOX, convertOsm, ENDPOINTS, OVERPASS_QUERY } from "../src/data.js";
import { buildSiteData } from "./build-data.js";
import { BASEMAP_QUERY, buildCampusBasemap } from "./campus-base.js";

const inputIndex = process.argv.indexOf("--input");
const bootstrap = process.argv.includes("--bootstrap");
const basemap =
  bootstrap || inputIndex >= 0 || process.argv.includes("--with-basemap");
async function loadRaw(): Promise<{ raw: unknown; source: string }> {
  if (inputIndex >= 0)
    return {
      raw: JSON.parse(
        (await readFile(process.argv[inputIndex + 1], "utf8")).replace(
          /^\uFEFF/,
          "",
        ),
      ),
      source:
        "https://api.openstreetmap.org/api/0.6/map.json?bbox=" + BBOX.join(","),
    };
  if (bootstrap) {
    const source =
      "https://api.openstreetmap.org/api/0.6/map.json?bbox=" + BBOX.join(",");
    const r = await fetch(source, {
      signal: AbortSignal.timeout(45000),
      headers: { "User-Agent": "NkuSeasonsMap/0.4 (manual-campus-bootstrap)" },
    });
    if (!r.ok) throw new Error(`初始化失败 HTTP ${r.status}`);
    return { raw: await r.json(), source };
  }
  const failures: string[] = [];
  for (const source of ENDPOINTS) {
    try {
      const response = await fetch(source, {
        method: "POST",
        body: new URLSearchParams({
          data: basemap ? BASEMAP_QUERY : OVERPASS_QUERY,
        }),
        signal: AbortSignal.timeout(basemap ? 55000 : 35000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.json();
      convertOsm(raw, source);
      return { raw, source };
    } catch (error) {
      failures.push(`${source}: ${String(error)}`);
    }
  }
  throw new Error(
    "公共 OSM 查询不可用，已有快照保持不变。\n" + failures.join("\n"),
  );
}
async function sync() {
  const { raw, source } = await loadRaw();
  const dataset = convertOsm(raw, source);
  const outputs: Record<string, unknown> = { "species.json": dataset };
  if (basemap)
    outputs["campus.json"] = buildCampusBasemap(
      raw,
      dataset.campus,
      source,
      dataset.fetchedAt,
    );
  for (const [file, content] of Object.entries(outputs))
    await writeFile(`public/data/${file}.tmp`, JSON.stringify(content));
  for (const file of Object.keys(outputs))
    await rename(`public/data/${file}.tmp`, `public/data/${file}`);
  console.log(
    `已更新 ${dataset.features.length} 个 OSM 要素${basemap ? "与校园简图" : ""}，获取时间 ${dataset.fetchedAt}`,
  );
}
// Invalid YAML is always fatal, even when a network fallback is allowed.
await buildSiteData();
try {
  await sync();
} catch (error) {
  if (!process.argv.includes("--allow-stale")) throw error;
  console.warn(
    `::warning::OSM 同步失败；将使用最近有效快照。${String(error).replace(/\r?\n/g, " ")}`,
  );
}
console.log(await buildSiteData());
