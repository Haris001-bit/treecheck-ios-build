# First Impression website reminder on copy-and-paste Marketing

## What the user sees
Wording (same everywhere):
"This post can be published to your website automatically and instantly with a TreeCheck First Impression website, built by Trades Marketing AI." followed by a **See how it works / Schedule a demo** link to tradesmarketing.ai/dma-web (the page with the demo button).

Shown in three places, copy-and-paste companies only (never for companies already on a First Impression site):
1. **Above the job form**: a slim banner under the page title.
2. **On the finished post**: the existing box above the Website/Google/Facebook/Instagram tabs gets the new wording and link.
3. **In the success message** after "Your draft is ready."

## Phone apps
The text shows in the iPhone and Android apps, but without the link. That's the same rule we already follow so Apple and Google don't reject the app for pointing to outside sign-ups.

## Technical details
- Update `FirstImpressionNote` in `src/components/DMAEmailPosts.tsx` with the new copy and a link label; keep the `isNativeStoreBilling()` guard on the link.
- Render it above `DMAJobSubmission` inside `DMAEmailPosts` (copy-and-paste only; the connected page doesn't use this component).
- Add the reminder to the "draft ready" toast description.
- Add a small test checking the note shows the link on web and hides it in the apps.
