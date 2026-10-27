import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

// Reset links can land on any page (e.g. the site's home when the requested return address
// isn't allowed). Wherever they land, send the person to choose a new password first.
export function PasswordRecoveryRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname !== '/reset-password' && window.location.hash.includes('type=recovery')) {
      navigate('/reset-password' + window.location.hash, { replace: true });
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && window.location.pathname !== '/reset-password') {
        navigate('/reset-password', { replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
