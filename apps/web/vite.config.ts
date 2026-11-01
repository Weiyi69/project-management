import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: process.env.VITE_PORT !== undefined,
    proxy: {
      "/api": {
        target: apiTarget,
      },
      "/socket.io": {
        target: apiTarget,
        ws: true,
      },
    },
  },
});
