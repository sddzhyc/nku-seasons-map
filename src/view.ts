import type { SpeciesGroup } from "./data";
import { recordFor, type Catalog, type Category } from "./phenology";

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
