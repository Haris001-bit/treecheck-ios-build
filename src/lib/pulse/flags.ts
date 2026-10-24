// Financial Pulse feature flags.
// The Pulse screen shows on the website and in the iOS / Android apps (Haris 2026-10-06, as the agreed scope
// says: in the phone apps with the next app store update). Setting up, linking a bank or card, reconnecting and
// connecting Jobber stay on the website: those open Plaid's and Jobber's own windows, which the store apps
// don't carry. PULSE_NATIVE_ENABLED is the switch to take the screen out of the apps again.
import { Capacitor } from "@capacitor/core";

export const PULSE_NATIVE_ENABLED = true;

/** True inside the Capacitor iOS / Android app. Any failure to tell counts as the website. */
export function isPulseNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Whether the Pulse screens may show on this platform at all (the owner switch is checked separately). */
export function pulseSurfaceAllowed(nativeEnabled: boolean = PULSE_NATIVE_ENABLED): boolean {
  if (nativeEnabled) return true;
  return !isPulseNativePlatform();
}

/** Whether setup, bank linking, reconnecting and connecting Jobber may run here: the website only. */
export function pulseSetupAllowed(): boolean {
  return !isPulseNativePlatform();
}
