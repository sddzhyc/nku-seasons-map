import { convertOsm } from "../src/data.js";
import { buildCampusBasemap } from "./campus-base.js";

export type OsmLoader = (
  background: boolean,
) => Promise<{ raw: unknown; source: string }>;

// Fresh plant data must not depend on the much larger background query.
export async function prepareSync(
  load: OsmLoader,
  options: { basemap: boolean; strictBasemap: boolean },
  warn: (message: string) => void = console.warn,
) {
  const { raw, source } = await load(false);
  const dataset = convertOsm(raw, source);
  const outputs: Record<string, unknown> = { "species.json": dataset };
  if (options.basemap) {
    try {
      const background = await load(true);
      outputs["campus.json"] = buildCampusBasemap(
        background.raw,
        dataset.campus,
        background.source,
        new Date().toISOString(),
      );
    } catch (error) {
      if (options.strictBasemap) throw error;
      warn(
        `::warning::植物数据已更新；周边简图查询失败，保留已有简图。${String(error).replace(/\r?\n/g, " ")}`,
      );
    }
  }
  return { dataset, outputs };
}
