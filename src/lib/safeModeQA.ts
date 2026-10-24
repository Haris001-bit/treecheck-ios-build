/**
 * iOS App Store Safe-Mode QA — payment-compliance audit.
 *
 * Run from the browser console on a native iOS build (or with safe-mode forced
 * in dev) to verify:
 *   • Purchase strings are not rendered in the DOM.
 *   • Payment routes redirect away.
 *   • Payment edge functions are blocked client-side.
 *
 *   window.__safeModeQA()
 */

import {
  isNativeIOS,
  isAppStoreSafeMode,
  canShowPaymentUI,
  canUsePaymentFunction,
  shouldHidePurchaseCTA,
  PAYMENT_EDGE_FUNCTIONS,
} from '@/lib/platform';
import { BLOCKED_PAYMENT_ROUTES, isBlockedPaymentRoute } from '@/components/PaymentRouteGuard';

interface QAResult {
  name: string;
  pass: boolean;
  detail?: string;
  category: 'platform' | 'strings' | 'links' | 'routes' | 'edge-fn' | 'push';
}

/**
 * iOS-safe notification type whitelist — must mirror supabase/functions/send-push.
 */
export const IOS_ALLOWED_PUSH_TYPES = [
  'lead_assigned',
  'lead_unlocked_elsewhere',
  'lead_updated',
  'scout_lead_created',
  'message_or_response_update',
  'account_activity_non_payment',
  'reminder_for_existing_accessible_lead',
] as const;

export const IOS_DISALLOWED_PUSH_TYPES = [
  'marketplace_lead_available_to_buy',
  'unlock_lead',
  'buy_credits',
  'top_up_wallet',
  'upgrade_to_premium',
  'subscribe_dma',
  'subscribe_marketing_package',
  'subscribe_lsa',
  'postcard_purchase',
  'billing_failed_with_upgrade_cta',
  'new_lead', // legacy marketplace teaser type
] as const;

/**
 * Substrings that must NEVER appear in any notification copy delivered to iOS.
 * The send-push gateway replaces caller copy with neutral templates, but this
 * is the QA-side check for static notification builders.
 */
export const IOS_FORBIDDEN_PUSH_COPY = [
  'unlock', 'unlock for', 'buy', 'purchase', 'top up', 'top-up', 'refill',
  'upgrade', 'subscribe', 'subscription', 'premium', 'credits', 'wallet',
  'stripe', 'checkout', 'billing', 'payment', 'pricing', 'discount',
  'go to the website', 'visit our website', 'claim it', 'claim this lead',
  'be the first', '$',
] as const;

export function checkPushCopy(text: string): { safe: boolean; matched: string[] } {
  const lower = (text || '').toLowerCase();
  const matched = IOS_FORBIDDEN_PUSH_COPY.filter((p) => lower.includes(p));
  return { safe: matched.length === 0, matched };
}


/**
 * Case-insensitive substrings that must NEVER appear in the rendered DOM on
 * native iOS. Pulled from the App Review audit checklist.
 */
const FORBIDDEN_TEXT: string[] = [
  // Direct CTAs
  'buy credits', 'buy now', 'purchase', 'top up', 'top-up', 'add credits',
  'auto-refill', 'auto refill', 'refill', 'wallet',
  // Upgrade / subscription
  'upgrade to premium', 'go premium', 'get premium', 'become premium',
  'subscribe', 'subscription', 'start subscription', 'manage billing',
  'billing', 'pricing', 'view plans', 'plans & pricing',
  // Stripe / checkout
  'stripe', 'checkout.stripe.com', 'open stripe', 'checkout',
  'add payment method', 'add card', 'payment method',
  // Unlock / paid lead
  'unlock for $', 'unlock this lead', 'unlock lead', 'lead fee', 'discount',
  'pre-pay for credits', 'save by purchasing', 'you need credits',
  // Features tied to paid tiers
  'marketing package', 'dma upgrade', 'lsa subscription', 'postcard pricing',
  '$99/month', '$99 / month', '$250', '$500',
  // Trial / web steering
  'start a 14-day free trial', 'start your free trial', 'free trial',
  'go to our website', 'purchase on the web', 'activate on our website',
];

