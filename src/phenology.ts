import type { Dataset, SpeciesFeature } from "./data";
import type { LocationData } from "./locations";

export type Category = "autumn_leaf" | "flowering";
export type Verification = "reference" | "verified";
export interface Phase {
  id: string;
  category: Category;
  start: string;
  end: string;
  label: string;
  description: string;
}
export interface SpeciesRecord {
  id: string;
  display_name: string;
  osm_species_values: string[];
  verification: Verification;
  source_ids: string[];
  note: string;
  phases: Phase[];
}
export interface Source {
  id: string;
  title: string;
  url: string;
  scope: string;
}
export interface Catalog {
  schema_version: 1;
  timezone: "Asia/Shanghai";
  updated_at: string;
  disclaimer: string;
  sources: Source[];
  species: SpeciesRecord[];
}
export interface Match {
  record: SpeciesRecord;
  phase: Phase;
}
export const PHASES = {
  autumn_leaf: [
    { id: "coloring", label: "初染", color: "#95a759" },
    { id: "peak", label: "叶色正浓", color: "#d09a26" },
    { id: "falling", label: "开始落叶", color: "#aa7155" },
  ],
  flowering: [
    { id: "budding", label: "初绽", color: "#c59aab" },
    { id: "bloom", label: "盛开", color: "#bc5f82" },
    { id: "fading", label: "落花", color: "#9c879a" },
  ],
} as const;
export function chinaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join("-");
}
export function validMonthDay(value: string): boolean {
  if (!/^\d{2}-\d{2}$/.test(value)) return false;
  const [month, day] = value.split("-").map(Number);
  const d = new Date(Date.UTC(2000, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !validMonthDay(value.slice(5)))
    return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
// February 29 is a valid annual boundary. In non-leap years it is never a
// selectable date; surrounding dates compare naturally without shifting boundaries.
export function inAnnualRange(
  monthDay: string,
  start: string,
  end: string,
): boolean {
  return start <= end
    ? monthDay >= start && monthDay <= end
    : monthDay >= start || monthDay <= end;
}
const normalize = (s: string) =>
  s.trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function recordFor(
  name: string,
  catalog: Catalog,
): SpeciesRecord | undefined {
  return catalog.species.find((s) =>
    s.osm_species_values.some((value) => normalize(value) === normalize(name)),
  );
}
export function phaseFor(
  name: string,
  date: string,
  category: Category,
  catalog: Catalog,
  includeReferences = true,
): Match | undefined {
  const record = recordFor(name, catalog);
  if (
    !validDate(date) ||
    !record ||
    (!includeReferences && record.verification !== "verified")
  )
    return;
  const phase = record.phases.find(
    (p) =>
      p.category === category && inAnnualRange(date.slice(5), p.start, p.end),
  );
  return phase ? { record, phase } : undefined;
}
export function matchesFor(
  feature: SpeciesFeature,
  date: string,
  category: Category,
  catalog: Catalog,
  includeReferences = true,
): Match[] {
  return feature.properties.species
    .map((name) => phaseFor(name, date, category, catalog, includeReferences))
    .filter((m): m is Match => !!m);
}
export function phaseColor(category: Category, id: string): string {
  return PHASES[category].find((p) => p.id === id)?.color ?? "#8b9982";
}

export function validateCatalog(input: unknown): Catalog {
  const c = input as Catalog;
  const fail = (message: string): never => {
    throw new Error(`物候库校验失败：${message}`);
  };
  if (
    !c ||
    c.schema_version !== 1 ||
    c.timezone !== "Asia/Shanghai" ||
    !validDate(c.updated_at) ||
    typeof c.disclaimer !== "string"
  )
    fail("版本、时区或更新时间无效");
  if (!Array.isArray(c.sources) || !Array.isArray(c.species))
    fail("sources/species 必须是列表");
  const sourceIds = new Set<string>();
  for (const s of c.sources) {
    if (
      !s ||
      typeof s.id !== "string" ||
      !s.id ||
      sourceIds.has(s.id) ||
      typeof s.title !== "string" ||
      typeof s.scope !== "string" ||
      typeof s.url !== "string" ||
      !/^https:\/\//.test(s.url)
    )
      fail("来源必须有唯一 ID、标题、范围和 HTTPS 链接");
    sourceIds.add(s.id);
  }
  const aliases = new Set<string>();
  const ids = new Set<string>();
  const days: string[] = [];
  for (let i = 0; i < 366; i++) {
    const d = new Date(Date.UTC(2000, 0, i + 1));
    days.push(d.toISOString().slice(5, 10));
  }
  for (const s of c.species) {
    if (
      !s ||
      typeof s.id !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(s.id) ||
      ids.has(s.id) ||
      typeof s.display_name !== "string" ||
      !s.display_name ||
      !["reference", "verified"].includes(s.verification) ||
      typeof s.note !== "string"
    )
      fail("物种 ID、名称或核实状态无效");
    ids.add(s.id);
    if (
      !Array.isArray(s.osm_species_values) ||
      !s.osm_species_values.length ||
      !Array.isArray(s.phases) ||
      !Array.isArray(s.source_ids)
    )
      fail(`${s.id} 别名、来源或区间列表无效`);
    if (
      s.phases.length &&
      (!s.source_ids.length || s.source_ids.some((id) => !sourceIds.has(id)))
    )
      fail(`${s.id} 物候区间必须关联有效来源`);
    for (const alias of s.osm_species_values) {
      if (
        typeof alias !== "string" ||
        !normalize(alias) ||
        aliases.has(normalize(alias))
      )
        fail(`${s.id} 别名为空或重复：${alias}`);
      aliases.add(normalize(alias));
    }
    const phaseKeys = new Set<string>();
    for (const p of s.phases) {
      if (
        !p ||
        !["autumn_leaf", "flowering"].includes(p.category) ||
        !PHASES[p.category]?.some((x) => x.id === p.id) ||
        !validMonthDay(p.start) ||
        !validMonthDay(p.end) ||
        typeof p.label !== "string" ||
        !p.label ||
        typeof p.description !== "string" ||
        !p.description
      )
        fail(`${s.id} 区间不合法`);
      const key = `${p.category}:${p.id}:${p.start}`;
      if (phaseKeys.has(key)) fail(`${s.id} 区间重复`);
      phaseKeys.add(key);
    }
    for (const category of ["autumn_leaf", "flowering"] as const)
      for (const day of days) {
        if (
          s.phases.filter(
            (p) =>
              p.category === category && inAnnualRange(day, p.start, p.end),
          ).length > 1
        )
          fail(`${s.id} ${category} 在 ${day} 存在区间重叠`);
      }
  }
  return c;
}

export function buildIndex(dataset: Dataset, catalog: Catalog) {
  const names = new Map<string, Set<string>>();
  for (const feature of dataset.features)
    for (const name of feature.properties.species) {
      if (!names.has(name)) names.set(name, new Set());
      names.get(name)!.add(feature.properties.osmId);
    }
  return [...names]
    .map(([name, ids]) => ({
      name,
      count: ids.size,
      osmIds: [...ids].sort(),
      phenologyId: recordFor(name, catalog)?.id ?? null,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}
export interface SiteData {
  schemaVersion: 1;
  revision: string;
  dataset: Dataset;
  catalog: Catalog;
  index: ReturnType<typeof buildIndex>;
  locations?: LocationData;
}
