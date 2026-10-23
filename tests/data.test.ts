import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CAMPUS_WAY,
  convertOsm,
  filterSpecies,
  groupSpecies,
  splitSpecies,
  validDataset,
} from "../src/data.js";
import type { Dataset } from "../src/data.js";

function fixture() {
  return {
    elements: [
      { type: "node", id: 1, lat: 0, lon: 0 },
      { type: "node", id: 2, lat: 0, lon: 2 },
      { type: "node", id: 3, lat: 2, lon: 2 },
      { type: "node", id: 4, lat: 2, lon: 0 },
      {
        type: "way",
        id: CAMPUS_WAY,
        nodes: [1, 2, 3, 4, 1],
        tags: { amenity: "university", name: "测试校园" },
      },
      {
        type: "node",
        id: 5,
        lat: 1,
        lon: 1,
        tags: {
          natural: "tree",
          species: "银杏; 毛白杨;银杏",
          "species:en": "Ginkgo biloba",
        },
      },
      {
        type: "node",
        id: 6,
        lat: 3,
        lon: 3,
        tags: { natural: "tree", species: "校外树" },
      },
      { type: "node", id: 7, lat: 1, lon: -1 },
      { type: "node", id: 8, lat: 1, lon: 3 },
      {
        type: "way",
        id: 99,
        nodes: [7, 8],
        tags: { natural: "tree_row", species: "法桐" },
      },
    ],
  };
}

test("spatial selection includes intersecting tree rows and excludes off-campus trees", () => {
  const data = convertOsm(fixture(), "test");
  assert.deepEqual(data.features.map((f) => f.properties.osmId).sort(), [
    "node/5",
    "way/99",
  ]);
  assert.deepEqual(
    groupSpecies(data.features)
      .map((g) => [g.name, g.count])
      .sort(),
    [
      ["毛白杨", 1],
      ["法桐", 1],
      ["银杏", 1],
    ].sort(),
  );
});

test("multi-value species are trimmed/deduplicated and searchable using aliases in OSM tags", () => {
  assert.deepEqual(splitSpecies("银杏; 毛白杨;银杏; "), ["银杏", "毛白杨"]);
  const groups = groupSpecies(convertOsm(fixture(), "test").features);
  assert.deepEqual(
    filterSpecies(groups, " ginkgo ")
      .map((g) => g.name)
      .sort(),
    ["毛白杨", "银杏"].sort(),
  );
  assert.equal(filterSpecies(groups, "不存在").length, 0);
});

test("incomplete upstream responses cannot replace a valid snapshot", () => {
  assert.throws(() => convertOsm({ elements: [] }, "test"), /校园边界缺失/);
  assert.throws(() => convertOsm({ ...fixture(), remark: 'runtime error: query timed out' }, 'test'), /不完整结果/);
  assert.equal(validDataset({ schemaVersion: 1, features: [] }), false);
});

test("archived first-stage snapshot preserves requested geometry and relation de-duplication", async () => {
  const data = JSON.parse(
    await readFile("tests/fixtures/stage1-species.json", "utf8"),
  ) as Dataset;
  assert.equal(validDataset(data), true);
  const target = data.features.find(
    (f) => f.properties.osmId === "way/1448582302",
  );
  assert.ok(target);
  assert.equal(target.geometry.type, "Polygon");
  assert.equal(target.properties.tags.species, "银杏");
  assert.equal(target.properties.tags.leaf_cycle, "deciduous");
  assert.equal(
    groupSpecies(data.features).find((g) => g.name === "银杏")?.count,
    10,
  );
  const relation = data.features.find(
    (f) => f.properties.osmId === "relation/20356937",
  );
  assert.equal(relation?.geometry.type, "MultiPolygon");
  assert.ok(
    !data.features.some((f) => f.properties.osmId === "way/1449405222"),
    "member way is represented once by its parent relation",
  );
  assert.equal(
    new Set(data.features.map((f) => f.properties.osmId)).size,
    data.features.length,
  );
});
