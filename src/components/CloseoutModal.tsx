import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Star, CheckCircle2, Sparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useDMAIntegration, useDMASubscription } from '@/hooks/useDMA';
import { DMAComposerDialog } from '@/components/DMAComposerDialog';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  purchaseId: string;
  leadId: string;
  customerName: string;
  customerPhone?: string | null;
  existing?: {
    id: string;
    sale_amount: number;
    notes: string | null;
    review_requested: boolean;
    review_requested_at: string | null;
  } | null;
}

export function CloseoutModal({ open, onOpenChange, purchaseId, leadId, customerName, customerPhone, existing }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: integration } = useDMAIntegration();
  const { data: subscription } = useDMASubscription();
  const hasDMAAccess = subscription?.subscribed === true || subscription?.beta_enabled === true;
  const [dmaComposerOpen, setDmaComposerOpen] = useState(false);
  const [dmaTeaserOpen, setDmaTeaserOpen] = useState(false);

  const [saleAmount, setSaleAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [closeoutId, setCloseoutId] = useState<string | null>(null);
  const [reviewRequested, setReviewRequested] = useState(false);
  const [missingLinkAlert, setMissingLinkAlert] = useState(false);

  useEffect(() => {
    if (open) {
      setSaleAmount(existing ? String(existing.sale_amount) : '');
      setNotes(existing?.notes || '');
      setCloseoutId(existing?.id || null);
      setReviewRequested(!!existing?.review_requested);
    }
  }, [open, existing]);

  const reviewLink = integration?.google_review_link || null;

  const save = async () => {
    const amt = parseFloat(saleAmount);
    if (isNaN(amt) || amt < 0) {
      toast.error('Enter a valid sale amount');
      return;
    }
    setSaving(true);
    const payload = {
      purchase_id: purchaseId,
      lead_id: leadId,
      contractor_id: user!.id,
      sale_amount: amt,
      notes: notes || null,
    };
    const { data, error } = await supabase
      .from('lead_closeouts' as any)
      .upsert(payload, { onConflict: 'purchase_id' })
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const newCloseoutId = (data as any).id;
    setCloseoutId(newCloseoutId);
    qc.invalidateQueries({ queryKey: ['lead-closeouts'] });
    toast.success('Job closed out!');

    // Fire-and-forget: push completed job + invoice to Jobber.
    (async () => {
      const { data: jd, error: je } = await supabase.functions.invoke('send-closeout-to-jobber', {
        body: { closeout_id: newCloseoutId },
      });
      const errMsg = (jd as any)?.error || je?.message;
      if (errMsg) {
        if (String(errMsg).toLowerCase().includes('not connected')) {
          toast.message('Connect Jobber to auto-send invoices', {
            description: 'Closeout saved. Link your Jobber account in Integrations to push invoices automatically.',
          });
        } else {
          toast.error(`Jobber sync failed: ${errMsg}`);
        }
        return;
      }
      const reply = (jd ?? {}) as { invoice_number?: string | number | null; invoice_sent?: boolean; invoice_draft?: boolean };
      if (reply.invoice_number) {
        toast.success(
          reply.invoice_draft
            ? `Draft invoice #${reply.invoice_number} is in Jobber, ready to send`
            : reply.invoice_sent
            ? `Invoice #${reply.invoice_number} sent in Jobber`
            : `Invoice #${reply.invoice_number} created in Jobber (send failed — open it there to email)`,
        );
      }
    })();
  };

  const [sending, setSending] = useState(false);
  const requestReview = async () => {
    if (!reviewLink) {
      setMissingLinkAlert(true);
      return;
    }
    if (!closeoutId) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke('send-review-request', {
      body: { closeout_id: closeoutId },
    });
    setSending(false);
    const errMsg = (data as any)?.error || error?.message;
    if (errMsg) {
      if ((data as any)?.code === 'missing_review_link') setMissingLinkAlert(true);
      else toast.error(errMsg);
      return;
    }
    setReviewRequested(true);
    qc.invalidateQueries({ queryKey: ['lead-closeouts'] });
    toast.success(`Review request sent to ${customerName.split(' ')[0]}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Closed out this job?</DialogTitle>
          <DialogDescription>
            Record the final sale price for {customerName} and ask them for a Google review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="sale-amount">How much did you sell the work for?</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="sale-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={saleAmount}
                onChange={(e) => setSaleAmount(e.target.value)}
                placeholder="0.00"
                className="pl-7"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="closeout-notes">Notes (optional)</Label>
            <Textarea
              id="closeout-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering about this job..."
              rows={3}
            />
          </div>

          {closeoutId && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Star className="h-4 w-4 text-primary" />
                Ask {customerName.split(' ')[0]} for a Google review
              </div>
              <Button
                type="button"
                variant={reviewRequested ? 'secondary' : 'default'}
                size="sm"
                onClick={requestReview}
                disabled={sending}
                className="w-full"
              >
                {sending ? (
                  <>Sending…</>
                ) : reviewRequested ? (
                  <><CheckCircle2 className="mr-2 h-4 w-4" />Review Requested — Send Again</>
                ) : (
                  <><Star className="mr-2 h-4 w-4" />Text Customer Google Review Request</>
                )}
              </Button>
            </div>
          )}

          {closeoutId && (
            <button
              type="button"
              onClick={() => hasDMAAccess ? setDmaComposerOpen(true) : setDmaTeaserOpen(true)}
              className="w-full rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-left transition hover:bg-primary/10"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                Turn this job into a featured project page
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Your DMA writes it, publishes it to your site, and posts it to Google + social.
              </div>
            </button>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {closeoutId ? 'Done' : 'Cancel'}
          </Button>
          {!closeoutId && (
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save closeout'}
            </Button>
          )}
          {closeoutId && (
            <Button onClick={save} disabled={saving} variant="secondary">
              {saving ? 'Saving…' : 'Update'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={missingLinkAlert} onOpenChange={setMissingLinkAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add your Google review link first</AlertDialogTitle>
            <AlertDialogDescription>
              You haven't set up your Google review link yet. Open <strong>Google Reviews</strong>, paste your Google review URL, and save. Then come back here and tap "Request Google Review" to send it to your customer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Link to="/dashboard/google-reviews" onClick={() => { setMissingLinkAlert(false); onOpenChange(false); }}>
                Go to Google Reviews
              </Link>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dmaTeaserOpen} onOpenChange={setDmaTeaserOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Digital Marketing Agent — coming soon</AlertDialogTitle>
            <AlertDialogDescription>
              The DMA turns every finished job into a featured page on your site, posts it to Google + social, and mails branded postcards to the neighbors — turning one tree into a whole street of leads. Want a 30-minute walkthrough?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction asChild>
              <a
                href="https://calendly.com/hello-tradesmarketing/30min"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setDmaTeaserOpen(false)}
              >
                Schedule a demo
              </a>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DMAComposerDialog
        open={dmaComposerOpen}
        onOpenChange={setDmaComposerOpen}
        customerName={customerName}
      />
    </Dialog>
  );
}
