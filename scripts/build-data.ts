import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { validDataset } from "../src/data.js";
import { buildIndex, validateCatalog } from "../src/phenology.js";
import { buildLocations, validateLocationOverrides } from "../src/locations.js";

export async function buildSiteData(root = process.cwd()) {
  const catalog = validateCatalog(
    parse(await readFile(resolve(root, "data/phenology.yaml"), "utf8"), {
      maxAliasCount: 20,
      uniqueKeys: true,
    }),
  );
  const dataset = JSON.parse(
    await readFile(resolve(root, "public/data/species.json"), "utf8"),
  );
  if (!validDataset(dataset)) throw new Error("物种快照无效，拒绝生成数据");
  const overrides = validateLocationOverrides(
    parse(await readFile(resolve(root, "data/locations.yaml"), "utf8"), {
      maxAliasCount: 20,
      uniqueKeys: true,
    }),
  );
  const background = JSON.parse(
    await readFile(resolve(root, "public/data/campus.json"), "utf8"),
  );
  const locations = buildLocations(dataset, background, overrides);
  const index = buildIndex(dataset, catalog);
  const revision = createHash("sha256")
    .update(JSON.stringify({ dataset, catalog, locations }))
    .digest("hex")
    .slice(0, 16);
  const outputs = {
    "phenology.json": catalog,
    "species-index.json": { schemaVersion: 1, revision, species: index },
    "locations.json": locations,
    "site-data.json": {
      schemaVersion: 1,
      revision,
      dataset,
      catalog,
      index,
      locations,
    },
  };
  await mkdir(resolve(root, "public/data"), { recursive: true });
  // Validate everything before writes. The browser reads one atomically replaced
  // bundle, so it cannot combine an old index with a new OSM snapshot or YAML.
  for (const [file, content] of Object.entries(outputs)) {
    const target = resolve(root, "public/data", file);
    await writeFile(`${target}.tmp`, JSON.stringify(content, null, 2) + "\n");
    await rename(`${target}.tmp`, target);
  }
  return {
    revision,
    species: index.length,
    features: dataset.features.length,
    configured: catalog.species.filter((s) => s.phases.length).length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  console.log(await buildSiteData());
