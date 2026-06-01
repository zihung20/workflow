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
  esbuild: {
    target: 'es2024',
  },
  build: {
    target: 'es2024',
    chunkSizeWarningLimit: 1000,
  },
});
