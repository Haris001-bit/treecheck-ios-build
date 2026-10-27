import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import treecheckLogo from "@/assets/treecheck-white-login.png";
import { GetTheApp } from "@/components/GetTheApp";
import { detectStoreDevice, storeRedirectFor } from "@/lib/app-stores";

export default function GetApp() {
  useEffect(() => {
    document.title = "Get the TREECHECK App";
    if (Capacitor.isNativePlatform()) return;
    const target = storeRedirectFor(
      detectStoreDevice(navigator.userAgent, navigator.maxTouchPoints || 0),
    );
    if (target) window.location.replace(target);
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img src={treecheckLogo} alt="TREECHECK" className="mx-auto mb-4 h-16 w-auto object-contain" />
          <CardTitle className="text-2xl">Get the TREECHECK App</CardTitle>
          <CardDescription>Download it free on your phone.</CardDescription>
        </CardHeader>
        <CardContent>
          <GetTheApp />
        </CardContent>
      </Card>
    </div>
  );
}
