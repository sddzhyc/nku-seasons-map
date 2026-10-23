import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

const root = resolve("dist");
const server = createServer(async (req, res) => {
  try {
    let path = new URL(req.url!, "http://localhost").pathname;
    if (path.startsWith("/nku-seasons-map/"))
      path = path.slice("/nku-seasons-map".length);
    if (path === "/") path = "/index.html";
    const target = resolve(root, "." + path);
    const inside = relative(root, target);
    if (inside.startsWith(".." + sep) || inside === "..") {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(target);
    res.writeHead(200).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
try {
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const prefix of ["/", "/nku-seasons-map/"]) {
    const url = origin + prefix;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const html = await response.text();
    const paths = [
      ...html.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g),
    ].map((m) => m[1]);
    assert.ok(paths.length >= 2, "relative JS and CSS bundles must be present");
    for (const path of [
      ...paths,
      "data/site-data.json",
      "data/campus.json",
      "data/locations.json",
      "data/species-index.json",
    ]) {
      const target = new URL(path, url);
      assert.ok(target.pathname.startsWith(prefix));
      assert.equal((await fetch(target)).status, 200, target.href);
    }
    const bundle = await (
      await fetch(new URL("data/site-data.json", url))
    ).json();
    assert.equal(bundle.schemaVersion, 1);
    assert.ok(bundle.index.length > 0);
    console.log(`${prefix} — static assets, data bundle and index OK`);
  }
} finally {
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
}
