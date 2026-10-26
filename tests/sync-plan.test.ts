import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareSync } from "../scripts/sync-plan.js";
import { overpassUrl, CAMPUS_WAY } from "../src/data.js";

const raw = {
  elements: [
    { type: "node", id: 1, lon: 117.33, lat: 38.985 },
    { type: "node", id: 2, lon: 117.332, lat: 38.985 },
    { type: "node", id: 3, lon: 117.332, lat: 38.987 },
    { type: "node", id: 4, lon: 117.33, lat: 38.987 },
    {
      type: "way",
      id: CAMPUS_WAY,
      nodes: [1, 2, 3, 4, 1],
      tags: { amenity: "university" },
    },
    {
      type: "node",
      id: 5,
      lon: 117.331,
      lat: 38.986,
      tags: { natural: "tree", species: "火炬树" },
    },
  ],
};
test("background query failure preserves successful plant updates, rather than discarding new species", async () => {
  const requests: boolean[] = [],
    warnings: string[] = [];
  const result = await prepareSync(
    async (background) => {
      requests.push(background);
      if (background) throw Error("HTTP 502");
      return { raw, source: "fixture" };
    },
    { basemap: true, strictBasemap: false },
    (m) => warnings.push(m),
  );
  assert.deepEqual(requests, [false, true]);
  assert.deepEqual(result.dataset.features[0].properties.species, ["火炬树"]);
  assert.equal(result.outputs["campus.json"], undefined);
  assert.equal(result.outputs["species.json"], result.dataset);
  assert.match(warnings[0], /植物数据已更新/);
});
test("failed plant query remains fatal, and strict imports reject missing background", async () => {
  await assert.rejects(
    prepareSync(
      async () => {
        throw Error("HTTP 406");
      },
      { basemap: true, strictBasemap: false },
    ),
    /406/,
  );
  await assert.rejects(
    prepareSync(async () => ({ raw, source: "fixture" }), {
      basemap: true,
      strictBasemap: true,
    }),
    /缺少校内建筑或道路/,
  );
});
test("GET transport round trips the actual Overpass query including Chinese species and separators", () => {
  const query =
    '[out:json];nwr["species"="火炬树;银杏"](38.98,117.33,38.99,117.34);out body;';
  const url = new URL(
    overpassUrl("https://overpass-api.de/api/interpreter", query),
  );
  assert.equal(url.searchParams.get("data"), query);
  assert.equal(url.pathname, "/api/interpreter");
});
