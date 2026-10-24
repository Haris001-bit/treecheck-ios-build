import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Flag, Loader2, Star } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const CREW_TAGS = ['On time', 'Safe', 'Quality work', 'Equipment ready', 'Good communication'];
const COMPANY_TAGS = ['Paid on time', 'Clear scope', 'Safe site', 'Fair', 'Good communication'];

export function Stars({ value, onChange, size = 'md' }: { value: number; onChange?: (v: number) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} aria-label={`${n} stars`}>
          <Star className={cn(size === 'sm' ? 'w-4 h-4' : 'w-7 h-7', n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')} />
        </button>
      ))}
    </div>
  );
}

/** Gold 5-star display for a rating; supports half stars. */
export function StarRow({ value, size = 'sm' }: { value: number; size?: 'sm' | 'md' }) {
  const v = Math.max(0, Math.min(5, Math.round(value * 2) / 2));
  const cls = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <div className="flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="relative inline-block leading-none">
          <Star className={cn(cls, 'text-muted-foreground/40')} />
          {v >= n && <Star className={cn(cls, 'absolute inset-0 fill-amber-400 text-amber-400')} />}
          {v < n && v >= n - 0.5 && (
            <span className="absolute inset-0 overflow-hidden" style={{ width: '50%' }}>
              <Star className={cn(cls, 'fill-amber-400 text-amber-400')} />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/** Shows gold stars plus 4.6 (12), or "New" when there are no ratings yet. */
export function RatingBadge({ avg, count }: { avg: number | null | undefined; count?: number | null }) {
  if (avg == null || (count ?? 0) < 1) return <span className="text-xs">New</span>;
  return (
    <span className="text-xs font-bold inline-flex items-center gap-1">
      <StarRow value={Number(avg)} />
      {Number(avg).toFixed(1)}{count ? ` (${count})` : ''}
    </span>
  );
}

interface Target { user_id: string; name: string; type: 'crew' | 'company'; trade: string | null; my_stars: number | null }
interface AboutMe { revealed: boolean; from: string; stars?: number; tags?: string[]; comment?: string | null; reveal_at?: string | null }

/** Rate everyone on a completed job (owner rates subs, sub rates the company). */
export function RateJobDialog({ bidRequestId, open, onOpenChange }: { bidRequestId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [aboutMe, setAboutMe] = useState<AboutMe[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [active, setActive] = useState<Target | null>(null);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!bidRequestId) return;
    setTargets(null);
    setAboutMe([]);
    const { data, error } = await supabase.functions.invoke('review-submit', { body: { action: 'targets', bid_request_id: bidRequestId } });
    if (error || data?.error) { toast.error(data?.error || 'Could not load'); onOpenChange(false); return; }
    setTargets(data.targets);
    setAboutMe(data.about_me ?? []);
    setTitle(data.title ?? null);
  };
  useEffect(() => { if (open) { load(); setActive(null); } }, [open, bidRequestId]);

  const pick = (t: Target) => { setActive(t); setStars(0); setTags([]); setComment(''); };

  const submit = async () => {
    if (!active || !bidRequestId || !stars) return;
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('review-submit', {
      body: { action: 'submit', bid_request_id: bidRequestId, reviewee_user_id: active.user_id, stars, tags, comment: comment || null },
    });
    setSaving(false);
    if (error || data?.error) return toast.error(data?.error || 'Could not save rating');
    toast.success(data.held_for_review ? 'Thanks. Your comment is being checked before it posts.' : 'Thanks for rating!');
    setActive(null);
    load();
  };

  const tagList = active?.type === 'company' ? COMPANY_TAGS : CREW_TAGS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{aboutMe.length ? 'Your review' : 'Rate this job'}</DialogTitle>
          <DialogDescription>{title ? `${title}. ` : ''}Ratings stay private until both sides rate, or 14 days pass.</DialogDescription>
        </DialogHeader>
        {targets && !active && aboutMe.map((r, i) => (
          <div key={i} className="rounded-md border p-3 space-y-1">
            <div className="text-xs font-bold">{r.from} rated you</div>
            {r.revealed ? (
              <>
                <div className="flex items-center gap-2"><StarRow value={r.stars ?? 0} size="md" /><span className="text-sm font-bold">{(r.stars ?? 0).toFixed(1)}</span></div>
                {(r.tags ?? []).length > 0 && <div className="flex flex-wrap gap-1">{(r.tags ?? []).map((t) => <span key={t} className="rounded-full border px-2 py-0.5 text-[11px]">{t}</span>)}</div>}
                {r.comment && <p className="text-sm whitespace-pre-wrap">{r.comment}</p>}
              </>
            ) : (
              <p className="text-sm">Hidden until you rate them below{r.reveal_at ? `, or until ${new Date(r.reveal_at).toLocaleDateString()}` : ''}. Then you'll see it right here.</p>
            )}
          </div>
        ))}
        {!targets ? (
          <div className="py-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : active ? (
          <div className="space-y-4">
            <div className="font-bold">{active.name}</div>
            <Stars value={stars} onChange={setStars} />
            <div className="flex flex-wrap gap-2">
              {tagList.map((t) => (
                <button key={t} type="button"
                  onClick={() => setTags((c) => c.includes(t) ? c.filter((x) => x !== t) : [...c, t])}
                  className={cn('rounded-full border px-3 py-1 text-xs font-bold', tags.includes(t) ? 'border-primary bg-primary/10' : 'border-input')}>
                  {t}
                </button>
              ))}
            </div>
            <Textarea rows={3} maxLength={1000} placeholder="Anything else? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setActive(null)}>Back</Button>
              <Button className="flex-1" disabled={!stars || saving} onClick={submit}>
                {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Submit rating
              </Button>
            </div>
          </div>
        ) : targets.length === 0 ? (
          <p className="text-sm">No one was hired on this job, so there's nobody to rate.</p>
        ) : (
          <div className="space-y-2">
            {targets.map((t) => (
              <div key={t.user_id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-bold">{t.name}</div>
                  {t.trade && <div className="text-xs capitalize">{t.trade}</div>}
                </div>
                {t.my_stars ? <Stars value={t.my_stars} size="sm" /> : <Button size="sm" onClick={() => pick(t)}>Rate</Button>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const REPORT_REASONS = [
  { key: 'offensive', label: 'Offensive language' },
  { key: 'false', label: 'False or not about this job' },
  { key: 'personal_info', label: 'Shares personal information' },
  { key: 'harassment', label: 'Harassment' },
  { key: 'other', label: 'Other' },
];

/** List of reviews about someone, with Report and (for the reviewee) a one-time reply. */
export function ReviewsDialog({ userId, name, open, onOpenChange }: { userId: string | null; name: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user, effectiveContractorId } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['reviews-about', userId],
    enabled: open && !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('reviews')
        .select('id, stars, tags, comment, comment_hidden, response, created_at, reviewee_user_id')
        .eq('reviewee_user_id', userId).eq('status', 'published').lte('revealed_at', new Date().toISOString())
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data as any[];
    },
  });
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState('offensive');
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const isMe = userId === user?.id || userId === effectiveContractorId;

  const report = async (id: string) => {
    const { error } = await (supabase as any).from('review_reports').insert({ review_id: id, reporter_user_id: user?.id, reason });
    if (error) return toast.error('Could not send report');
    toast.success('Reported. Our team will take a look.');
    setReporting(null);
  };
  const sendReply = async (id: string) => {
    const { data, error } = await supabase.functions.invoke('review-submit', { body: { action: 'respond', review_id: id, response: reply } });
    if (error || data?.error) return toast.error(data?.error || 'Could not post reply');
    setReplyFor(null); setReply('');
    qc.invalidateQueries({ queryKey: ['reviews-about', userId] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Reviews for {name}</DialogTitle></DialogHeader>
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : !data?.length ? (
          <p className="text-sm">No reviews yet.</p>
        ) : (
          <div className="space-y-3">
            {data.map((r) => (
              <div key={r.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Stars value={r.stars} size="sm" />
                  <span className="text-xs">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                </div>
                {r.tags?.length > 0 && <div className="text-xs">{r.tags.join(' · ')}</div>}
                {r.comment && !r.comment_hidden && <p className="text-sm">{r.comment}</p>}
                {r.response && <p className="text-sm border-l-2 border-primary pl-2">Reply: {r.response}</p>}
                <div className="flex gap-3">
                  <button type="button" className="text-xs inline-flex items-center gap-1" onClick={() => setReporting(reporting === r.id ? null : r.id)}>
                    <Flag className="w-3 h-3" />Report
                  </button>
                  {isMe && !r.response && (
                    <button type="button" className="text-xs" onClick={() => setReplyFor(r.id)}>Reply</button>
                  )}
                </div>
                {reporting === r.id && (
                  <div className="flex gap-2">
                    <Select value={reason} onValueChange={setReason}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{REPORT_REASONS.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" onClick={() => report(r.id)}>Send</Button>
                  </div>
                )}
                {replyFor === r.id && (
                  <div className="space-y-2">
                    <Textarea rows={2} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} />
                    <Button size="sm" disabled={!reply.trim()} onClick={() => sendReply(r.id)}>Post reply</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
