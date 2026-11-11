import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/opex-vehicle-booking/",
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: "dist", sourcemap: true }
});