export function runSafeModeQA(): { results: QAResult[]; summary: Record<string, number> } {
  const results: QAResult[] = [];

  // --- Platform / mode ---
  results.push({
    category: 'platform',
    name: 'Platform detection: native iOS',
    pass: isNativeIOS(),
    detail: `isNativeIOS=${isNativeIOS()}`,
  });
  results.push({ category: 'platform', name: 'Safe mode active', pass: isAppStoreSafeMode() });
  results.push({ category: 'platform', name: 'canShowPaymentUI() is false', pass: !canShowPaymentUI() });
  results.push({ category: 'platform', name: 'shouldHidePurchaseCTA() is true', pass: shouldHidePurchaseCTA() });

  // --- Edge functions ---
  for (const fn of PAYMENT_EDGE_FUNCTIONS) {
    results.push({
      category: 'edge-fn',
      name: `Edge function blocked: ${fn}`,
      pass: !canUsePaymentFunction(fn),
    });
  }

  // --- Routes ---
  for (const route of BLOCKED_PAYMENT_ROUTES) {
    results.push({
      category: 'routes',
      name: `Route guarded: ${route}`,
      pass: isBlockedPaymentRoute(route),
    });
  }

  // --- DOM: forbidden strings (case-insensitive substring) ---
  if (typeof document !== 'undefined') {
    const haystack = (document.body.innerText || '').toLowerCase();
    for (const phrase of FORBIDDEN_TEXT) {
      const needle = phrase.toLowerCase();
      const found = haystack.includes(needle);
      results.push({
        category: 'strings',
        name: `DOM does not contain "${phrase}"`,
        pass: !found,
        detail: found ? 'string present in rendered UI' : undefined,
      });
    }

    // --- Anchor / link hrefs ---
    const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const badLinks = links.filter((a) =>
      /stripe\.com|checkout|\/pricing|\/dma|\/marketing|\/start-trial|\/billing|\/wallet|\/credits|\/upgrade|\/premium/i.test(a.href)
    );
    results.push({
      category: 'links',
      name: 'No purchase-related anchor links',
      pass: badLinks.length === 0,
      detail: badLinks.length ? badLinks.map((a) => a.href).join(', ') : undefined,
    });
  }

  // --- Push notification configuration ---
  results.push({
    category: 'push',
    name: `iOS allowed push types defined (${IOS_ALLOWED_PUSH_TYPES.length})`,
    pass: IOS_ALLOWED_PUSH_TYPES.length === 7,
  });
  results.push({
    category: 'push',
    name: 'Marketplace/purchase push types are NOT in iOS whitelist',
    pass: IOS_DISALLOWED_PUSH_TYPES.every(
      (t) => !(IOS_ALLOWED_PUSH_TYPES as readonly string[]).includes(t),
    ),
  });
  // Sample-copy check
  const sampleSafe = checkPushCopy('A Tree Removal lead in Caldwell has been added to your account.');
  const sampleBad = checkPushCopy('Unlock this lead for $26.93');
  results.push({
    category: 'push',
    name: 'Safe push copy passes checkPushCopy',
    pass: sampleSafe.safe,
  });
  results.push({
    category: 'push',
    name: 'Disallowed push copy fails checkPushCopy',
    pass: !sampleBad.safe,
    detail: sampleBad.matched.join(', '),
  });

  // --- Summary ---
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    stringsChecked: results.filter((r) => r.category === 'strings').length,
    stringsHidden: results.filter((r) => r.category === 'strings' && r.pass).length,
    stringsLeaking: results.filter((r) => r.category === 'strings' && !r.pass).length,
    routesBlocked: results.filter((r) => r.category === 'routes' && r.pass).length,
    edgeFnsDisabled: results.filter((r) => r.category === 'edge-fn' && r.pass).length,
    pushChecks: results.filter((r) => r.category === 'push').length,
    pushChecksPassed: results.filter((r) => r.category === 'push' && r.pass).length,
    badLinks: results.filter((r) => r.category === 'links' && !r.pass).length,
  };



  /* eslint-disable no-console */
  console.group('[SafeMode QA] Payment compliance audit');
  console.log('Summary:', summary);
  const failed = results.filter((r) => !r.pass);
  if (failed.length === 0) {
    console.log('✅ All checks passed.');
  } else {
    console.warn(`❌ ${failed.length} check(s) failed — manual review required:`);
    for (const r of failed) {
      console.warn(`  • [${r.category}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    }
  }
  console.groupEnd();
  /* eslint-enable no-console */

  return { results, summary };
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__safeModeQA = runSafeModeQA;
}
