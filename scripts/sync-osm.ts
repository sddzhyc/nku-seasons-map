import { readFile, writeFile, rename, appendFile } from "node:fs/promises";
import { BBOX, OVERPASS_QUERY } from "../src/data.js";
import { buildSiteData } from "./build-data.js";
import { BASEMAP_QUERY } from "./campus-base.js";
import { prepareSync } from "./sync-plan.js";
import { queryOverpass, type OsmAttempt } from "./overpass-client.js";

const attempts: Array<OsmAttempt & { query: "plants" | "background" }> = [];

const inputIndex = process.argv.indexOf("--input");
const bootstrap = process.argv.includes("--bootstrap");
const basemap =
  bootstrap || inputIndex >= 0 || process.argv.includes("--with-basemap");
async function loadRaw(
  background: boolean,
): Promise<{ raw: unknown; source: string }> {
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
  return queryOverpass(background ? BASEMAP_QUERY : OVERPASS_QUERY, {
    timeoutMs: background ? 75_000 : 50_000,
    report: (attempt) => {
      const record = {
        query: background ? ("background" as const) : ("plants" as const),
        ...attempt,
      };
      attempts.push(record);
      console.log("[OSM request] " + JSON.stringify(record));
    },
  });
}
async function sync() {
  const { dataset, outputs } = await prepareSync(loadRaw, {
    basemap,
    strictBasemap: bootstrap || inputIndex >= 0,
  });
  for (const [file, content] of Object.entries(outputs))
    await writeFile(`public/data/${file}.tmp`, JSON.stringify(content));
  for (const file of Object.keys(outputs))
    await rename(`public/data/${file}.tmp`, `public/data/${file}`);
  console.log(
    `已更新 ${dataset.features.length} 个 OSM 要素${outputs["campus.json"] ? "与校园简图" : basemap ? "（周边简图保留旧版）" : ""}，获取时间 ${dataset.fetchedAt}`,
  );
}
// Invalid YAML is always fatal, even when a network fallback is allowed.
await buildSiteData();
let outcome = "failed";
try {
  await sync();
  outcome = "updated";
} catch (error) {
  if (!process.argv.includes("--allow-stale")) throw error;
  outcome = "stale";
  console.warn(
    `::warning::OSM 同步失败；将使用最近有效快照。${String(error).replace(/\r?\n/g, " ")}`,
  );
} finally {
  if (process.env.GITHUB_STEP_SUMMARY) {
    const snapshot = JSON.parse(
      await readFile("public/data/species.json", "utf8"),
    );
    const lines = [
      "## OSM 数据同步",
      `- 本次结果：**${outcome}**（updated=成功获取，stale=沿用旧版，failed=失败）`,
      `- 植物快照：${snapshot.features.length} 处，实际获取时间 ${snapshot.fetchedAt}`,
      `- 数据来源：${snapshot.source}`,
      "",
      "| 查询 | 轮次 | 服务 | HTTP | 结果 | 用时 |",
      "| --- | --- | --- | --- | --- | --- |",
      ...attempts.map(
        (a) =>
          `| ${a.query} | ${a.round} | ${new URL(a.endpoint).hostname} | ${a.status ?? "network/timeout"} | ${a.outcome} | ${(a.elapsedMs / 1000).toFixed(1)}s |`,
      ),
      "",
    ];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }
}
console.log(await buildSiteData());
