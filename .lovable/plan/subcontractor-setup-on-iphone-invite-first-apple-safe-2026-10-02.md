# Subcontractor setup on iPhone: invite-first, Apple-safe

## Recommendation
Business owners invite their subcontractors. Subs don't pay or see prices inside the iPhone app. This is the simplest setup that follows Apple's rules.

Why:
- Apple requires every purchase of a digital service inside an iPhone app to go through Apple In-App Purchase. The sub membership currently bills by card, and its price changes with local density ($10–$35). Matching that in Apple would take several Apple subscription products, Apple review and Apple's 15–30% cut.
- Apple does allow an app to let people sign in to an account they set up or paid for somewhere else (the "multiplatform" rule 3.1.3(b)). The condition: the app must not show prices, buy buttons or links that lead to card checkout.
- Subs mostly join because an owner wants them on jobs, so an invite fits how the business actually works.

## What subs will experience
1. The owner opens People and taps "Invite subcontractor", then enters a name and mobile number (and email if they have it).
2. The sub gets a text with a link. On a phone it opens the sign-up page in the browser.
3. On that page the sub sets a password and fills in their trade and capability profile, then confirms their area. Any membership payment also happens there, on the website, which Apple permits.
4. The sub downloads the app, or opens it, and signs in. They see their bids, jobs, messages and availability.
5. If their membership isn't active, the iPhone app shows only a neutral line: "Your membership isn't active. Contact the company that invited you." It shows no price, no button and no link.

## The App Store login screen
- New-company signup and the 14-day Apple trial stay as they are now.
- Add one small line: "Subcontractor? Ask the company you work with to send you an invite." It's text only, with no sign-up form and no link out of the app.
- Subs who were already invited sign in with the normal login.

## Apple rules this covers
- No outside payment links or prices on iPhone (3.1.1 / 3.1.3(b)): the sub paywall and pricing are hidden on iPhone using the same App Store safety switch that already hides card checkout.
- Account deletion inside the app (5.1.1(v)): confirm subs can reach the existing delete-account option from Profile.
- No dead ends for reviewers: the App Review notes should include a demo sub login (Testville) so Apple can see the sub side.
- Invite links never take over an existing account. The current invitation rule stays: someone who already has a login accepts while signed in.

## Out of scope for now (possible later step)
- An Apple in-app subscription for subs, so they could sign up and pay entirely in the app. This makes sense later if self-signup through the App Store becomes important. It needs fixed price tiers set up in App Store Connect.

## Technical details
- People page: add an "Invite subcontractor" action that reuses the existing sub-invitation and owner-approval flow and sends the sign-up link through the existing SMS path. For invited subs, the owner's approval happens automatically.
- `/crew-join?invite=<token>`: prefill and tie the sub to the inviting company. The membership step stays web-only.
- iOS gate (`VITE_IOS_USE_IAP` / App Store safe mode): hide the crew pricing, paywall CTA and any `/crew-join` links. Replace them with the neutral inactive-membership message.
- Login screen (iOS): add the text-only subcontractor hint.
- Verify: invite → web sign-up → app login as the sub with the App Store gate forced on in the preview. Check that no price, checkout or external link appears, and that delete-account is reachable.
- Record in AGENTS.md: "On iOS, subcontractors join by owner invite and never see pricing or purchase paths, because Apple forbids non-IAP purchase flows in the app."

## No Lovable branding anywhere subs can see
- Page titles and link previews are already clear of Lovable branding. The one visible spot is the accept-invite page, which shows "trccai.lovable.app/login". That will change to "app.treecheck.ai/login".
- Every invite and sign-up link we generate (texts, emails, the n8n guide example) will point to app.treecheck.ai, never the lovable.app address.
- App deep links will keep accepting the old address so existing links still work, and will also accept app.treecheck.ai.
