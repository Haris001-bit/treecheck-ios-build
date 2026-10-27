import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useLocation } from "react-router-dom";

/**
 * Floating dev toggle to preview the iOS App Store Safe Mode in the web preview.
 * Hidden on actual native iOS (always-on there) and on production domain.
 */
export function SafeModeToggle() {
  const [on, setOn] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    try {
      setOn(localStorage.getItem("tc_force_safe_mode") === "1");
    } catch {}
  }, []);

  // Hide in the phone apps (iPhone and Android): this is a developer preview switch, never for customers.
  try {
    if (Capacitor.isNativePlatform()) {
      return null;
    }
  } catch {}

  // Hide on the public signup pages so the preview matches what customers see.
  if (typeof window !== "undefined" && /^\/(start-trial|giveaway|$)/.test(pathname)) {
    return null;
  }

  // Hide on the public production domain to avoid confusing real contractors.
  if (typeof window !== "undefined" && ["trccai.lovable.app", "app.treecheck.ai"].includes(window.location.hostname)) {
    return null;
  }

  // Hide while the advertisement sample is open so screenshots stay clean.
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sample") === "1") {
    return null;
  }


  const toggle = () => {
    try {
      if (on) {
        localStorage.removeItem("tc_force_safe_mode");
      } else {
        localStorage.setItem("tc_force_safe_mode", "1");
      }
    } catch {}
    window.location.reload();
  };

  return (
    <button
      onClick={toggle}
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 99999,
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 9999,
        border: "1px solid rgba(0,0,0,0.1)",
        background: on ? "#7a9b4d" : "#1f2937",
        color: "#fff",
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        cursor: "pointer",
      }}
      title="Toggle iOS App Store Safe Mode preview"
    >
      iOS Safe Mode: {on ? "ON" : "OFF"}
    </button>
  );
}
