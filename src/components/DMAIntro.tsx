import { Globe, ClipboardCopy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PRODUCT_MARKETING_URLS } from '@/hooks/useEntitlements';
import { openOutside } from '@/lib/openOutside';

/** Shown on Marketing to owners whose plan doesn't include it yet: what it is, and the copy-and-paste way to try it. */
export default function DMAIntro({ onCopyPaste }: { onCopyPaste: () => void }) {
  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Globe className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div className="space-y-1">
          <h2 className="font-semibold text-foreground">Built for TreeCheck's First Impression websites</h2>
          <p className="text-sm text-muted-foreground">
            The Marketing Agent is designed to work with First Impression websites. Finish a job, snap a few photos, and it
            publishes the job to your site for you.
          </p>
        </div>
      </div>
      {/* Also in the phone apps (Haris, 2026-11-06), where it opens in the in-app browser. */}
      <Button variant="outline" className="w-full" onClick={() => void openOutside(PRODUCT_MARKETING_URLS.dma_web)}>
        Learn more <ExternalLink className="ml-2 h-4 w-4" />
      </Button>
      <div className="border-t border-border pt-4 space-y-2">
        <div className="flex items-start gap-3">
          <ClipboardCopy className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-foreground">Already have a website?</div>
            <p className="text-sm text-muted-foreground">Use copy-and-paste posts. Scout writes the post from your job photos and notes, and you paste it into your own site. Try a few sample posts free.</p>
          </div>
        </div>
        <Button className="w-full" onClick={onCopyPaste}>Try copy-and-paste posts</Button>
      </div>
    </section>
  );
}
