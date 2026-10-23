import intersects from "@turf/boolean-intersects";
import pointOnFeature from "@turf/point-on-feature";
import pointToLineDistance from "@turf/point-to-line-distance";
import pointToPolygonDistance from "@turf/point-to-polygon-distance";
import distance from "@turf/distance";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  Point,
  Position,
} from "geojson";
import type { Dataset, SpeciesFeature } from "./data";

export interface LocationOverrides {
  schema_version: 1;
  overrides: Record<string, { text: string; note?: string }>;
}
export interface Landmark extends Feature {
  properties: { name: string; kind: "building" | "road" | "place" };
}
export interface LocationDescription {
  text: string;
  source: "automatic" | "manual" | "fallback";
  references: Array<{ osmId: string; name: string; distanceMeters: number }>;
}
export interface LocationData {
  schemaVersion: 1;
  overrides: LocationOverrides;
  landmarks: Landmark[];
  entries: Record<string, LocationDescription>;
  unusedOverrideIds: string[];
}
export const EMPTY_LOCATION_OVERRIDES: LocationOverrides = {
  schema_version: 1,
  overrides: {},
};

export function validateLocationOverrides(input: unknown): LocationOverrides {
  const value = input as LocationOverrides;
  const fail = (message: string): never => {
    throw new Error(`位置描述配置无效：${message}`);
  };
  if (
    !value ||
    value.schema_version !== 1 ||
    !value.overrides ||
    typeof value.overrides !== "object" ||
    Array.isArray(value.overrides)
  )
    fail("需要 schema_version: 1 和 overrides 对象");
  for (const [id, entry] of Object.entries(value.overrides)) {
    if (!/^(node|way|relation)\/[1-9]\d*$/.test(id))
      fail(`无效的 OSM 编号 ${id}`);
    if (
      !entry ||
      typeof entry.text !== "string" ||
      !entry.text.trim() ||
      entry.text.trim().length > 180
    )
      fail(`${id} 的 text 必须是 1—180 字的位置描述`);
    if (
      entry.note !== undefined &&
      (typeof entry.note !== "string" || entry.note.length > 500)
    )
      fail(`${id} 的 note 最多 500 字`);
    for (const key of Object.keys(entry))
      if (!["text", "note"].includes(key)) fail(`${id} 存在未知字段 ${key}`);
  }
  return value;
}

export function selectLandmarks(
  background: FeatureCollection,
  campus: Feature,
): Landmark[] {
  const result: Landmark[] = [];
  for (const f of background.features) {
    const t = f.properties ?? {};
    if (typeof t.name !== "string" || !t.name.trim() || !f.geometry) continue;
    const name = t.name.trim().replace(/^南开大学[·\s]*津南校区[·\s]*/, "");
    // Prefer recognisable campus destinations over shops, plant names, bare
    // A/B zones, bus-stop nodes, and duplicate generic sports-court names.
    if (
      /^[A-ZＡ-Ｚ]\s*区$/.test(name) ||
      /^(篮球场|排球场|网球场|足球场)$/.test(name)
    )
      continue;
    let kind: Landmark["properties"]["kind"] | undefined;
    if (t.highway && /LineString/.test(f.geometry.type)) kind = "road";
    else if (
      t.building ||
      /图书馆|学院|教学楼|实验楼|宿舍|公寓|食堂|体育馆|医院|活动中心|[楼堂]$/.test(
        name,
      )
    )
      kind = "building";
    else if (
      t.natural === "water" ||
      t.water ||
      t.entrance ||
      ["park", "garden", "pitch"].includes(t.leisure) ||
      /广场$/.test(name)
    )
      kind = "place";
    if (!kind) continue;
    try {
      if (!intersects(f, campus)) continue;
      result.push({
        type: "Feature",
        id: f.id,
        geometry: f.geometry,
        properties: { name, kind },
      });
    } catch {
      /* Malformed background geometry is not a location reference. */
    }
  }
  return result.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function parts(geometry: Geometry): Geometry[] {
  switch (geometry.type) {
    case "MultiPolygon":
      return geometry.coordinates.map((coordinates) => ({
        type: "Polygon",
        coordinates,
      }));
    case "MultiLineString":
      return geometry.coordinates.map((coordinates) => ({
        type: "LineString",
        coordinates,
      }));
    case "MultiPoint":
      return geometry.coordinates.map((coordinates) => ({
        type: "Point",
        coordinates,
      }));
    case "GeometryCollection":
      return geometry.geometries.flatMap(parts);
    default:
      return [geometry];
  }
}

function distanceTo(anchor: Feature<Point>, landmark: Landmark): number {
  const f = landmark;
  switch (f.geometry.type) {
    case "Point":
      return distance(anchor, f as Feature<Point>, { units: "meters" });
    case "LineString":
      return pointToLineDistance(anchor, f as Feature<GeoJSON.LineString>, {
        units: "meters",
      });
    case "Polygon":
    case "MultiPolygon":
      return Math.max(
        0,
        pointToPolygonDistance(
          anchor,
          f as Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
          { units: "meters" },
        ),
      );
    default:
      return Math.min(
        ...parts(f.geometry).map((geometry) =>
          distanceTo(anchor, { ...f, geometry }),
        ),
      );
  }
}

function campusArea(anchor: Position, campus: Feature): string {
  // Used only when no named reference is sufficiently close. This reports a
  // campus sector without inventing a building or using a distant landmark.
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const geometry of parts(campus.geometry)) {
    const coords =
      geometry.type === "Polygon" ? geometry.coordinates.flat() : [];
    for (const [x, y] of coords) {
      w = Math.min(w, x);
      s = Math.min(s, y);
      e = Math.max(e, x);
      n = Math.max(n, y);
    }
  }
  const dx = (anchor[0] - (w + e) / 2) / (e - w),
    dy = (anchor[1] - (s + n) / 2) / (n - s);
  const vertical = dy > 0.16 ? "北" : dy < -0.16 ? "南" : "";
  const horizontal = dx > 0.16 ? "东" : dx < -0.16 ? "西" : "";
  return vertical || horizontal ? `校区${horizontal}${vertical}侧` : "校区中部";
}

