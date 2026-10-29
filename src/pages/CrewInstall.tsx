import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import treecheckLogo from '@/assets/treecheck-white-login.png';
import walkthroughVideoAsset from '@/assets/treecheck-grounds-walkthrough-mobile.mp4.asset.json';
import walkthroughPosterAsset from '@/assets/treecheck-grounds-walkthrough-poster.jpg.asset.json';
import { assetUrl } from '@/lib/platform';
import { Smartphone, Apple, Monitor, Download, Share2, MoreVertical, Check, PlayCircle } from 'lucide-react';

type Device = 'ios' | 'android' | 'desktop';

function detectDevice(): Device {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

function useInstalled() {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    try {
      const mq = window.matchMedia('(display-mode: standalone)');
      const update = () => setInstalled(mq.matches || (navigator as any).standalone === true);
      update();
      mq.addEventListener?.('change', update);
      return () => mq.removeEventListener?.('change', update);
    } catch {
      // ignore
    }
  }, []);
  return installed;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 border-t py-4 text-foreground first:border-t-0">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
        {n}
      </span>
      <div className="pt-0.5 text-base leading-snug">{children}</div>
    </li>
  );
}

function IOSInstructions() {
  return (
    <ol className="divide-y">
      <Step n={1}>
        Open this link in <strong>Safari</strong>. If it opened inside Messages, tap the Safari icon to continue there.
      </Step>
      <Step n={2}>
        Tap the <strong>Share</strong> button{' '}
        <Share2 className="inline h-5 w-5 align-text-bottom text-primary" /> at the bottom of Safari.
      </Step>
      <Step n={3}>
        Scroll down and tap <strong>Add to Home Screen</strong>.
      </Step>
      <Step n={4}>
        Tap <strong>Add</strong>. Find the TREECHECK icon on your phone's Home Screen and open it.
      </Step>
    </ol>
  );
}

function AndroidInstructions() {
  return (
    <ol className="divide-y">
      <Step n={1}>
        Open this page in <strong>Chrome</strong> on your Android phone.
      </Step>
      <Step n={2}>
        Tap the <strong>three-dot menu</strong> <MoreVertical className="inline h-4 w-4 align-text-bottom text-primary" />{' '}
        at the top right of the browser.
      </Step>
      <Step n={3}>
        Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>, depending on your phone).
      </Step>
      <Step n={4}>
        Tap <strong>Add</strong> or <strong>Install</strong>. Find the TREECHECK icon on your Home Screen and open it.
      </Step>
    </ol>
  );
}

function DesktopInstructions() {
  return (
    <div className="text-base text-foreground leading-relaxed">
      <p className="mb-3">
        You're on a computer right now. To put the app on your phone, open this same page on your phone's browser
        (Safari on iPhone, Chrome on Android) and follow the steps shown there.
      </p>
      <p>
        Easiest way: text or email yourself this link and open it on your phone:
        <br />
        <span className="font-mono text-xs break-all text-foreground">app.treecheck.ai/crew-install</span>
      </p>
    </div>
  );
}

export default function CrewInstall() {
  const [device, setDevice] = useState<Device>('desktop');
  const installed = useInstalled();

  useEffect(() => {
    setDevice(detectDevice());
  }, []);

  return (
    <div className="crew-install-guide min-h-screen bg-background px-4 py-6 text-foreground sm:py-10">
      <Card className="mx-auto w-full max-w-2xl bg-card text-card-foreground">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <img src={treecheckLogo} alt="TREECHECK Logo" className="h-16 w-auto object-contain" />
          </div>
          <CardTitle className="text-2xl sm:text-3xl">Watch the video. Add TREECHECK to your phone.</CardTitle>
          <CardDescription className="text-base text-foreground">
            Start with this two-minute walkthrough, then follow the steps for your phone. No app store is needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section aria-labelledby="walkthrough-title" className="space-y-3">
            <div className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-primary" />
              <h2 id="walkthrough-title" className="text-lg font-bold">First, see how it works</h2>
            </div>
            <div className="mx-auto w-full max-w-sm overflow-hidden rounded-md border bg-card">
              <video
                className="mx-auto block aspect-[720/1558] max-h-[70vh] w-full bg-card object-contain"
                src={assetUrl(walkthroughVideoAsset)}
                controls
                playsInline
                preload="metadata"
                poster={assetUrl(walkthroughPosterAsset)}
                aria-label="TreeCheck ground crew walkthrough"
              >
                Your browser does not support video playback.
              </video>
            </div>
            <a
              href={assetUrl(walkthroughVideoAsset)}
              target="_blank"
              rel="noreferrer"
              className="block text-center text-sm font-bold text-primary underline underline-offset-4"
            >
              Video not showing? Tap here to watch it.
            </a>
          </section>

          <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <Check className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <p className="text-sm leading-snug">
              <strong>No sign-up needed.</strong> Your account is already created — the text message you received has
              your login email and temporary password. Add the app below, then sign in.
            </p>
          </div>
          {installed && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <Check className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-primary">You're all set</p>
                <p className="text-xs text-foreground mt-1">
                  The app is already on this phone. Open it from your home screen and sign in.
                </p>
              </div>
            </div>
          )}

          {!installed && device === 'desktop' && (
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <Monitor className="h-5 w-5 text-primary" /> Open this page on your phone
              </div>
              <DesktopInstructions />
            </div>
          )}

          {!installed && (
            <section aria-labelledby="install-title" className="space-y-3">
              <div>
                <h2 id="install-title" className="text-xl font-bold">Next, add it to your Home Screen</h2>
                <p className="mt-1 text-sm text-foreground">Choose your phone. Do not skip this step.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className={`rounded-md border p-4 ${device === 'ios' ? 'border-primary bg-primary/5' : 'bg-card'}`}>
                  <div className="mb-2 flex items-center gap-2 text-lg font-bold">
                    <Apple className="h-5 w-5 text-primary" /> iPhone
                    {device === 'ios' && <span className="ml-auto text-xs font-semibold text-primary">YOUR PHONE</span>}
                  </div>
                  <IOSInstructions />
                </div>
                <div className={`rounded-md border p-4 ${device === 'android' ? 'border-primary bg-primary/5' : 'bg-card'}`}>
                  <div className="mb-2 flex items-center gap-2 text-lg font-bold">
                    <Smartphone className="h-5 w-5 text-primary" /> Android
                    {device === 'android' && <span className="ml-auto text-xs font-semibold text-primary">YOUR PHONE</span>}
                  </div>
                  <AndroidInstructions />
                </div>
              </div>
            </section>
          )}

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold mb-1">
              <Download className="h-4 w-4 text-primary" />
              Finally, sign in
            </div>
            <p className="text-sm text-foreground leading-snug">
              Open TREECHECK from your Home Screen. Use the email and temporary password in your invitation text.
              You'll change your password after you sign in.
            </p>
            <Button asChild className="w-full mt-3">
              <Link to="/login">Sign in now</Link>
            </Button>
          </div>

          <p className="text-xs text-foreground text-center leading-relaxed">
            Keep TREECHECK on your Home Screen. New work notifications arrive by text and inside the app.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
