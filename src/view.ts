import type { SpeciesFeature, SpeciesGroup } from "./data";
import {
  PHASES, phaseFor, recordFor, type Catalog, type Category,
} from "./phenology";

// Count locations, not trees or species tags. Mixed-species locations use the
// latest matching stage, just as the map does, and are counted only once.
export function phenologyStats(
  features: SpeciesFeature[],
  catalog: Catalog | undefined,
  date: string,
  category: Category,
  selected: string | null = null,
  includeReferences = true,
) {
  const locations = new Map<string, Set<string>>();
  for (const feature of features) {
    if (selected && !feature.properties.species.includes(selected)) continue;
    const names = locations.get(feature.properties.osmId) ?? new Set<string>();
    for (const name of selected ? [selected] : feature.properties.species)
      names.add(name);
    locations.set(feature.properties.osmId, names);
  }
  const result = {
    total: locations.size, matched: 0, outside: 0, unknown: 0, excluded: 0,
    phases: Object.fromEntries(PHASES[category].map((p) => [p.id, 0])),
  };
  for (const names of locations.values()) {
    const configured = [...names].filter((name) => catalog &&
      recordFor(name, catalog)?.phases.some((p) => p.category === category));
    const eligible = configured.filter((name) => includeReferences ||
      recordFor(name, catalog!)?.verification === "verified");
    const matches = eligible.map((name) =>
      phaseFor(name, date, category, catalog!, includeReferences));
    const phase = [...PHASES[category]].reverse().find((p) =>
      matches.some((m) => m?.phase.id === p.id));
    if (phase) {
      result.phases[phase.id]++;
      result.matched++;
    } else if (eligible.length) result.outside++;
    else if (configured.length) result.excluded++;
    else result.unknown++;
  }
  return result;
}

export function isDevMode(search: string): boolean {
  return new URLSearchParams(search).get("dev") === "1";
}

// Category eligibility is independent of the selected day. An out-of-season
// plant with known dates stays discoverable; unknown dates are not invented.
export function groupsForView(
  groups: SpeciesGroup[],
  catalog: Catalog | undefined,
  mode: "season" | "distribution",
  category: Category,
  includeReferences = true,
): SpeciesGroup[] {
  if (mode === "distribution") return groups;
  if (!catalog) return [];
  return groups.filter((group) => {
    const record = recordFor(group.name, catalog);
    return (
      record &&
      (includeReferences || record.verification === "verified") &&
      record.phases.some((phase) => phase.category === category)
    );
  });
}
