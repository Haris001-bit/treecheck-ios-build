import type { ReactNode } from 'react';
import type { Permissions } from '@/lib/pricing/catalog';
import { useCompanyPermission } from '@/hooks/useCompanyPermission';
import { useFreePlan } from '@/hooks/useFreePlan';

/** allowFree: a Free-plan owner gets the preview version of this screen (the server limits what it returns). */
export function CompanyPermissionGate({ permission, children, allowFree = false }: { permission: keyof Permissions; children: ReactNode; allowFree?: boolean }) {
  const access = useCompanyPermission(permission);
  const free = useFreePlan();
  if (allowFree && free.data?.plan === 'free' && free.data.is_owner) return <>{children}</>;
  if (access.isLoading || (allowFree && free.isLoading)) return <div className="p-6 text-muted-foreground">Checking access…</div>;
  if (!access.data) return <div className="p-6 text-muted-foreground">Your company owner has not granted this access.</div>;
  return <>{children}</>;
}
