import osmtogeojson from "osmtogeojson";
import intersects from "@turf/boolean-intersects";
import buffer from "@turf/buffer";
import difference from "@turf/difference";
import bboxClip from "@turf/bbox-clip";
import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
  BBox,
  Geometry,
  Position,
} from "geojson";
import { BBOX, CAMPUS_WAY } from "../src/data.js";
import type { CampusBasemap } from "../src/basemap.js";

const [west, south, east, north] = BBOX;
const queryBounds = `${south},${west},${north},${east}`;
// Keep the full campus species query; only the background query is extended.
// Filter before recursion to avoid downloading unrelated administrative/routes.
export const BASEMAP_QUERY = `[out:json][timeout:45];way(${CAMPUS_WAY});map_to_area->.campus;(way(${CAMPUS_WAY});nwr["species"](area.campus);${["building", "highway", "water", "waterway", "natural", "landuse", "leisure"].map((tag) => `nwr["${tag}"](${queryBounds});`).join("")}node["name"]["amenity"](${queryBounds});node["name"]["entrance"](${queryBounds}););out body;>;out skel qt;`;

const keptTags = [
  "name",
  "building",
  "highway",
  "water",
  "waterway",
  "natural",
  "landuse",
  "leisure",
  "amenity",
  "entrance",
];
const steps = [
  [180, 0.23],
  [360, 0.4],
  [600, 0.56],
  [900, 0.7],
] as const;

function geometryCentre(geometry: Geometry): Position {
  const extent = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(value: unknown) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      extent[0] = Math.min(extent[0], value[0]);
      extent[1] = Math.min(extent[1], value[1]);
      extent[2] = Math.max(extent[2], value[0]);
      extent[3] = Math.max(extent[3], value[1]);
    } else value.forEach(visit);
  }
  function walk(g: Geometry) {
    if (g.type === "GeometryCollection") g.geometries.forEach(walk);
    else visit(g.coordinates);
  }
  walk(geometry);
  return [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
}

function rectangle(bounds: BBox): Feature<Polygon> {
  const [w, s, e, n] = bounds;
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    },
  };
}

export function buildCampusBasemap(
  raw: unknown,
  campus: Feature,
  source: string,
  fetchedAt: string,
  bounds: BBox = [...BBOX],
): CampusBasemap {
  if (!["Polygon", "MultiPolygon"].includes(campus.geometry.type))
    throw new Error("校园边界必须是多边形");
  const area = rectangle(bounds);
  const full = osmtogeojson(raw as Parameters<typeof osmtogeojson>[0], {
    flatProperties: true,
  }) as FeatureCollection;
  const features: Feature[] = [];
  for (const f of full.features) {
    const tags = f.properties ?? {};
    if (
      !f.geometry ||
      tags.tainted ||
      !(
        tags.building ||
        tags.highway ||
        tags.water ||
        tags.waterway ||
        tags.natural ||
        tags.landuse ||
        tags.leisure ||
        (f.geometry.type === "Point" &&
          tags.name &&
          (tags.amenity || tags.entrance))
      )
    )
      continue;
    try {
      if (!intersects(f, area)) continue;
      // A long road/land-use polygon returned by OSM may extend far outside the
      // query. Bound its geometry and payload to the displayed neighbourhood.
      const clipped = [
        "LineString",
        "MultiLineString",
        "Polygon",
        "MultiPolygon",
      ].includes(f.geometry.type)
        ? bboxClip(f as Parameters<typeof bboxClip>[0], bounds)
        : f;
      if (!intersects(clipped, area)) continue;
      features.push({
        ...clipped,
        id: f.id,
        properties: Object.fromEntries(
          Object.entries(tags).filter(([key]) => keptTags.includes(key)),
        ),
      });
    } catch {
      // OSM map API can include incomplete relations intersecting the bbox.
      // Do not render malformed background geometry.
    }
  }
  if (
    !features.some((f) => f.properties?.building && intersects(f, campus)) ||
    !features.some((f) => f.properties?.highway && intersects(f, campus))
  )
    throw new Error("校园简图缺少校内建筑或道路，拒绝覆盖已有数据");
  if (!features.some((f) => !intersects(f, campus)))
    throw new Error("校园简图没有校外周边要素，拒绝覆盖已有周边数据");

  const fadeBands: FeatureCollection<
    Polygon | MultiPolygon,
    { fadeOpacity: number }
  > = { type: "FeatureCollection", features: [] };
  let inner = campus as Feature<Polygon | MultiPolygon>;
  for (const [metres, fadeOpacity] of steps) {
    const outer = buffer(campus, metres, { units: "meters", steps: 8 });
    if (!outer) throw new Error("无法计算周边淡化范围");
    const band = difference({
      type: "FeatureCollection",
      features: [outer, inner],
    });
    if (band) fadeBands.features.push({ ...band, properties: { fadeOpacity } });
    inner = outer;
  }
  const outermost = difference({
    type: "FeatureCollection",
    features: [area, inner],
  });
  if (outermost)
    fadeBands.features.push({
      ...outermost,
      properties: { fadeOpacity: 0.82 },
    });
  // Labels live above the background wash, so give them matching contrast.
  for (const f of features) {
    if (!f.properties?.name) continue;
    const centre: Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: geometryCentre(f.geometry) },
    };
    const band = fadeBands.features.find((b) => intersects(centre, b));
    f.properties.contextOpacity = band ? 1 - band.properties.fadeOpacity : 1;
  }
  return {
    type: "FeatureCollection",
    features,
    context: {
      schemaVersion: 1,
      source,
      fetchedAt,
      bounds: [...bounds],
      fadeBands,
    },
  };
}
