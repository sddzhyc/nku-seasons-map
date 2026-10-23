import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  copyFile,
  mkdtemp,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, sep } from "node:path";
import type { Feature, FeatureCollection, Polygon, Point } from "geojson";
import type { SpeciesFeature } from "../src/data.js";
import {
  describeLocation,
  selectLandmarks,
  validateLocationOverrides,
  EMPTY_LOCATION_OVERRIDES,
} from "../src/locations.js";
import { buildSiteData } from "../scripts/build-data.js";

const square = (
  id: string,
  name: string,
  x: number,
  y: number,
  size = 0.002,
): Feature<Polygon> => ({
  type: "Feature",
  id,
  properties: { building: "yes", name },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
      ],
    ],
  },
});
const campus = square("way/1", "校区", 117.33, 38.98, 0.025);
const plant = (x = 117.3319, y = 38.986): SpeciesFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [x, y] },
  properties: {
    osmId: "node/123",
    species: ["银杏"],
    tags: { species: "银杏" },
  },
});
const background: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    square("way/2", "西教学楼", 117.332, 38.985, 0.002),
    square("way/3", "东教学楼", 117.347, 38.985, 0.002),
    square("way/4", "校外大楼", 117.31, 38.985, 0.002),
    square("way/5", "A区", 117.3318, 38.985, 0.0002),
    {
      type: "Feature",
      id: "way/6",
      properties: { name: "求知路", highway: "residential" },
      geometry: {
        type: "LineString",
        coordinates: [
          [117.3318, 38.984],
          [117.3318, 38.988],
        ],
      },
    },
    {
      type: "Feature",
      id: "node/7",
      properties: { name: "某奶茶店", amenity: "cafe" },
      geometry: { type: "Point", coordinates: [117.3319, 38.986] },
    },
  ],
};
const landmarks = selectLandmarks(background, campus);

test("locations use building footprint and nearby road geometry, excluding off-campus places and ambiguous shops/zones", () => {
  assert.deepEqual(
    landmarks.map((f) => f.id),
    ["way/2", "way/3", "way/6"],
  );
  const result = describeLocation(plant(), campus, landmarks);
  assert.equal(result.source, "automatic");
  assert.match(result.text, /西教学楼附近/);
  assert.match(result.text, /求知路沿线/);
  assert.ok(
    result.references.find((r) => r.name === "西教学楼")!.distanceMeters < 15,
  );
  // The building centroid is > 90 m away; its west edge is only ~9 m away.
  assert.ok(!result.text.includes("A区"));
});

test("separated polygons get separate location references instead of a centroid in the gap", () => {
  const first = square("way/10", "", 117.3317, 38.9858, 0.0002);
  const second = square("way/11", "", 117.3466, 38.9858, 0.0002);
  const f: SpeciesFeature = {
    ...plant(),
    geometry: {
      type: "MultiPolygon",
      coordinates: [first.geometry.coordinates, second.geometry.coordinates],
    },
  };
  const result = describeLocation(f, campus, landmarks);
  assert.match(result.text, /多处分布/);
  assert.match(result.text, /西教学楼附近/);
  assert.match(result.text, /东教学楼附近/);
});

test("distant references do not produce a misleading nearby address", () => {
  const result = describeLocation(plant(117.35, 39.002), campus, landmarks);
  assert.equal(result.source, "fallback");
  assert.match(result.text, /校区东北侧/);
  assert.ok(!result.text.includes("教学楼附近"));
});

test("manual descriptions win after geometry changes and validation rejects malformed entries", () => {
  const overrides = validateLocationOverrides({
    schema_version: 1,
    overrides: { "node/123": { text: "  秀山堂南侧步道  ", note: "现场确认" } },
  });
  for (const f of [plant(), plant(117.35, 39.002)])
    assert.deepEqual(describeLocation(f, campus, landmarks, overrides), {
      text: "秀山堂南侧步道",
      source: "manual",
      references: [],
    });
  assert.equal(
    describeLocation(plant(), campus, landmarks, EMPTY_LOCATION_OVERRIDES)
      .source,
    "automatic",
  );
  for (const entry of [
    { schema_version: 1, overrides: { "123": { text: "某楼旁" } } },
    { schema_version: 1, overrides: { "node/123": { text: "  " } } },
    {
      schema_version: 1,
      overrides: { "node/123": { text: "某楼旁", typo: "bad" } },
    },
  ])
    assert.throws(() => validateLocationOverrides(entry), /位置描述配置无效/);
});

test("YAML edits change published revision, survive rebuilds, and invalid edits preserve the last valid bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "nku-location-test-"));
  try {
    await mkdir(join(root, "data"));
    await mkdir(join(root, "public/data"), { recursive: true });
    for (const file of [
      "data/phenology.yaml",
      "data/locations.yaml",
      "public/data/species.json",
      "public/data/campus.json",
    ])
      await copyFile(file, join(root, file));
    const original = await buildSiteData(root);
    const id = "way/1448582302";
    const yaml = `schema_version: 1\noverrides:\n  ${id}:\n    text: "开发者确认的位置描述"\n  way/999999999999:\n    text: "暂未匹配的旧要素"\n`;
    await writeFile(join(root, "data/locations.yaml"), yaml);
    const edited = await buildSiteData(root);
    assert.notEqual(edited.revision, original.revision);
    assert.equal((await buildSiteData(root)).revision, edited.revision);
    const bundle = JSON.parse(
      await readFile(join(root, "public/data/site-data.json"), "utf8"),
    );
    assert.equal(bundle.locations.entries[id].text, "开发者确认的位置描述");
    assert.equal(bundle.locations.entries[id].source, "manual");
    assert.deepEqual(bundle.locations.unusedOverrideIds, ["way/999999999999"]);
    assert.equal(
      await readFile(join(root, "data/locations.yaml"), "utf8"),
      yaml,
    );
    const before = await readFile(
      join(root, "public/data/site-data.json"),
      "utf8",
    );
    await writeFile(
      join(root, "data/locations.yaml"),
      'schema_version: 1\noverrides:\n  bad: {text: "某楼"}\n',
    );
    await assert.rejects(buildSiteData(root), /位置描述配置无效/);
    assert.equal(
      await readFile(join(root, "public/data/site-data.json"), "utf8"),
      before,
    );
  } finally {
    const inside = relative(resolve(tmpdir()), resolve(root));
    assert.ok(inside.startsWith("nku-location-test-") && !inside.includes(sep));
    await rm(root, { recursive: true, force: true });
  }
});
