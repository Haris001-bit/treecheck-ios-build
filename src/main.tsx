import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const APP_VERSION = import.meta.env.VITE_TREECHECK_BUILD_VERSION || "dev";
const LEGACY_CACHE_PATTERNS = [/workbox/i, /vite-pwa/i, /precache/i, /runtime/i, /html/i];

// Keep the app off any stale PWA shell. If an old service worker or Workbox cache
// exists, remove it and reload once so the current dashboard menu is fetched fresh.
if ("serviceWorker" in navigator) {
  (async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      const keys = await caches.keys();
      const staleKeys = keys.filter((key) => LEGACY_CACHE_PATTERNS.some((pattern) => pattern.test(key)));

      if (regs.length > 0 || staleKeys.length > 0) {
        await Promise.all(regs.map((r) => r.unregister()));
        await Promise.all(staleKeys.map((key) => caches.delete(key)));
        localStorage.setItem("treecheck_app_version", APP_VERSION);
        window.location.reload();
      }
    } catch (e) {
      console.warn("Service worker cleanup failed", e);
    }
  })();
}

localStorage.setItem("treecheck_app_version", APP_VERSION);

createRoot(document.getElementById("root")!).render(<App />);
