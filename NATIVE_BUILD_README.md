# Native Build Guide (iOS + Android)

This project is a React + Vite + Capacitor app. The web side is built and shipped by Lovable; this README documents the **native shell build** that the freelancer owns.

---

## 1. Prerequisites

- Mac with latest **Xcode** (iOS only — Apple requirement)
- **Android Studio** (latest stable)
- **Node 20+**, npm or bun
- **CocoaPods** (`sudo gem install cocoapods`)
- Apple Developer account access (added by client as Developer-role user in App Store Connect)
- Google Play Console access (added by client as Release Manager)
- Firebase project access (added by client as Editor)

## 2. Clone & install

```bash
git clone <repo>
cd <repo>
npm install
```

## 3. Build the web bundle

```bash
npm run build
```

For App Store / Play Store production builds, **comment out the `server` block** in `capacitor.config.ts` so the app bundles the web assets locally instead of loading them from a URL. Restore it for hot-reload development.

## 4. Add native platforms (one-time)

```bash
npx cap add ios
npx cap add android
```

## 5. Generate app icons and splash screens

Source files live in `/assets`. Regenerate every required size:

```bash
npx capacitor-assets generate \
  --iconBackgroundColor "#7a9b4d" \
  --iconBackgroundColorDark "#5e7a3c" \
  --splashBackgroundColor "#7a9b4d" \
  --splashBackgroundColorDark "#1a1a1a"
```

## 6. Sync web → native

Run after every web build or capacitor.config change:

```bash
npx cap sync
```

# 7b. iOS — Apple IAP (RevenueCat)

Full product checklist: [docs/IAP_SETUP.md](docs/IAP_SETUP.md).

1. App Store Connect: create all IAP products + 14-day intro offer on `treecheck_demo_monthly`.
2. Xcode → Signing & Capabilities → **In-App Purchase**.
3. RevenueCat: map products, offerings (`default`, `lead_unlock`), webhook → `revenuecat-webhook`.
4. Env:
   ```bash
   VITE_IOS_USE_IAP=true
   # Public iOS SDK key from RevenueCat (starts with appl_). Not the secret key.
   VITE_REVENUECAT_IOS_API_KEY=appl_xxxxx
   VITE_IOS_EXTERNAL_PURCHASE_LINKS_ALLOWED=false
   ```
5. If Purchases returns `{ "code": "UNIMPLEMENTED" }`:
   - Confirm Xcode console shows `⚡️ [TreecheckIap] Purchases registered=true` at launch
   - App uses programmatic `MyViewController` (no Main storyboard root) — Product → Clean Build Folder, then rebuild/run
   - Enable **In-App Purchase** capability
   - Open `ios/App/App.xcodeproj` (SPM — no CocoaPods `App.xcworkspace` is expected)
   - Public SDK key must start with `appl_` (not `test_`)
6. Supabase secrets: `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_API_KEY`.
7. Apply migration `20260807120000_iap_revenuecat_tables.sql` and deploy functions:
   - `revenuecat-webhook`
   - `iap-unlock-lead`
   - `create-ios-register`
   - updated `purchase-lead` (credits-only without Stripe card)

Android and web continue to use Stripe only.

---

## 7. iOS — Firebase + Push + Universal Links

1. Open `ios/App/App.xcworkspace` in Xcode.
2. Drag `GoogleService-Info.plist` (from client / Firebase Console) into the **App** target. Check "Copy items if needed".
3. **Signing & Capabilities** tab:
   - Set Team to client's Apple Developer team
   - Add capability: **Push Notifications**
   - Add capability: **Background Modes** → check **Remote notifications**
   - Add capability: **Associated Domains** → add `applinks:trccai.lovable.app`
4. Apple Developer Portal → Keys → create **APNs Auth Key (.p8)**. Note Key ID + Team ID.
5. Firebase Console → Project Settings → Cloud Messaging → upload `.p8`, Key ID, Team ID.
6. Update `public/.well-known/apple-app-site-association` — replace `REPLACE_WITH_TEAMID` with the real Team ID, redeploy the web app, verify it serves at `https://trccai.lovable.app/.well-known/apple-app-site-association` with `Content-Type: application/json` and no extension.

