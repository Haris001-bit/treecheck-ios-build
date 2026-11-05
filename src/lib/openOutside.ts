import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/** An outside page (e.g. First Impression websites): the in-app browser in the phone apps, a new tab on the website. */
export async function openOutside(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Browser.open({ url, presentationStyle: 'popover' });
      return;
    } catch {
      // Falls through to a new window.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
