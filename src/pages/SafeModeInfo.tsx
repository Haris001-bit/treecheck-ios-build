import { Navigate } from 'react-router-dom';
import { SafeModeSubscriptionNotice } from '@/components/SafeModeSubscriptionNotice';
import { useAuth } from '@/lib/auth';
import { useIsCrewOnly } from '@/hooks/useCrew';
import { canUseStorePlans } from '@/lib/platform';

export default function SafeModeInfo() {
  const { isTeamMember } = useAuth();
  const { isCrewOnly, loading } = useIsCrewOnly();
  const storePlans = canUseStorePlans();
  // Where the app sells the plans itself (Apple or Google), a company owner gets the plan screen, never a notice that
  // subscriptions happen outside the app (Apple's 1.2 review landed here from Subs and couldn't find the plans).
  if (storePlans && !isTeamMember && loading) return null;
  if (storePlans && !isTeamMember && !isCrewOnly) return <Navigate to="/plan" replace />;
  return (
    <div className="p-4 sm:p-8 flex flex-col items-center justify-center min-h-[60vh]">
      <SafeModeSubscriptionNotice />
    </div>
  );
}
