import { defineConfig } from "vite";
import { resolve } from "node:path";
import { buildSiteData } from "./scripts/build-data";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "map-yaml-watch",
      configureServer(server) {
        const files = ["data/phenology.yaml", "data/locations.yaml"].map(
          (file) => resolve(file),
        );
        let pending = Promise.resolve();
        server.watcher.add(files);
        server.watcher.on("change", (changed) => {
          if (!files.includes(resolve(changed))) return;
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
