import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/useProfile';
import { cn } from '@/lib/utils';
import { DEMO_SWITCH_OPTIONS } from '@/lib/demo/demoLogins';

/**
 * Event demo only: switches to another demo login in one tap, from a short list (the Timber demo pair and the
 * large-company demo's owner and crew leader). Shown only to sandbox logins. The demo-switch function hands over a
 * one-time sign-in for the chosen login, so no password is kept here, and this never signs out (signing out is global
 * and would also end real sessions).
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

  const switchLogin = async (to: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('demo-switch', { body: { to } });
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={compact ? 'secondary' : 'outline'}
          size={compact ? 'sm' : 'default'}
          disabled={busy}
          className={cn(!compact && 'w-full justify-start', className)}
        >
          <Repeat className={cn('h-4 w-4', !compact && 'mr-3')} />
          {compact ? 'Demo' : 'Switch demo login'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {DEMO_SWITCH_OPTIONS.map((o) => (
          <DropdownMenuItem key={o.key} disabled={busy} onSelect={() => switchLogin(o.key)}>{o.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
