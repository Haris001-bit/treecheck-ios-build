import { useEffect, useState } from "react";
import { Apple, Smartphone, QrCode } from "lucide-react";
import {
  APP_STORE_URL,
  PLAY_STORE_URL,
  APP_LIVE_IN_STORES,
  INSTALL_LANDING_URL,
} from "@/lib/app-stores";

type Device = "ios" | "android" | "desktop";

function detectDevice(): Device {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function StoreButton({
  href,
  disabled,
  icon,
  top,
  bottom,
}: {
  href: string;
  disabled: boolean;
  icon: React.ReactNode;
  top: string;
  bottom: string;
}) {
  const inner = (
    <div
      className={`flex items-center gap-3 rounded-xl border-2 px-5 py-3 transition-all ${
        disabled
          ? "border-muted bg-muted/40 cursor-not-allowed opacity-70"
          : "border-foreground bg-foreground text-background hover:opacity-90"
      }`}
    >
      <div className="shrink-0">{icon}</div>
      <div className="text-left leading-tight">
        <div className="text-[10px] uppercase tracking-wide opacity-80">
          {top}
        </div>
        <div className="text-base font-semibold">{bottom}</div>
      </div>
    </div>
  );

  if (disabled) return inner;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  );
}

export function GetTheApp() {
  const [device, setDevice] = useState<Device>("desktop");

  useEffect(() => {
    setDevice(detectDevice());
  }, []);

  const comingSoon = !APP_LIVE_IN_STORES;

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(
    INSTALL_LANDING_URL
  )}`;

  return (
    <div className="space-y-5">
      {comingSoon && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center">
          <p className="text-sm font-semibold text-primary">
            App launching in the App Store &amp; Google Play any day now.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Bookmark this page — the download buttons will go live as soon as
            it's listed.
          </p>
        </div>
      )}

      {device !== "desktop" ? (
        <div className="flex flex-col gap-3">
          {device === "ios" && (
            <StoreButton
              href={APP_STORE_URL}
              disabled={comingSoon}
              icon={<Apple className="h-7 w-7" />}
              top="Download on the"
              bottom="App Store"
            />
          )}
          {device === "android" && (
            <StoreButton
              href={PLAY_STORE_URL}
              disabled={comingSoon}
              icon={<Smartphone className="h-7 w-7" />}
              top="Get it on"
              bottom="Google Play"
            />
          )}
          {/* Show the other store too, in case detection is off */}
          {device === "ios" ? (
            <StoreButton
              href={PLAY_STORE_URL}
              disabled={comingSoon}
              icon={<Smartphone className="h-6 w-6" />}
              top="Also on"
              bottom="Google Play"
            />
          ) : (
            <StoreButton
              href={APP_STORE_URL}
              disabled={comingSoon}
              icon={<Apple className="h-6 w-6" />}
              top="Also on the"
              bottom="App Store"
            />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5 text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground mb-3">
              <QrCode className="h-4 w-4" />
              Scan with your phone camera
            </div>
            <img
              src={qrSrc}
              alt="Scan to install the TREECHECK app on your phone"
              className="mx-auto h-48 w-48 rounded-md bg-white p-2"
              loading="lazy"
            />
            <p className="text-xs text-muted-foreground mt-3">
              Opens the download page on your iPhone or Android.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <StoreButton
              href={APP_STORE_URL}
              disabled={comingSoon}
              icon={<Apple className="h-7 w-7" />}
              top="Download on the"
              bottom="App Store"
            />
            <StoreButton
              href={PLAY_STORE_URL}
              disabled={comingSoon}
              icon={<Smartphone className="h-7 w-7" />}
              top="Get it on"
              bottom="Google Play"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default GetTheApp;
