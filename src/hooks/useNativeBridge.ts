import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp, URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Keyboard } from '@capacitor/keyboard';

/**
 * Wires up native-only behavior: deep links, status bar, splash screen, keyboard.
 * No-op on web. Mount once at the top of the app (inside <BrowserRouter>).
 */
export function useNativeBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Style native chrome
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#7a9b4d' }).catch(() => {});

    // Hide splash once React has mounted
    SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => {});

    // Keyboard niceties (Android)
    Keyboard.setAccessoryBarVisible({ isVisible: true }).catch(() => {});

    // Deep links: handle https://app.treecheck.ai/<path> (or the old address) and treecheck://<path>
    // Apple Universal Links + Android App Links route in-app instead of opening Safari/Chrome.
    const sub = CapApp.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      Browser.close().catch(() => {});
      try {
        const raw = event.url;
        // treecheck://lead-unlocked?lead_id=...  → route to in-app return page
        if (raw.startsWith('treecheck://')) {
          const rest = raw.replace(/^treecheck:\/\//, '');
          const [host, query = ''] = rest.split('?');
          if (host === 'lead-unlocked') {
            navigate(`/app/lead-unlocked${query ? `?${query}` : ''}`, { replace: false });
            return;
          }
          navigate(`/${host}${query ? `?${query}` : ''}`, { replace: false });
          return;
        }
        const url = new URL(raw);
        const path = (url.pathname || '/') + (url.search || '') + (url.hash || '');
        if (path && path !== '/') {
          navigate(path, { replace: false });
        }
      } catch {
        // ignore malformed urls
      }
    });

    return () => {
      sub.then((h) => h.remove()).catch(() => {});
    };
  }, [navigate]);
}
