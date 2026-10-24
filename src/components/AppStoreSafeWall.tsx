/**
 * Neutral "not available on mobile" wall for App Store safe mode.
 *
 * Wraps any page that would otherwise contain purchase / subscription / pricing UI.
 * Per Apple's guidelines, native iOS must not direct users off-app to purchase, so
 * we show a fully neutral, non-commercial empty state with no website link, no
 * "go to the web" copy, no pricing, and no upsell.
 */

import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { isAppStoreSafeMode } from '@/lib/platform';
import { useAuth } from '@/lib/auth';
import { RefreshCcw, LogOut } from 'lucide-react';
import { SafeModeSubscriptionNotice } from '@/components/SafeModeSubscriptionNotice';

interface Props {
  /** Where to redirect on iOS instead of showing this page. If omitted, render wall in place. */
  redirectTo?: string;
  /** Override the wall body when rendered in place. */
  title?: string;
  body?: string;
  children?: React.ReactNode;
}

export function AppStoreSafeWall({ redirectTo, title, body, children }: Props) {
  const safeMode = isAppStoreSafeMode();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  if (!safeMode) return <>{children}</>;
  if (redirectTo) return <Navigate to={redirectTo} replace />;

  const handleRefresh = () => {
    queryClient.invalidateQueries();
  };

  return (
    <div className="p-4 sm:p-8 flex flex-col items-center justify-center min-h-[60vh]">
      <SafeModeSubscriptionNotice title={title} body={body} />
    </div>
  );
}
