import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

type Msg = { id: string; sender_user_id: string; sender_name: string | null; sender_side: 'office' | 'crew'; body: string; created_at: string };

interface Props {
  bidRequestId: string;
  crewMemberId: string;
  /** Which side the viewer is on. */
  side: 'office' | 'crew';
  /** Name of the other party, shown in the header. */
  otherName: string;
  jobTitle: string;
  /** Optional button text (defaults to "Messages"). */
  label?: string;
}

/** Private thread between the office and one sub on one job. */
export function JobChat({ bidRequestId, crewMemberId, side, otherName, jobTitle, label }: Props) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('job_messages')
      .select('id, sender_user_id, sender_name, sender_side, body, created_at')
      .eq('bid_request_id', bidRequestId).eq('crew_member_id', crewMemberId)
      .order('created_at', { ascending: true });
    setMsgs((data ?? []) as Msg[]);
  }, [bidRequestId, crewMemberId]);

  const loadRead = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('job_message_reads').select('last_read_at')
      .eq('user_id', user.id).eq('bid_request_id', bidRequestId).eq('crew_member_id', crewMemberId).maybeSingle();
    setLastRead(data?.last_read_at ?? null);
  }, [user, bidRequestId, crewMemberId]);

  useEffect(() => { load(); loadRead(); }, [load, loadRead]);

  useEffect(() => {
    const ch = supabase.channel(`job-chat-${bidRequestId}-${crewMemberId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'job_messages', filter: `bid_request_id=eq.${bidRequestId}`,
      }, (p) => { if ((p.new as any).crew_member_id === crewMemberId) load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [bidRequestId, crewMemberId, load]);

  // Deep link from the text: ?job=<id>&chat=<crewMemberId>
  useEffect(() => {
    if (params.get('chat') === crewMemberId && params.get('job') === bidRequestId) {
      setOpen(true);
      const next = new URLSearchParams(params); next.delete('chat'); setParams(next, { replace: true });
    }
  }, [params, setParams, crewMemberId, bidRequestId]);

  const markRead = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    setLastRead(now);
    await supabase.from('job_message_reads').upsert(
      { user_id: user.id, bid_request_id: bidRequestId, crew_member_id: crewMemberId, last_read_at: now },
      { onConflict: 'user_id,bid_request_id,crew_member_id' },
    );
  }, [user, bidRequestId, crewMemberId]);

  useEffect(() => {
    if (!open) return;
    markRead();
    setTimeout(() => bottom.current?.scrollIntoView({ block: 'end' }), 50);
  }, [open, msgs.length, markRead]);

  const unread = msgs.filter((m) => m.sender_user_id !== user?.id && m.sender_side !== side
    && (!lastRead || m.created_at > lastRead)).length;

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke('job-message-send', {
      body: { bid_request_id: bidRequestId, crew_member_id: crewMemberId, body },
    });
    setSending(false);
    if (error || data?.error) {
      toast.error(typeof data?.error === 'string' ? data.error : "Couldn't send the message");
      return;
    }
    setText('');
    load();
    if (data?.alerted === false) toast.warning('Message saved — the text alert failed to send.');
    else if (data?.alerted === true) toast.success('Message sent');
    else toast.success('Message saved');
  };

  return (
    <>
      <Button
        size="sm"
        className={`h-8 relative shadow-sm ${unread > 0 ? 'animate-pulse-glow ring-2 ring-destructive/50' : ''}`}
        onClick={() => setOpen(true)}
      >
        <MessageSquare className="w-4 h-4 mr-1.5" />
        <span className="font-semibold">{label ?? 'Messages'}{msgs.length ? ` (${msgs.length})` : ''}</span>
        {unread > 0 && (
          <span className="ml-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 leading-none shadow">
            {unread} new
          </span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg flex flex-col max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>{otherName}</DialogTitle>
            <DialogDescription>
              {jobTitle} · {side === 'office' ? 'Only you, your office team and this person see this.' : 'Private between you and the office.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2 min-h-[160px] pr-1">
            {msgs.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No messages yet.</p>
            )}
            {msgs.map((m) => {
              const mine = m.sender_side === side;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`text-[10px] mt-1 ${mine ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      {m.sender_name || (m.sender_side === 'office' ? 'Office' : 'Crew')} · {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottom} />
          </div>
          <div className="space-y-2 pt-2 border-t">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 2000))}
              placeholder="Type a message…"
              rows={3}
            />
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-muted-foreground">They get a text saying they have a message.</span>
              <Button size="sm" onClick={send} disabled={sending || !text.trim()}>
                {sending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}Send
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
