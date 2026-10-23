import { defineConfig } from "vite";
import { resolve } from "node:path";
import { buildSiteData } from "./scripts/build-data";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "phenology-yaml-watch",
      configureServer(server) {
        const file = resolve("data/phenology.yaml");
        let pending = Promise.resolve();
        server.watcher.add(file);
        server.watcher.on("change", (changed) => {
          if (resolve(changed) !== file) return;
          pending = pending.then(async () => {
            try {
              await buildSiteData();
              server.ws.send({ type: "full-reload" });
            } catch (error) {
              server.config.logger.error(String(error));
            }
          });
        });
      },
    },
  ],
});
