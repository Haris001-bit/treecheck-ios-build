// Signup permission wording. The server stores the matching text from supabase/functions/_shared/consent.ts by version,
// so change both files together and bump CONSENT_VERSION whenever a word changes.
export const CONSENT_VERSION = '2026-10-26';

export const ACCOUNT_CONSENT_TEXT =
  'I agree to receive account messages from TreeCheck about my trial, billing, jobs and crew by email, text message and phone call. Message and data rates may apply. Reply STOP to stop texts.';

export const MARKETING_CONSENT_TEXT =
  'Yes, send me TreeCheck news, tips and offers by email, text message and phone call, including automated texts and calls, at the email and phone number I entered. This is optional and not required to sign up. Message frequency varies; message and data rates may apply. Reply STOP to stop texts or unsubscribe anytime.';

export type SignupConsent = { version: string; account: boolean; marketing: boolean };
