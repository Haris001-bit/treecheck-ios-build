import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';

/**
 * Floating button shown after an iOS → Web handoff so the contractor can pop
 * back into the TreeCheck app at any time. Visibility is driven by a
 * sessionStorage flag set on `/mobile/unlock?from=ios` (or when ?intent= is
 * present, since that route is iOS-only).
 */
export function ReturnToAppButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const flag = sessionStorage.getItem('ios_handoff');
      const params = new URLSearchParams(window.location.search);
      if (params.get('from') === 'ios' || params.get('intent')) {
        sessionStorage.setItem('ios_handoff', '1');
        setVisible(true);
      } else if (flag === '1') {
        setVisible(true);
      }
    } catch {
      // ignore
    }
  }, []);

  if (!visible) return null;

  const back = () => {
    const deep = 'treecheck://';
    const fallback = '/app/lead-unlocked';
    try {
      window.location.href = deep;
      setTimeout(() => { window.location.href = fallback; }, 800);
    } catch {
      window.location.href = fallback;
    }
  };

  const dismiss = () => {
    try { sessionStorage.removeItem('ios_handoff'); } catch {}
    setVisible(false);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg pl-4 pr-2 py-2">
      <button onClick={back} className="flex items-center gap-2 text-sm font-medium">
        <ExternalLink className="h-4 w-4" />
        Return to TreeCheck App
      </button>
      <Button
        variant="ghost"
        size="sm"
        onClick={dismiss}
        className="h-7 px-2 text-primary-foreground hover:bg-primary-foreground/10"
        aria-label="Dismiss"
      >
        ✕
      </Button>
    </div>
  );
}
