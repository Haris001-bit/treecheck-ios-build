import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/useProfile';
import { cn } from '@/lib/utils';

/**
 * Event demo only (milestone 2): flips between the demo owner and the demo climber in one tap. Shown only to
 * sandbox logins. The demo-switch function hands over a one-time sign-in for the other login, so no password is
 * kept here, and this never signs out (signing out is global and would also end real sessions).
 */
export function DemoSwitchButton({
  compact = false,
  className,
  onSwitched,
}: {
  compact?: boolean;
  className?: string;
  onSwitched?: () => void;
}) {
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!profile?.is_sandbox) return null;

  const label = profile.account_type === 'subcontractor' ? 'Owner view' : 'Climber view';

  const switchLogin = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('demo-switch', { body: {} });
      const reply = (data ?? {}) as { token_hash?: string; open?: string; error?: string };
      if (error || !reply.token_hash) throw new Error(reply.error || 'Could not switch. Try again.');
      const { error: signInError } = await supabase.auth.verifyOtp({ token_hash: reply.token_hash, type: 'magiclink' });
      if (signInError) throw signInError;
      queryClient.clear();
      onSwitched?.();
      navigate(reply.open || '/dashboard', { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not switch. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant={compact ? 'secondary' : 'outline'}
      size={compact ? 'sm' : 'default'}
      disabled={busy}
      onClick={switchLogin}
      className={cn(!compact && 'w-full justify-start', className)}
    >
      <Repeat className={cn('h-4 w-4', !compact && 'mr-3')} />
      {compact ? label : `Switch to ${label.toLowerCase()}`}
    </Button>
  );
}
