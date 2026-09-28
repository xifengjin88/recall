import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    // The Flask API runs as its own process (see SPEC-platform.md).
    proxy: { "/api": "http://localhost:5001" },
  },
});
