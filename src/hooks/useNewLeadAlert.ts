import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function useNewLeadAlert() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!user) return;

    // Skip alerts for the first few seconds to avoid alerting on existing data
    const timer = setTimeout(() => {
      initialLoadDone.current = true;
    }, 3000);

    const channel = supabase
      .channel('new-leads')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'leads',
        },
        (payload) => {
          if (!initialLoadDone.current) return;

          const newLead = payload.new as { city?: string; estimated_cost_min?: number; estimated_cost_max?: number };

          // Refresh the leads list
          queryClient.invalidateQueries({ queryKey: ['leads'] });

          // Play alert sound
          try {
            const audioCtx = new AudioContext();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            // Two-tone alert
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
            oscillator.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.15);
            gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
            
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.4);
          } catch {
            // Audio may be blocked by browser policy
          }

          // Vibrate
          try {
            if (navigator.vibrate) {
              navigator.vibrate([200, 100, 200]);
            }
          } catch {
            // Vibration not supported
          }

          // Show toast
          toast.success('🌳 New Lead Available!', {
            description: newLead.city
              ? `New tree removal lead in ${newLead.city} — $${newLead.estimated_cost_min?.toLocaleString()} to $${newLead.estimated_cost_max?.toLocaleString()}`
              : 'A new lead just came in. Check it out!',
            duration: 10000,
          });
        }
      )
      .subscribe();

    // When iPhone returns from background, the WebSocket is often dead.
    // Re-fetch leads and force-reconnect the channel on visibility change.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        queryClient.invalidateQueries({ queryKey: ['leads'] });
        queryClient.invalidateQueries({ queryKey: ['subscription'] });

        // Reconnect the realtime channel in case WebSocket died
        try {
          channel.unsubscribe();
          channel.subscribe();
        } catch {
          // ignore reconnect errors
        }
      }
    };

    const handleFocus = () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    };

    const handleOnline = () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      try {
        channel.unsubscribe();
        channel.subscribe();
      } catch {
        // ignore
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [user, queryClient]);
}