export function describeLocation(
  feature: SpeciesFeature,
  campus: Feature,
  landmarks: Landmark[],
  overrides: LocationOverrides = EMPTY_LOCATION_OVERRIDES,
): LocationDescription {
  const manual = overrides.overrides[feature.properties.osmId];
  if (manual)
    return { text: manual.text.trim(), source: "manual", references: [] };
  const descriptions: string[] = [],
    references: LocationDescription["references"] = [];
  for (const geometry of parts(feature.geometry)) {
    const anchor = pointOnFeature({
      type: "Feature",
      properties: {},
      geometry,
    });
    const ranked = landmarks
      .filter((f) => String(f.id) !== feature.properties.osmId)
      .flatMap((f) => {
        try {
          const metres = distanceTo(anchor, f);
          return Number.isFinite(metres) ? [{ f, metres }] : [];
        } catch {
          return [];
        }
      })
      .sort(
        (a, b) =>
          a.metres - b.metres || String(a.f.id).localeCompare(String(b.f.id)),
      );
    const place = ranked
      .filter((r) => r.f.properties.kind !== "road" && r.metres <= 200)
      .sort(
        (a, b) =>
          a.metres +
          (a.f.properties.kind === "building" ? 0 : 15) -
          (b.metres + (b.f.properties.kind === "building" ? 0 : 15)),
      )[0];
    const road = ranked.find(
      (r) => r.f.properties.kind === "road" && r.metres <= 90,
    );
    const chosen = [place, road].filter((r): r is NonNullable<typeof r> => !!r);
    const text = chosen.length
      ? chosen
          .map(
            (r) =>
              `${r.f.properties.name}${r.f.properties.kind === "road" ? "沿线" : "附近"}`,
          )
          .join("，")
      : `${campusArea(anchor.geometry.coordinates, campus)}（暂无邻近地标名称）`;
    if (!descriptions.includes(text)) descriptions.push(text);
    for (const r of chosen)
      if (!references.some((ref) => ref.osmId === String(r.f.id)))
        references.push({
          osmId: String(r.f.id),
          name: r.f.properties.name,
          distanceMeters: Math.round(r.metres),
        });
  }
  const text =
    descriptions.length > 1
      ? `多处分布：${descriptions.slice(0, 3).join("；")}${descriptions.length > 3 ? "等" : ""}`
      : (descriptions[0] ?? "校园内（暂无邻近地标资料）");
  return {
    text,
    source: references.length ? "automatic" : "fallback",
    references,
  };
}

export function buildLocations(
  dataset: Dataset,
  background: FeatureCollection,
  overrides: LocationOverrides,
): LocationData {
  const landmarks = selectLandmarks(background, dataset.campus);
  const entries = Object.fromEntries(
    dataset.features.map((f) => [
      f.properties.osmId,
      describeLocation(f, dataset.campus, landmarks, overrides),
    ]),
  );
  return {
    schemaVersion: 1,
    overrides,
    landmarks,
    entries,
    unusedOverrideIds: Object.keys(overrides.overrides)
      .filter((id) => !entries[id])
      .sort(),
  };
}