### iOS Info.plist — permission strings (REQUIRED — already needed at build time even for unused features)

Add the following keys via Xcode → Info tab → "Custom iOS Target Properties" (or edit `ios/App/App/Info.plist` directly):

```xml
<key>NSCameraUsageDescription</key>
<string>TREECHECK uses your camera to capture photos of trees and completed jobs.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>TREECHECK accesses your photos so you can upload images of trees and completed work.</string>
<key>NSPhotoLibraryAddUsageDescription</key>
<string>TREECHECK saves photos of completed jobs to your library.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>TREECHECK uses your location to show nearby leads and help you route to job sites.</string>
<key>NSFaceIDUsageDescription</key>
<string>TREECHECK uses Face ID to securely and quickly sign you in.</string>
<key>NSMicrophoneUsageDescription</key>
<string>TREECHECK uses the microphone for voice notes on job sites.</string>
```

## 8. Android — Firebase + Push + App Links

1. Open `android/` in Android Studio.
2. Drop `google-services.json` into `android/app/`.
3. Generate a release keystore (keep it FOREVER — losing it means you can never update the app):
   ```bash
   keytool -genkey -v -keystore treecheck-release.keystore -alias treecheck -keyalg RSA -keysize 2048 -validity 10000
   ```
   Deliver `treecheck-release.keystore` + alias + passwords to the client. Commit a `keystore.properties.example`; real `keystore.properties` stays out of git.
4. Get the SHA-256 fingerprint:
   ```bash
   keytool -list -v -keystore treecheck-release.keystore -alias treecheck | grep SHA256
   ```
   Paste it into `public/.well-known/assetlinks.json` (replace `REPLACE_WITH_SHA256_FROM_ANDROID_KEYSTORE`). Redeploy the web app.
5. Verify the file is served at `https://trccai.lovable.app/.well-known/assetlinks.json` with `Content-Type: application/json`.

### Android — runtime permissions
`@capacitor/camera`, `@capacitor/geolocation`, `@capacitor/local-notifications`, and `@capacitor/push-notifications` register their permissions automatically when included. Verify `android/app/src/main/AndroidManifest.xml` after `cap sync`.

## 9. Build & ship

### iOS → TestFlight
1. Xcode → top bar → choose "Any iOS Device (arm64)"
2. **Product → Archive** (5–10 min)
3. Organizer → **Distribute App** → **App Store Connect** → **Upload**
4. After ~15 min processing, go to App Store Connect → TestFlight → add client as internal tester.

### Android → Google Play Internal Testing
1. Android Studio → **Build → Generate Signed Bundle / APK** → choose **Android App Bundle (.aab)** → use the release keystore.
2. Play Console → create app → Internal Testing track → upload `.aab` → add client to tester list.

## 10. Verification (required for sign-off)

On a screen-share with the client:
- App opens on physical iPhone and physical Android device
- Tapping `https://trccai.lovable.app/dashboard` in iMessage opens **inside the app** (not Safari)
- Firebase Console → Cloud Messaging → "Send test message" reaches both devices
- Login + push permission grant flow works end-to-end

## 11. Hand-off to client

Deliver:
- All access tokens revoked / passwords rotated
- Android release keystore + passwords (sent securely via Upwork file message)
- Updated README in repo with any deviations
- Short Loom video walking through any non-obvious Xcode/Android Studio steps for future updates

---

## Already wired in this repo

You don't need to touch these — they're already done on the JS side:

- `@capacitor/push-notifications` registration → saves FCM/APNs token to backend `device_tokens` table (`src/hooks/usePushNotifications.ts`)
- Native bridge: deep links, status bar, splash hide, keyboard (`src/hooks/useNativeBridge.ts`)
- Backend `send-push` edge function uses FCM HTTP v1 with service account (already deployed)
- Plugins installed: camera, geolocation, status-bar, keyboard, haptics, share, app, network, browser, local-notifications, splash-screen, biometric, assets

Future native features (e.g. wiring camera into a new screen) usually require only a JS change + `cap sync`, NOT a re-archive — unless you add a brand-new plugin or change permission strings.
