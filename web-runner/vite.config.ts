import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function flowydDtsPlugin() {
  const virtualId = "virtual:flowyd-dts";
  const resolvedId = "\0" + virtualId;
  return {
    name: "flowyd-dts",
    resolveId(id: string) {
      if (id === virtualId) return resolvedId;
    },
    load(id: string) {
      if (id !== resolvedId) return;
      const distDir = resolve(__dirname, "../flowyd/dist");
      const entries = readdirSync(distDir)
        .filter((f) => f.endsWith(".d.ts"))
        .map((filename) => ({
          filename,
          content: readFileSync(resolve(distDir, filename), "utf-8"),
        }));
      return `export default ${JSON.stringify(entries)};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), flowydDtsPlugin()],
  server: {
    fs: { allow: [".."] },
  },
  optimizeDeps: {
    include: ["flowyd", "flowyd/visualization"],
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
});
