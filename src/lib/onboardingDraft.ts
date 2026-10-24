// Onboarding answers kept for the browser session, so reloading /onboarding returns to the same question with the
// same answers instead of starting over at question 1 (signup test, 2026-10-19). Nothing reaches the database
// until Finish, which clears the draft.

export interface OnboardingDraft<S, C> { step: number; s: S; costs: C | null; calibrated: boolean }

const keyFor = (userId: string) => `onboarding-draft:${userId}`;

/** The saved draft, or null when there is none, it is malformed, or it is still on question 1. */
export function readOnboardingDraft<S, C>(userId: string | undefined): OnboardingDraft<S, C> | null {
  if (!userId) return null;
  try {
    const raw = sessionStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !Number.isInteger(d.step) || d.step < 1 || !d.s || typeof d.s !== 'object') return null;
    return { step: d.step, s: d.s, costs: d.costs && typeof d.costs === 'object' ? d.costs : null, calibrated: d.calibrated === true };
  } catch {
    return null;
  }
}

/** Saves the draft; on question 1 there is nothing worth keeping, so it is removed. */
export function writeOnboardingDraft<S, C>(userId: string | undefined, draft: OnboardingDraft<S, C>): void {
  if (!userId) return;
  try {
    if (draft.step < 1) sessionStorage.removeItem(keyFor(userId));
    else sessionStorage.setItem(keyFor(userId), JSON.stringify(draft));
  } catch {
    // Storage unavailable: the wizard still works, it just starts over on reload.
  }
}

export function clearOnboardingDraft(userId: string | undefined): void {
  if (!userId) return;
  try {
    sessionStorage.removeItem(keyFor(userId));
  } catch {
    // Nothing to clear.
  }
}
