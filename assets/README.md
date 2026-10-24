# App Icons & Splash Screens

This folder is read by `@capacitor/assets` to auto-generate every required size for iOS and Android.

## Files

- `icon.png` — 1024x1024, square, opaque. The app icon.
- `icon-foreground.png` — 1024x1024, transparent. Android adaptive icon foreground (logo only, padded).
- `icon-background.png` — 1024x1024, solid brand color. Android adaptive icon background.
- `splash.png` — 2732x2732, brand color background with centered logo (~30% of canvas). Splash screen.
- `splash-dark.png` — same as splash, dark mode variant (optional).

## Regenerate native assets

After replacing any file, run on the Mac/PC:

```bash
npx capacitor-assets generate --iconBackgroundColor "#7a9b4d" --iconBackgroundColorDark "#5e7a3c" --splashBackgroundColor "#7a9b4d" --splashBackgroundColorDark "#1a1a1a"
npx cap sync
```

This writes every iOS `AppIcon.appiconset` size + every Android `mipmap-*` size + splash assets automatically.
No manual resizing needed.
