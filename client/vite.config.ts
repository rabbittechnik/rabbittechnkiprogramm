import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/webhook": { target: "http://localhost:8787", changeOrigin: true },
      "/create-sumup-checkout": { target: "http://localhost:8787", changeOrigin: true },
      "/uploads": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
