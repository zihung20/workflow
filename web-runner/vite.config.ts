import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
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
