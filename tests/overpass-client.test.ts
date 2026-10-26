import { test } from "node:test";
import assert from "node:assert/strict";
import { queryOverpass, type OsmAttempt } from "../scripts/overpass-client.js";
import { CAMPUS_WAY } from "../src/data.js";

const servers = [
  "https://one.example/api/interpreter",
  "https://two.example/api/interpreter",
];
const raw = {
  elements: [
    { type: "node", id: 1, lon: 0, lat: 0 },
    { type: "node", id: 2, lon: 2, lat: 0 },
    { type: "node", id: 3, lon: 2, lat: 2 },
    { type: "node", id: 4, lon: 0, lat: 2 },
    {
      type: "way",
      id: CAMPUS_WAY,
      nodes: [1, 2, 3, 4, 1],
      tags: { amenity: "university" },
    },
    {
      type: "node",
      id: 5,
      lon: 1,
      lat: 1,
      tags: { natural: "tree", species: "银杏" },
    },
  ],
};
const good = () =>
  new Response(JSON.stringify(raw), {
    headers: { "content-type": "application/json" },
  });
function harness(responses: Array<Response | Error>) {
  let clock = 0;
  const calls: Array<{
    url: string;
    time: number;
    init: RequestInit | undefined;
  }> = [];
  const waits: number[] = [],
    reports: OsmAttempt[] = [];
  const fetcher = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), time: clock, init });
    clock += 10;
    const next = responses.shift();
    if (!next) throw Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return {
    calls,
    waits,
    reports,
    options: {
      timeoutMs: 1000,
      endpoints: servers,
      fetcher,
      now: () => clock,
      sleep: async (ms: number) => {
        waits.push(ms);
        clock += ms;
      },
      report: (a: OsmAttempt) => reports.push(a),
    },
  };
}

test("a transient gateway failure falls back to another server with GET and a project identity", async () => {
  const h = harness([
    new Response("<h1>Bad gateway</h1>", {
      status: 502,
      headers: { server: "gateway" },
    }),
    good(),
  ]);
  const result = await queryOverpass("test query", h.options);
  assert.equal(result.source, servers[1]);
  assert.equal(h.calls.length, 2);
  assert.equal(new URL(h.calls[0].url).searchParams.get("data"), "test query");
  assert.equal(h.calls[0].init?.body, undefined);
  assert.match(
    new Headers(h.calls[0].init?.headers).get("user-agent")!,
    /NkuSeasonsMap/,
  );
  assert.match(h.reports[0].message!, /HTTP 502.*server=gateway.*Bad gateway/);
  assert.equal(h.reports[1].outcome, "success");
});
test("timeouts on both servers get one delayed retry instead of waiting six hours", async () => {
  const h = harness([
    new DOMException("timed out", "TimeoutError"),
    new DOMException("timed out", "TimeoutError"),
    good(),
  ]);
  assert.equal((await queryOverpass("query", h.options)).source, servers[0]);
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls[2].time - h.calls[0].time >= 30_000);
  assert.equal(h.reports[2].round, 2);
});
test("long Retry-After is respected without holding the runner indefinitely or retrying permanent 400", async () => {
  const h = harness([
    new Response("busy", { status: 429, headers: { "retry-after": "120" } }),
    new Response("bad query", { status: 400 }),
  ]);
  await assert.rejects(
    queryOverpass("query", h.options),
    /两轮 Overpass 查询均失败/,
  );
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.waits, []);
  assert.equal(h.reports.at(-1)?.outcome, "deferred");
});
test("an HTTP 200 containing an Overpass error is rejected, then a valid alternate response is used", async () => {
  const h = harness([
    new Response(
      JSON.stringify({ ...raw, remark: "runtime error: Query timed out" }),
    ),
    good(),
  ]);
  assert.equal((await queryOverpass("query", h.options)).source, servers[1]);
  assert.equal(h.reports[0].outcome, "failed");
  assert.equal(h.reports[0].status, 200);
});
test("exhausted transient failures stop after two rounds with usable diagnostics", async () => {
  const h = harness(
    Array.from(
      { length: 4 },
      () => new Response("upstream unavailable", { status: 503 }),
    ),
  );
  await assert.rejects(
    queryOverpass("query", h.options),
    /round=2: Error: HTTP 503.*upstream unavailable/,
  );
  assert.equal(h.calls.length, 4);
  assert.equal(h.reports.filter((a) => a.outcome === "success").length, 0);
});
