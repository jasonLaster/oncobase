import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiOrigin = process.env.VITE_WIKI_API_ORIGIN ?? "http://localhost:3000";

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60001,
    proxy: {
      "/api": {
        target: apiOrigin,
        changeOrigin: true,
      },
    },
  },
  worker: { format: "es" },
  plugins: [react()],
});
