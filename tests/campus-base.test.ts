import { test } from "node:test";
import assert from "node:assert/strict";
import intersects from "@turf/boolean-intersects";
import type { Feature, Point } from "geojson";
import { BASEMAP_QUERY, buildCampusBasemap } from "../scripts/campus-base.js";
import { BBOX, CAMPUS_WAY, convertOsm } from "../src/data.js";

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
      type: "way",
      id: 5,
      nodes: [1, 2, 3, 4, 1],
      tags: { building: "yes", name: "校内建筑" },
    },
    {
      type: "node",
      id: 6,
      lon: 117.331,
      lat: 38.986,
      tags: { species: "银杏" },
    },
    {
      type: "node",
      id: 7,
      lon: 117.333,
      lat: 38.986,
      tags: { species: "校外植物", amenity: "cafe", name: "周边咖啡店" },
    },
    {
      type: "node",
      id: 8,
      lon: 117.344,
      lat: 38.986,
      tags: { amenity: "cafe", name: "远处咖啡店" },
    },
    { type: "node", id: 9, lon: 117.4, lat: 38.986 },
    {
      type: "way",
      id: 10,
      nodes: [6, 7, 8, 9],
      tags: { highway: "secondary", name: "跨校界道路" },
    },
  ],
};
const campus = convertOsm(raw, "fixture").campus;
const build = () =>
  buildCampusBasemap(raw, campus, "fixture", "2026-10-23T00:00:00Z");
const point = (lon: number, lat: number): Feature<Point> => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Point", coordinates: [lon, lat] },
});

test("background keeps neighbouring places and clips long roads while plant selection stays on campus", () => {
  const base = build();
  assert.ok(base.features.some((f) => f.id === "node/7"));
  assert.ok(base.features.some((f) => f.id === "node/8"));
  const road = base.features.find((f) => f.id === "way/10")!;
  assert.equal(road.geometry.type, "LineString");
  if (road.geometry.type === "LineString") {
    assert.equal(road.geometry.coordinates.at(-1)![0], BBOX[2]);
    assert.equal(road.geometry.coordinates[0][0], 117.331);
  }
  assert.deepEqual(
    convertOsm(raw, "fixture").features.map((f) => f.properties.osmId),
    ["node/6"],
  );
});

test("geographic fading leaves campus untouched and reduces contrast farther from its real boundary", () => {
  const base = build();
  const bands = base.context!.fadeBands.features;
  assert.equal(
    bands.some((b) => intersects(point(117.331, 38.986), b)),
    false,
  );
  const near = bands.find((b) => intersects(point(117.333, 38.986), b))!;
  const far = bands.find((b) => intersects(point(117.344, 38.986), b))!;
  assert.ok(near.properties.fadeOpacity < far.properties.fadeOpacity);
  assert.ok(bands.every((b) => !intersects(point(117.331, 38.986), b)));
  const opacity = (name: string) =>
    Number(
      base.features.find((f) => f.properties?.name === name)!.properties!
        .contextOpacity,
    );
  assert.equal(opacity("校内建筑"), 1);
  assert.ok(opacity("周边咖啡店") > opacity("远处咖啡店"));
  assert.ok(opacity("远处咖啡店") > 0);
});

test("scheduled sync requests background beyond campus and refuses campus-only replacement", () => {
  assert.ok(
    BASEMAP_QUERY.includes(`${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}`),
  );
  assert.ok(BASEMAP_QUERY.includes('nwr["species"](area.campus)'));
  const old = structuredClone(raw);
  old.elements = old.elements.filter((e) => ![7, 8, 9, 10].includes(e.id));
  old.elements.push({
    type: "way",
    id: 11,
    nodes: [1, 3],
    tags: { highway: "footway", name: "校内小路" },
  });
  assert.throws(
    () => buildCampusBasemap(old, campus, "fixture", "2026-10-23T00:00:00Z"),
    /没有校外周边要素/,
  );
});
