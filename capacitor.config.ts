import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.treecheck.app',
  appName: 'TREECHECK',
  webDir: 'dist',
  // For live web-based updates, the app loads from the hosted URL.
  // Freelancer: comment out the `server` block for a production App Store / Play Store build
  // that bundles the web assets locally. Keep it for development/hot-reload.
  // server: {
  //   url: 'https://trccai.lovable.app?forceHideBadge=true',
  //   cleartext: true,
  // },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#7a9b4d',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#7a9b4d',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#7a9b4d',
    },
    CapacitorHttp: {
      enabled: true,
    },
  },
  ios: {
    contentInset: 'always',
    // Universal Links: TREECHECK domain
    // Freelancer must add Associated Domains capability in Xcode with: applinks:trccai.lovable.app
  },
  android: {
    // App Links: assetlinks.json must be hosted at https://trccai.lovable.app/.well-known/assetlinks.json
    allowMixedContent: true,
  },
};

export default config;
