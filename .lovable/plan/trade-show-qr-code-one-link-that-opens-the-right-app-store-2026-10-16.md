# Trade show QR code: one link that opens the right app store

## Goal
One QR code for the Fort Lauderdale show. Someone scans it and goes straight to the App Store on an iPhone, or to Google Play on an Android. Computers and unrecognized devices get a simple page with both store buttons.

## What will change
- New page at **https://app.treecheck.ai/get**:
  - iPhone/iPad: goes straight to the TreeCheck App Store listing.
  - Android: goes straight to the TreeCheck Google Play listing.
  - Everything else: a page with the TreeCheck logo, both store buttons and a QR code.
  - If the automatic jump fails, the buttons still show, so nobody hits a dead end.
- Put in the real store links:
  - App Store: https://apps.apple.com/us/app/treecheck/id6773013691
  - Google Play: https://play.google.com/store/apps/details?id=com.treecheck.app (I'll drop the Spanish-language part of the link so visitors see their own language)
- One switch controls when the forwarding goes live. **The apps aren't in the stores yet**, so it stays off for now. While it's off, the page says "Coming soon to the App Store & Google Play" and doesn't forward.
- The existing /install page and the in-app "Get the app" buttons will use the same real links and the same switch.
- I'll make a printable QR code image for **app.treecheck.ai/get** and save it to your Files, sized for a banner or table sign.

## What you'll need to do
- Tell me when both apps are live, and I'll turn on forwarding (it's a quick change). The QR code itself never changes, so you can print it now.
- Publish the app so app.treecheck.ai/get works for the public.

## Technical details
- New public route `/get` (no sign-in needed). It checks the device type and uses `window.location.replace`, which keeps the back button working. The fallback is the existing `GetTheApp` component.
- Update `src/lib/app-stores.ts`: real URLs, `INSTALL_LANDING_URL` set to `https://app.treecheck.ai/get`, and `APP_LIVE_IN_STORES` left `false`.
- Inside the native app, `/get` won't forward.
- On iOS, subcontractors' in-app behavior and pricing rules stay the same; this page only links to the store listings.
- Small test: iPhone, Android and desktop each get the right destination, and nothing forwards while the switch is off.
- QR PNG made locally and saved as /mnt/documents/treecheck-get-app-qr.png, high resolution with the error correction set high.
