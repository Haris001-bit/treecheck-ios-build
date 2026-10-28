import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  useTeamSeats, useTeamMembers, useTeamInvitations,
  useSetTeamSeatQuantity, useInviteTeamMember, useRemoveTeamMember
} from '@/hooks/useTeam';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Minus, Trash2, Copy, Mail, Crown, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { isNativeStoreBilling } from '@/lib/platform';
import { TeamDirectory } from '@/components/TeamDirectory';
import { useCompanyBilling } from '@/hooks/useCompanyBilling';
import { CompanyTeamAccess } from '@/components/CompanyTeamAccess';

/** Phone apps: the team list with call/text/email only. No seats, prices or invites (Apple 3.1.1, Google Play billing). */
function NativeTeam() {
  const { isTeamMember } = useAuth();
  const { data: members = [], isLoading } = useTeamMembers();
  if (isTeamMember) {
    return (
      <div className="p-6 max-w-2xl">
        <Card>
          <CardHeader><CardTitle>Team</CardTitle></CardHeader>
          <CardContent>You're a team member. Only the company owner can manage the team.</CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="p-4 sm:p-6 max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Office team</h1>
      <Card>
        <CardHeader><CardTitle>Team members ({members.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading team…</p> : <TeamDirectory members={members} />}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Team() {
  // The phone apps manage no seats or billing, so they get the price-free team list.
  if (isNativeStoreBilling()) return <NativeTeam />;
  return <WebTeam />;
}

function WebTeam() {
  const { user, isFounder, isTeamMember } = useAuth();
  const { data: seats } = useTeamSeats();
  const { data: members = [] } = useTeamMembers();
  const { data: invites = [] } = useTeamInvitations();
  const setQty = useSetTeamSeatQuantity();
  const invite = useInviteTeamMember();
  const remove = useRemoveTeamMember();
  const companyBilling = useCompanyBilling();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [savingAutoApprove, setSavingAutoApprove] = useState(false);
  const [confirmAddOpen, setConfirmAddOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('scout_auto_approve_reps').eq('id', user.id).maybeSingle()
      .then(({ data }) => setAutoApprove(!!(data as any)?.scout_auto_approve_reps));
  }, [user?.id]);

  const handleAutoApproveChange = async (value: boolean) => {
    if (!user) return;
    setSavingAutoApprove(true);
    setAutoApprove(value);
    const { error } = await supabase.from('profiles').update({ scout_auto_approve_reps: value } as any).eq('id', user.id);
    setSavingAutoApprove(false);
    if (error) {
      setAutoApprove(!value);
      toast.error('Could not update setting');
    } else {
      toast.success(value ? 'Reps can now approve their own Scout submissions' : 'Scout submissions now require your approval');
    }
  };

  if (isTeamMember) {
    return (
      <div className="p-6 max-w-2xl">
        <Card>
          <CardHeader><CardTitle>Team</CardTitle></CardHeader>
          <CardContent>You're a team member. Only the company owner can manage the team.</CardContent>
        </Card>
      </div>
    );
  }

  if (companyBilling.isLoading) return <div className="p-6">Loading team…</div>;
  if (companyBilling.data?.billing?.pricing_version === '2026-10') return <div className="p-6 max-w-3xl"><CompanyTeamAccess data={companyBilling.data} /></div>;

  const allowed = seats?.seat_quantity ?? 0;
  const used = members.length + invites.length;
  const handleAddSeat = () => {
    if (isFounder) { setQty.mutate(allowed + 1); return; }
    setConfirmAddOpen(true);
  };
  const confirmAddSeat = () => {
    setConfirmAddOpen(false);
    setQty.mutate(allowed + 1);
  };
  const handleRemoveSeat = () => {
    if (allowed <= used) {
      toast.error('Remove a team member first before removing a seat.');
      return;
    }
    setQty.mutate(Math.max(0, allowed - 1));
  };

  const handleInvite = async () => {
    if (!email.trim()) return;
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    let res: Awaited<ReturnType<typeof invite.mutateAsync>>;
    try {
      res = await invite.mutateAsync({
        email: email.trim(),
        phone: phone.trim() || undefined,
        fullName: fullName || undefined,
      });
    } catch {
      // The hook already showed why. Left uncaught, a refused invite (no free seat) reached the global error
      // reporter, which texts TreeCheck's admin.
      return;
    }
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    if (res.invite_url) {
      try { await navigator.clipboard.writeText(res.invite_url); } catch {}
    }
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="text-muted-foreground">Add workers from your company so they can see your leads and use the Digital Marketing Agent.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Seats
            {isFounder && <Badge variant="secondary"><Crown className="w-3 h-3 mr-1" />Founder — Free</Badge>}
          </CardTitle>
          <CardDescription>
            {isFounder ? 'You get unlimited free seats as a TreeCheck founder.' : '$9/month per added user. Billed to your card on file.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={handleRemoveSeat} disabled={setQty.isPending || allowed === 0}>
            <Minus className="w-4 h-4" />
          </Button>
          <div className="text-2xl font-bold w-12 text-center">{allowed}</div>
          <Button variant="outline" size="icon" onClick={handleAddSeat} disabled={setQty.isPending}>
            <Plus className="w-4 h-4" />
          </Button>
          <div className="text-sm text-muted-foreground ml-2">{used} of {allowed} used</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Scout™ approvals
          </CardTitle>
          <CardDescription>
            Choose whether your sales reps' Scout submissions need your approval before they're final.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="space-y-1 pr-4">
            <div className="text-sm font-medium">
              {autoApprove ? 'Reps can approve their own submissions' : 'I review every rep submission'}
            </div>
            <div className="text-xs text-muted-foreground">
              {autoApprove
                ? 'Sales reps see the AI estimate and can approve or edit it on their phone in the field.'
                : 'Sales reps capture the tree in the field. The AI estimate comes back to you to approve or edit before going final.'}
            </div>
          </div>
          <Switch
            checked={autoApprove}
            disabled={savingAutoApprove}
            onCheckedChange={handleAutoApproveChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Add a team member</CardTitle>
          <CardDescription>We'll send their invite plus a link to the video and iPhone/Android setup guide. Add a mobile number to text it as well.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite-first">First name</Label>
              <Input id="invite-first" placeholder="Lesley" value={firstName} onChange={e => setFirstName(e.target.value)} />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite-last">Last name</Label>
              <Input id="invite-last" placeholder="Edmond" value={lastName} onChange={e => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="worker@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite-phone">Mobile number</Label>
              <Input id="invite-phone" type="tel" placeholder="(615) 555-0134" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <Button onClick={handleInvite} disabled={invite.isPending || !email.trim()}>
              <Mail className="w-4 h-4 mr-2" />Invite
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Active members ({members.length})</CardTitle></CardHeader>
        <CardContent>
          <TeamDirectory
            members={members}
            action={(m) => (
              <Button variant="ghost" size="sm" aria-label={`Remove ${m.full_name || m.email}`} onClick={() => remove.mutate(m.id)} disabled={remove.isPending}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          />
        </CardContent>
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Pending invites ({invites.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {invites.map(i => {
              const url = `https://app.treecheck.ai/accept-invite?team_token=${i.invite_token}`;
              return (
                <div key={i.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <div className="font-medium">{i.email}</div>
                    <div className="text-xs text-muted-foreground">Expires {new Date(i.expires_at).toLocaleDateString()}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(url); toast.success('Link copied'); }}>
                    <Copy className="w-4 h-4 mr-1" />Copy link
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmAddOpen} onOpenChange={setConfirmAddOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a team seat for $9/month?</AlertDialogTitle>
            <AlertDialogDescription>
              This adds <strong>$9/month</strong> to your existing TreeCheck subscription
              (prorated for the rest of this billing cycle). You'll go from{' '}
              <strong>{allowed}</strong> seat{allowed === 1 ? '' : 's'} to{' '}
              <strong>{allowed + 1}</strong>. You can remove the seat anytime to stop the charge.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAddSeat}>Add seat — $9/mo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
