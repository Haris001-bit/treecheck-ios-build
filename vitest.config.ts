import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    // The edge functions import zod as npm:zod@3 (Deno); tests of supabase/functions/_shared modules use the same zod.
    alias: { "@": path.resolve(__dirname, "./src"), "npm:zod@3": "zod" },
  },
});
