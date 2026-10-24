import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ExternalLink, Sparkles } from 'lucide-react';
import DMAJobSubmission, { DMAResult } from '@/components/DMAJobSubmission';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerName: string;
}

/**
 * DMA composer flow launched from the closeout modal:
 * 1) Render the DMAJobSubmission form (photos + voice memo)
 * 2) On success, show a recap (1-2 photos + the AI-generated "what we did" paragraph)
 * 3) Then surface the postcards-to-neighbors CTA (Calendly teaser for now)
 */
export function DMAComposerDialog({ open, onOpenChange, customerName }: Props) {
  const [postcardTeaserOpen, setPostcardTeaserOpen] = useState(false);
  const firstName = customerName?.split(' ')[0] || 'the customer';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Featured project page</DialogTitle>
          <DialogDescription>
            Snap a couple of photos and a quick voice note — your DMA writes the page and publishes it.
          </DialogDescription>
        </DialogHeader>

        <DMAJobSubmission
          renderSuccess={({ result, previews, reset }) => (
            <div className="space-y-5">
              <div className="text-center space-y-1">
                <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
                <h3 className="text-lg font-bold text-foreground">Published — here's what we did</h3>
                <p className="text-sm text-muted-foreground">
                  Live on your site in 1–2 min.
                </p>
              </div>

              {previews.length > 0 && (
                <div className={`grid gap-2 ${previews.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {previews.slice(0, 2).map((src, i) => (
                    <div key={i} className="aspect-[4/3] rounded-lg overflow-hidden border border-border bg-muted">
                      <img src={src} alt={`Job photo ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What we did</div>
                <p className="text-sm text-foreground leading-relaxed">
                  {result.shortDescription || result.title}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button variant="outline" size="sm" asChild className="flex-1">
                  <a href={result.url} target="_blank" rel="noopener noreferrer">
                    View on your site <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button variant="ghost" size="sm" onClick={reset} className="flex-1">
                  Post another job
                </Button>
              </div>

              <button
                type="button"
                onClick={() => setPostcardTeaserOpen(true)}
                className="w-full rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 text-left transition hover:bg-primary/10"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  📬 Want to send postcards to {firstName}'s neighbors?
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  We'll turn this story into a postcard and mail it to 50 nearby homes.
                </div>
              </button>
            </div>
          )}
        />
      </DialogContent>

      <AlertDialog open={postcardTeaserOpen} onOpenChange={setPostcardTeaserOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Neighbor Postcards — coming soon</AlertDialogTitle>
            <AlertDialogDescription>
              Your DMA will summarize this featured project into a branded postcard and mail it to the 50 closest homes — turning one tree into a whole street of leads. Want a 30-minute walkthrough?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction asChild>
              <a
                href="https://calendly.com/hello-tradesmarketing/30min"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setPostcardTeaserOpen(false)}
              >
                Schedule a demo
              </a>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
