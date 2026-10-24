import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { useAuth } from '@/lib/auth';

type View = 'right' | 'high' | 'low' | 'none';

export function buildVisitText(view: View, firstName: string, link: string, phone: string, signature: string) {
  const hi = `Hi${firstName ? ` ${firstName}` : ''}, thanks for your inquiry.`;
  const middle =
    view === 'low' ? "I saw the AI estimate, and it looks a little low. I'd like to swing by and take a look."
    : view === 'high' ? "I saw the AI estimate, and it looks a little high. I'd like to swing by and take a look, and I may be able to get you a better price."
    : view === 'right' ? "I saw the AI estimate, and it looks about right, but I'd like to swing by to confirm before we schedule."
    : "I'd like to swing by and take a look so I can give you an accurate price.";
  return `${hi} ${middle} It's a free estimate. Pick a time here: ${link}. This number can't take replies, but you can call me at ${phone}.${signature ? ` - ${signature}` : ''}`;
}

export function VisitTextDialog({ job, hasAiPrice, open, onOpenChange }: {
  job: any; hasAiPrice: boolean; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { user, effectiveContractorId } = useAuth();
  const { data: settings } = useCompanySettings();
  const s = (settings ?? {}) as any;
  const [link, setLink] = useState('');
  const [phone, setPhone] = useState('');
  const [sig, setSig] = useState('');
  const [view, setView] = useState<View>(hasAiPrice ? 'right' : 'none');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const firstName = String(job?.customer_name ?? '').trim().split(/\s+/)[0] ?? '';

  useEffect(() => {
    if (!open) return;
    setLink(s.visit_calendly_url ?? ''); setPhone(s.visit_callback_phone ?? ''); setSig(s.visit_signature ?? '');
    setView(hasAiPrice ? 'right' : 'none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings]);
  useEffect(() => { setText(buildVisitText(view, firstName, link || '[link]', phone || '[phone]', sig)); }, [view, link, phone, sig, firstName]);

  const missing = !link || !phone;
  const noPhone = String(job?.customer_phone ?? '').replace(/\D/g, '').length < 10;

  const send = async () => {
    setSending(true);
    try {
      const ownerId = effectiveContractorId ?? user?.id;
      if (ownerId && (link !== s.visit_calendly_url || phone !== s.visit_callback_phone || sig !== s.visit_signature)) {
        await supabase.from('company_settings').update({ visit_calendly_url: link, visit_callback_phone: phone, visit_signature: sig } as any).eq('contractor_id', ownerId);
        qc.invalidateQueries({ queryKey: ['company-settings'] });
      }
      const { data, error } = await supabase.functions.invoke('job-visit-text', {
        body: { bid_request_id: job.id, estimate_view: view, message: text },
      });
      if (error || data?.error) throw new Error(data?.error ?? "Couldn't send the text");
      toast.success(data?.sandbox ? 'Test job: marked, no real text sent' : 'Visit text sent. The office has been told.');
      qc.invalidateQueries({ queryKey: ['bid-requests'] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send the text");
    } finally { setSending(false); }
  };

  const opts: { v: View; label: string }[] = [
    { v: 'low', label: 'A little low' }, { v: 'right', label: 'About right' }, { v: 'high', label: 'A little high' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Schedule a site visit</DialogTitle>
          <DialogDescription>
            Text {job?.customer_name || 'the client'} a link to book a free visit. The job gets a "Needs site visit" label and the office is told.
          </DialogDescription>
        </DialogHeader>
        {noPhone ? (
          <p className="text-sm text-destructive">This job has no client mobile number, so a text can't be sent.</p>
        ) : (
          <div className="space-y-4">
            {hasAiPrice ? (
              <div>
                <Label className="text-xs">How does the AI estimate look?</Label>
                <div className="mt-1 flex gap-2 flex-wrap">
                  {opts.map((o) => (
                    <Button key={o.v} size="sm" type="button" variant={view === o.v ? 'default' : 'outline'} onClick={() => setView(o.v)}>{o.label}</Button>
                  ))}
                </div>
              </div>
            ) : <p className="text-xs text-muted-foreground">This job has no AI price, so the text doesn't mention one.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2"><Label className="text-xs">Scheduling link</Label><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://calendly.com/..." /></div>
              <div><Label className="text-xs">Call-back phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div><Label className="text-xs">Signature</Label><Input value={sig} onChange={(e) => setSig(e.target.value)} /></div>
            </div>
            <div>
              <Label className="text-xs">Text to {job?.customer_name || 'client'} (you can edit it)</Label>
              <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} maxLength={1200} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={send} disabled={sending || missing || text.trim().length < 10}>{sending ? 'Sending…' : 'Send text'}</Button>
            </div>
            {missing && <p className="text-xs text-muted-foreground">Add your scheduling link and call-back phone first. They're saved for next time.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
