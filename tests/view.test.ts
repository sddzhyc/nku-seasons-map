import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { groupSpecies, type Dataset } from "../src/data.js";
import { validateCatalog } from "../src/phenology.js";
import { groupsForView, isDevMode } from "../src/view.js";
import { basemapConfig } from "../src/basemap.js";

const catalog = validateCatalog(
  parse(await readFile("data/phenology.yaml", "utf8")),
);
const dataset: Dataset = JSON.parse(
  await readFile("tests/fixtures/stage1-species.json", "utf8"),
);
const groups = groupSpecies(dataset.features);

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
