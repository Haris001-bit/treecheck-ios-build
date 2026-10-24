import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronRight, History, Trash2, Users, Mail } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SendPostcardDialog } from '@/components/SendPostcardDialog';
import type { ScoutCapture } from '@/lib/estimatorService';

interface Props {
  onOpen: (capture: ScoutCapture) => void;
  refreshKey?: number;
}

const statusLabel: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  pending: { label: 'Analyzing', variant: 'secondary' },
  awaiting_review: { label: 'Ready to review', variant: 'default' },
  approved: { label: 'Approved', variant: 'outline' },
  edited: { label: 'Edited', variant: 'outline' },
};

export function RecentCaptures({ onOpen, refreshKey }: Props) {
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<ScoutCapture[] | null>(null);
  const [repNames, setRepNames] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<ScoutCapture | null>(null);
  const [postcardFor, setPostcardFor] = useState<ScoutCapture | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('scout_captures')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (cancelled) return;
      const list = (data ?? []) as ScoutCapture[];
      setRows(list);

      // Fetch display names for any rep that isn't the current user
      const otherIds = Array.from(new Set(
        list.map(r => r.contractor_id).filter(id => id && id !== user?.id),
      ));
      if (otherIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', otherIds);
        if (!cancelled && profs) {
          const map: Record<string, string> = {};
          for (const p of profs as Array<{ id: string; full_name: string | null; email: string }>) {
            map[p.id] = p.full_name || p.email || 'Team rep';
          }
          setRepNames(map);
        }
      } else {
        setRepNames({});
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey, reloadTick, user?.id]);

  const { mine, team } = useMemo(() => {
    const mine: ScoutCapture[] = [];
    const team: ScoutCapture[] = [];
    for (const r of rows ?? []) {
      if (user && r.contractor_id !== user.id) team.push(r);
      else mine.push(r);
    }
    return { mine, team };
  }, [rows, user?.id]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const paths = [pendingDelete.photo_path, pendingDelete.voice_memo_path].filter(Boolean) as string[];
      if (paths.length) await supabase.storage.from('scout-media').remove(paths);
      const { error } = await supabase.from('scout_captures').delete().eq('id', pendingDelete.id);
      if (error) throw error;
      toast.success('Capture deleted');
      setRows((r) => r?.filter((x) => x.id !== pendingDelete.id) ?? r);
      setPendingDelete(null);
      setReloadTick((t) => t + 1);
    } catch (e: any) {
      toast.error(e.message || 'Could not delete capture');
    } finally {
      setDeleting(false);
    }
  };

  if (rows === null) {
    return (
      <div className="mt-6 flex justify-center py-4 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  if (rows.length === 0) return null;

  const renderRow = (r: ScoutCapture) => {
    const meta = statusLabel[r.status] ?? { label: r.status, variant: 'outline' as const };
    const price = r.final_price_max ?? r.final_price_min ?? r.ai_price_max ?? r.ai_price_min;
    const service = r.final_service ?? r.ai_service ?? r.requested_service;
    const addr = [r.address_street, r.address_city].filter(Boolean).join(', ');
    const repName = user && r.contractor_id !== user.id ? (repNames[r.contractor_id] ?? 'Team rep') : null;
    return (
      <div key={r.id} className="flex items-center gap-1 hover:bg-muted/40 transition">
        <button
          type="button"
          onClick={() => onOpen(r)}
          className="flex-1 text-left flex items-center gap-3 p-3 min-w-0"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">
                {service || 'Pending analysis'}
              </span>
              <Badge variant={meta.variant} className="text-[10px] h-5">{meta.label}</Badge>
              {repName && (
                <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                  <Users className="w-3 h-3" />{repName}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {addr || 'No address'} · {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
            </div>
            {price != null && (
              <div className="text-sm font-semibold text-primary mt-0.5">
                ${Number(price).toLocaleString()}
              </div>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
        {isAdmin && r.address_street && r.address_city && r.address_state && r.address_zip && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPostcardFor(r); }}
            aria-label="Send postcard"
            title="Send postcard"
            className="p-3 text-muted-foreground hover:text-primary transition shrink-0"
          >
            <Mail className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPendingDelete(r); }}
          aria-label="Delete capture"
          className="p-3 text-muted-foreground hover:text-destructive transition shrink-0"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    );
  };

  return (
    <div className="mt-6 space-y-6">
      {team.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-muted-foreground">
            <Users className="w-4 h-4" /> Team submissions ({team.length})
          </div>
          <Card className="divide-y">{team.map(renderRow)}</Card>
        </div>
      )}

      {mine.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-muted-foreground">
            <History className="w-4 h-4" /> My recent captures
          </div>
          <Card className="divide-y">{mine.map(renderRow)}</Card>
        </div>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this capture?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the submission, its photo, and any voice memo. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SendPostcardDialog
        capture={postcardFor}
        open={!!postcardFor}
        onOpenChange={(o) => !o && setPostcardFor(null)}
      />
    </div>
  );
}
