import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { parse } from "yaml";
import {
  chinaToday,
  validDate,
  inAnnualRange,
  phaseFor,
  validateCatalog,
  buildIndex,
} from "../src/phenology.js";
import type { Catalog, SiteData } from "../src/phenology.js";
import { buildSiteData } from "../scripts/build-data.js";
import { CAMPUS_WAY, validDataset } from "../src/data.js";

const catalog = validateCatalog(
  parse(await readFile("data/phenology.yaml", "utf8")),
);
const fixture = (): Catalog => structuredClone(catalog);

test("annual ranges include both endpoints, cross years, and respect Shanghai midnight", () => {
  assert.equal(chinaToday(new Date("2026-10-23T15:59:59Z")), "2026-10-23");
  assert.equal(chinaToday(new Date("2026-10-23T16:00:00Z")), "2026-10-24");
  for (const d of ["12-20", "12-31", "01-01", "01-10"])
    assert.equal(inAnnualRange(d, "12-20", "01-10"), true);
  assert.equal(inAnnualRange("01-11", "12-20", "01-10"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2026-04-31"), false);
  assert.equal(validDate("2026-13-01"), false);
});

test("actual catalog transitions from coloring to peak to falling and works across years", () => {
  assert.equal(
    phaseFor("银杏", "2026-10-31", "autumn_leaf", catalog)?.phase.id,
    "coloring",
  );
  assert.equal(
    phaseFor("Ginkgo biloba", "2027-11-01", "autumn_leaf", catalog)?.phase.id,
    "peak",
  );
  assert.equal(
    phaseFor("银杏", "2026-11-12", "autumn_leaf", catalog)?.phase.id,
    "peak",
  );
  assert.equal(
    phaseFor("银杏", "2026-11-13", "autumn_leaf", catalog)?.phase.id,
    "falling",
  );
  assert.equal(
    phaseFor("银杏", "2026-12-01", "autumn_leaf", catalog),
    undefined,
  );
  assert.equal(
    phaseFor("山桃", "2026-03-16", "flowering", catalog)?.phase.id,
    "bloom",
  );
  assert.equal(
    phaseFor("毛白杨", "2026-11-01", "autumn_leaf", catalog),
    undefined,
  );
});

test("reference records can be excluded, while verified records remain eligible", () => {
  assert.equal(
    phaseFor("银杏", "2026-11-08", "autumn_leaf", catalog, false),
    undefined,
  );
  const c = fixture();
  c.species[0].verification = "verified";
  assert.equal(
    phaseFor("银杏", "2026-11-08", "autumn_leaf", c, false)?.phase.id,
    "peak",
  );
});

test("invalid days, overlapping endpoints, cross-year overlaps, duplicate aliases and unknown sources are rejected", () => {
  const cases: Array<(c: Catalog) => void> = [
    (c) => {
      c.species[0].phases[0].start = "02-30";
    },
    (c) => {
      c.species[0].phases[1].start = "10-31";
    },
    (c) => {
      c.species[0].phases[0].start = "11-01";
      c.species[0].phases[0].end = "01-10";
    },
    (c) => {
      c.species[1].osm_species_values.push(" ginkgo biloba ");
    },
    (c) => {
      c.species[0].source_ids = ["missing"];
    },
  ];
  for (const mutate of cases) {
    const c = fixture();
    mutate(c);
    assert.throws(() => validateCatalog(c), /物候库校验失败/);
  }
});

test("compiled bundle and backend index agree with live snapshot and are deterministic", async () => {
  const first = await buildSiteData();
  const second = await buildSiteData();
  assert.equal(first.revision, second.revision);
  const bundle: SiteData = JSON.parse(
    await readFile("public/data/site-data.json", "utf8"),
  );
  assert.equal(validDataset(bundle.dataset), true);
  assert.deepEqual(bundle.index, buildIndex(bundle.dataset, bundle.catalog));
  assert.deepEqual(
    bundle.index
      .flatMap((s) => s.osmIds)
      .filter(
        (id) => !bundle.dataset.features.some((f) => f.properties.osmId === id),
      ),
    [],
  );
});

test("sync imports changed OSM payload, regenerates index, and preserves last-good data on malformed response", async () => {
  const root = await mkdtemp(join(tmpdir(), "nku-map-test-"));
  const run = promisify(execFile);
  try {
    await mkdir(join(root, "data"));
    await mkdir(join(root, "public/data"), { recursive: true });
    await copyFile("data/phenology.yaml", join(root, "data/phenology.yaml"));
    await copyFile(
      "public/data/species.json",
      join(root, "public/data/species.json"),
    );
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
          id: 77,
          nodes: [1, 2, 3, 4, 1],
          tags: { building: "yes" },
        },
        { type: "way", id: 78, nodes: [1, 3], tags: { highway: "footway" } },
        {
          type: "node",
          id: 79,
          lon: 117.331,
          lat: 38.986,
          tags: { natural: "tree", species: "新物种;银杏" },
        },
        {
          type: "node",
          id: 80,
          lon: 117.34,
          lat: 38.986,
          tags: { natural: "tree", species: "校外物种" },
        },
        { type: "node", id: 81, lon: 117.341, lat: 38.986 },
        { type: "way", id: 82, nodes: [80, 81], tags: { highway: "service" } },
      ],
    };
    await writeFile(join(root, "changed.json"), JSON.stringify(raw));
    const args = [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("scripts/sync-osm.ts"),
      "--input",
      "changed.json",
    ];
    await run(process.execPath, args, { cwd: root });
    const bundle: SiteData = JSON.parse(
      await readFile(join(root, "public/data/site-data.json"), "utf8"),
    );
    assert.equal(bundle.dataset.features.length, 1);
    assert.equal(
      bundle.index.find((s) => s.name === "新物种")?.phenologyId,
      null,
    );
    assert.equal(bundle.index.find((s) => s.name === "银杏")?.count, 1);
    assert.equal(
      bundle.index.find((s) => s.name === "校外物种"),
      undefined,
    );
    const background = JSON.parse(
      await readFile(join(root, "public/data/campus.json"), "utf8"),
    );
    assert.ok(
      background.features.some((f: { id: string }) => f.id === "way/82"),
    );
    assert.ok(background.context.fadeBands.features.length > 0);
    const before = await readFile(
      join(root, "public/data/species.json"),
      "utf8",
    );
    await writeFile(
      join(root, "changed.json"),
      JSON.stringify({ elements: [] }),
    );
    await run(process.execPath, [...args, "--allow-stale"], { cwd: root });
    assert.equal(
      await readFile(join(root, "public/data/species.json"), "utf8"),
      before,
    );
  } finally {
    const relativeRoot = relative(resolve(tmpdir()), resolve(root));
    assert.ok(
      relativeRoot.startsWith("nku-map-test-") && !relativeRoot.includes(sep),
      "cleanup is confined to the newly created test directory",
    );
    await rm(root, { recursive: true, force: true });
  }
});

test("deployment workflows are valid YAML and retain snapshot fallback and official Pages deploy", async () => {
  const wf = parse(await readFile(".github/workflows/pages.yml", "utf8"));
  assert.ok(wf.on.schedule[0].cron);
  assert.ok(
    wf.jobs.build.steps.some((s: { run?: string }) =>
      s.run?.includes("--allow-stale"),
    ),
  );
  assert.ok(
    wf.jobs.deploy.steps.some(
      (s: { uses?: string }) => s.uses === "actions/deploy-pages@v4",
    ),
  );
  assert.equal(wf.jobs.deploy.permissions["id-token"], "write");
});
