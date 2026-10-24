import { Navigate, useLocation } from 'react-router-dom';
import { canUseAppleIAP, canUseStorePlans, isNativeStoreBilling } from '@/lib/platform';

/**
 * Routes that initiate Stripe / external checkout, blocked in the phone apps (iPhone, and Android from 1.2).
 * When Apple IAP is enabled, Pricing / StartTrial / Register stay available. On Android with the Google Play plans,
 * StartTrial and Register stay available: signup ends on the phone plan screen.
 */
export const BLOCKED_PAYMENT_ROUTES: readonly string[] = [
  '/pricing',
  '/billing',
  '/wallet',
  '/credits',
  '/upgrade',
  '/premium',
  '/checkout',
  '/start-trial',
  '/start-trial/success',
  '/register',
  '/dashboard/pricing',
  '/stripe-success',
  '/stripe-cancel',
];

/** Always blocked on iOS (Stripe return URLs), even with IAP. */
const ALWAYS_BLOCKED_ON_IOS: readonly string[] = [
  '/stripe-success',
  '/stripe-cancel',
  '/checkout',
  '/start-trial/success',
];

/** Allowed on iOS when Apple IAP is enabled. */
const IAP_ALLOWED_ROUTES: readonly string[] = [
  '/dashboard/pricing',
  '/pricing',
  '/start-trial',
  '/register',
];

export function isBlockedPaymentRoute(pathname: string): boolean {
  return BLOCKED_PAYMENT_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + '/')
  );
}

function isAlwaysBlockedOnIos(pathname: string): boolean {
  return ALWAYS_BLOCKED_ON_IOS.some(
    (r) => pathname === r || pathname.startsWith(r + '/')
  );
}

function isIapAllowedRoute(pathname: string): boolean {
  return IAP_ALLOWED_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + '/')
  );
}

/** Signup routes the Android app keeps with the Google Play plans (exact paths; /start-trial/success stays blocked). */
const STORE_SIGNUP_ROUTES: readonly string[] = ['/start-trial', '/register'];

export function PaymentRouteGuard({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();

  if (isNativeStoreBilling() && isBlockedPaymentRoute(pathname)) {
    if (canUseAppleIAP() && isIapAllowedRoute(pathname) && !isAlwaysBlockedOnIos(pathname)) {
      return <>{children}</>;
    }
    if (canUseAppleIAP() && isAlwaysBlockedOnIos(pathname)) {
      return <Navigate to="/dashboard" replace />;
    }
    if (!canUseAppleIAP() && canUseStorePlans() && STORE_SIGNUP_ROUTES.includes(pathname)) {
      return <>{children}</>;
    }
    if (!canUseAppleIAP()) {
      const target = pathname.startsWith('/dashboard')
        ? '/dashboard/subscription-info'
        : '/login';
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[AppStoreSafeMode] Blocked payment route ${pathname} → ${target}`);
      }
      return <Navigate to={target} replace />;
    }
  }

  return <>{children}</>;
}
