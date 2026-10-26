import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { groupSpecies, type Dataset } from "../src/data.js";
import { validateCatalog } from "../src/phenology.js";
import { groupsForView, isDevMode, phenologyStats } from "../src/view.js";
import { basemapConfig } from "../src/basemap.js";

const catalog = validateCatalog(
  parse(await readFile("data/phenology.yaml", "utf8")),
);
const dataset: Dataset = JSON.parse(
  await readFile("tests/fixtures/stage1-species.json", "utf8"),
);
const groups = groupSpecies(dataset.features);

test("stage statistics distinguish active, out-of-season, missing, and excluded dates", () => {
  const autumn = phenologyStats(dataset.features, catalog, "2026-10-26", "autumn_leaf");
  const ginkgo = groups.find((g) => g.name === "银杏")!.count;
  assert.equal(autumn.matched, ginkgo);
  assert.equal(autumn.phases.coloring, ginkgo);
  assert.equal(autumn.unknown, autumn.total - ginkgo);
  const winter = phenologyStats(dataset.features, catalog, "2026-12-20", "autumn_leaf");
  assert.equal(winter.matched, 0);
  assert.equal(winter.outside, ginkgo);
  assert.equal(winter.unknown, autumn.unknown);
  const filtered = phenologyStats(dataset.features, catalog, "2026-10-26", "autumn_leaf", null, false);
  assert.equal(filtered.excluded, ginkgo);
  assert.equal(filtered.unknown, autumn.unknown);
  const selected = phenologyStats(dataset.features, catalog, "2026-11-05", "autumn_leaf", "银杏");
  assert.equal(selected.total, ginkgo);
  assert.equal(selected.phases.peak, ginkgo);
  assert.equal(selected.unknown, 0);
  const flowers = phenologyStats(dataset.features, catalog, "2026-03-16", "flowering");
  assert.equal(flowers.phases.bloom, groups.find((g) => g.name === "山桃")!.count);
  assert.equal(flowers.total, flowers.matched + flowers.outside + flowers.unknown + flowers.excluded);
});

test("a shared location is counted once even with duplicate records and mixed species stages", () => {
  const mixed = structuredClone(catalog);
  const peach = mixed.species.find((s) => s.display_name === "山桃")!;
  peach.phases = [{ ...mixed.species.find((s) => s.display_name === "银杏")!.phases[0], id: "peak" }];
  const feature = { ...dataset.features[0], properties: { ...dataset.features[0].properties, species: ["银杏", "山桃"] } };
  const stats = phenologyStats([feature, feature], mixed, "2026-10-26", "autumn_leaf");
  assert.equal(stats.total, 1);
  assert.equal(stats.matched, 1);
  assert.equal(stats.phases.peak, 1);
  assert.equal(stats.phases.coloring, 0);
});

test("season lists require intervals for the chosen category; distribution retains unknown dates", () => {
  assert.deepEqual(
    groupsForView(groups, catalog, "season", "autumn_leaf").map((g) => g.name),
    ["银杏"],
  );
  assert.deepEqual(
    groupsForView(groups, catalog, "season", "flowering").map((g) => g.name),
    ["山桃"],
  );
  assert.equal(
    groupsForView(groups, catalog, "distribution", "flowering").length,
    12,
  );
  assert.deepEqual(
    groupsForView(groups, undefined, "season", "autumn_leaf"),
    [],
  );
  assert.equal(
    groupsForView(groups, undefined, "distribution", "autumn_leaf"),
    groups,
  );
  const aliases = [
    { ...groups[0], name: "Ginkgo biloba" },
    { ...groups[0], name: "新增物种" },
  ];
  assert.deepEqual(
    groupsForView(aliases, catalog, "season", "autumn_leaf").map((g) => g.name),
    ["Ginkgo biloba"],
  );
});

test("reference toggle and verification apply to the seasonal species list", () => {
  assert.deepEqual(
    groupsForView(groups, catalog, "season", "autumn_leaf", false),
    [],
  );
  const verified = structuredClone(catalog);
  verified.species.find((s) => s.display_name === "银杏")!.verification =
    "verified";
  assert.deepEqual(
    groupsForView(groups, verified, "season", "autumn_leaf", false).map(
      (g) => g.name,
    ),
    ["银杏"],
  );
});

test("developer controls are opt-in only and survive other query parameters", () => {
  for (const search of [
    "",
    "?dev=0",
    "?dev=false",
    "?dev=true",
    "?view=season",
  ])
    assert.equal(isDevMode(search), false);
  assert.equal(isDevMode("?view=season&dev=1&species=银杏"), true);
});

test("basemap defaults to keyless HTTPS and optional TianDiTu pairs vector tiles with labels", () => {
  const street = basemapConfig();
  assert.equal(street.name, "街道底图");
  assert.equal(street.urls.length, 1);
  assert.match(
    street.urls[0],
    /^https:\/\/server\.arcgisonline\.com\/.*\/tile\/\{z\}\/\{y\}\/\{x\}$/,
  );
  assert.equal(basemapConfig("  ").name, street.name);
  const china = basemapConfig(" example&key ");
  assert.equal(china.name, "天地图");
  assert.equal(china.urls.length, 2);
  assert.match(china.urls[0], /\/vec_w\/wmts\?/);
  assert.match(china.urls[1], /\/cva_w\/wmts\?/);
  for (const url of china.urls) {
    assert.match(url, /TILEMATRIXSET=w/);
    assert.match(url, /TILEROW=\{y\}&TILECOL=\{x\}/);
    assert.match(url, /tk=example%26key$/);
  }
});
