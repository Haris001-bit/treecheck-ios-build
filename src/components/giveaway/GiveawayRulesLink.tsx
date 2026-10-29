import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { getWebBaseUrl } from '@/lib/platform';

const GIVEAWAY_RULES_PATH = '/giveaway/rules';

/** The website's rules page as the phone apps open it: in_app=1 hides its links into the website's signup and prices. */
const giveawayRulesWebUrl = () => `${getWebBaseUrl()}${GIVEAWAY_RULES_PATH}?in_app=1`;

/**
 * Link to the giveaway's Official Rules. The phone apps open the website's page in the in-app browser, so the rules read as
 * published (finishing or correcting them never waits for a store update) and Apple still sees them inside the app (5.3.2).
 */
export function GiveawayRulesLink({ className, children }: { className?: string; children: ReactNode }) {
  if (!Capacitor.isNativePlatform()) return <Link to={GIVEAWAY_RULES_PATH} className={className}>{children}</Link>;
  const open = async () => {
    const url = giveawayRulesWebUrl();
    try {
      await Browser.open({ url, presentationStyle: 'popover' });
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };
  return <button type="button" className={className} onClick={() => void open()}>{children}</button>;
}
