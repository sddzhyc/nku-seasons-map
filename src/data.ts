import osmtogeojson from "osmtogeojson";
import booleanIntersects from "@turf/boolean-intersects";
import type { Feature, FeatureCollection, Geometry } from "geojson";

export const CAMPUS_WAY = 476603067;
export const CENTER: [number, number] = [38.988622, 117.333825];
// Basemap context extends roughly one kilometre beyond each side of campus.
// Plant selection is still constrained by the actual OSM campus polygon.
export const BBOX = [117.314, 38.971, 117.366, 39.006] as const;
export const OVERPASS_QUERY = `[out:json][timeout:25];way(${CAMPUS_WAY});map_to_area->.campus;(nwr["species"](area.campus);way(${CAMPUS_WAY}););out body;>;out skel qt;`;
export const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export function overpassUrl(endpoint: string, query: string): string {
  const url = new URL(endpoint);
  url.searchParams.set("data", query);
  return url.href;
}

export interface SpeciesFeature extends Feature {
  properties: {
    osmId: string;
    species: string[];
    tags: Record<string, string>;
  };
}
export interface Dataset {
  schemaVersion: 1;
  fetchedAt: string;
  source: string;
  osmTimestamp?: string;
  campus: Feature;
  features: SpeciesFeature[];
}
export interface SpeciesGroup {
  name: string;
  count: number;
  features: SpeciesFeature[];
}

// Semicolons are OSM's multi-value delimiter. Keep original species strings in tags.
export function splitSpecies(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function plainTags(feature: Feature): Record<string, string> {
  const p = feature.properties ?? {};
  return (p.tags ?? p) as Record<string, string>;
}

export function convertOsm(
  raw: unknown,
  source: string,
  fetchedAt = new Date().toISOString(),
): Dataset {
  if ((raw as { remark?: string })?.remark)
    throw new Error("OSM 查询报告错误或返回不完整结果，保留上次数据。");
  const collection = osmtogeojson(raw as Parameters<typeof osmtogeojson>[0], {
    flatProperties: false,
  }) as FeatureCollection;
  const campus = collection.features.find(
    (f) => String(f.id) === `way/${CAMPUS_WAY}`,
  );
  if (
    !campus ||
    campus.properties?.tainted ||
    !["Polygon", "MultiPolygon"].includes(campus.geometry?.type)
  )
    throw new Error("校园边界缺失，保留上一次有效数据。");
  const tagged = collection.features.filter((f) => plainTags(f).species);
  if (tagged.some((f) => f.properties?.tainted))
    throw new Error("树种几何不完整，保留上一次有效数据。");
  const features: SpeciesFeature[] = tagged
    .filter((f) => f.geometry && booleanIntersects(f, campus))
    .map((f) => ({
      type: "Feature",
      id: f.id,
      geometry: f.geometry,
      properties: {
        osmId: String(f.id),
        species: splitSpecies(plainTags(f).species),
        tags: plainTags(f),
      },
    }));
  if (!features.length)
    throw new Error("查询没有返回校园树种要素，保留上一次有效数据。");
  return {
    schemaVersion: 1,
    fetchedAt,
    source,
    osmTimestamp: (raw as { osm3s?: { timestamp_osm_base?: string } }).osm3s
      ?.timestamp_osm_base,
    campus: { ...campus, properties: { name: plainTags(campus).name } },
    features,
  };
}

export function groupSpecies(features: SpeciesFeature[]): SpeciesGroup[] {
  const groups = new Map<string, SpeciesFeature[]>();
  for (const feature of features)
    for (const name of feature.properties.species) {
      const group = groups.get(name) ?? [];
      group.push(feature);
      groups.set(name, group);
    }
  return [...groups]
    .map(([name, entries]) => ({
      name,
      count: entries.length,
      features: entries,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

export function filterSpecies(
  groups: SpeciesGroup[],
  query: string,
): SpeciesGroup[] {
  const text = query.trim().toLocaleLowerCase();
  return groups.filter(
    (g) =>
      g.name.toLocaleLowerCase().includes(text) ||
      g.features.some((f) =>
        Object.entries(f.properties.tags).some(
          ([key, value]) =>
            /^(species|genus|name)(:|$)/.test(key) &&
            value.toLocaleLowerCase().includes(text),
        ),
      ),
  );
}

export function validDataset(value: unknown): value is Dataset {
  const d = value as Dataset | undefined;
  const validGeometry = (geometry: Geometry | undefined) =>
    !!geometry &&
    [
      "Point",
      "MultiPoint",
      "LineString",
      "MultiLineString",
      "Polygon",
      "MultiPolygon",
    ].includes(geometry.type);
  return (
    !!d &&
    d.schemaVersion === 1 &&
    Number.isFinite(Date.parse(d.fetchedAt)) &&
    !!d.campus &&
    ["Polygon", "MultiPolygon"].includes(d.campus.geometry?.type) &&
    Array.isArray(d.features) &&
    d.features.length > 0 &&
    d.features.every(
      (f) =>
        validGeometry(f.geometry) &&
        /^(node|way|relation)\/\d+$/.test(f.properties?.osmId) &&
        Array.isArray(f.properties.species) &&
        f.properties.species.every((s) => typeof s === "string") &&
        !!f.properties.tags,
    )
  );
}

export const palette = [
  "#c79925",
  "#b96c43",
  "#6d8752",
  "#a99b39",
  "#b15f76",
  "#8b9265",
  "#b88045",
  "#8b7357",
  "#879555",
  "#af7780",
  "#a78659",
  "#909b72",
];
export function speciesColor(name: string, groups: SpeciesGroup[]): string {
  const known: Record<string, string> = {
    银杏: "#c79925",
    山桃: "#bb795c",
    毛白杨: "#7a8b56",
    法桐: "#b89445",
    柳树: "#819263",
  };
  return (
    known[name] ??
    palette[
      Math.max(
        0,
        groups.findIndex((g) => g.name === name),
      ) % palette.length
    ]
  );
}
