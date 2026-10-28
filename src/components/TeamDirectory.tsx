import type { ReactNode } from 'react';
import { Mail, MessageSquare, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TeamMember } from '@/hooks/useTeam';

/** Digits (and a leading +) only, so tel:/sms: links open the dialer on every phone. */
export function dialable(phone: string | null | undefined): string | null {
  const cleaned = (phone ?? '').replace(/[^\d+]/g, '');
  return cleaned.replace(/\D/g, '').length >= 7 ? cleaned : null;
}

/**
 * Everyone under the owner's account, with one-tap call, text and email.
 * No prices or seat controls here, so it is safe in the phone apps.
 */
export function TeamDirectory({ members, action }: { members: TeamMember[]; action?: (m: TeamMember) => ReactNode }) {
  if (members.length === 0) return <p className="text-sm text-muted-foreground">No team members yet.</p>;
  return (
    <ul className="space-y-2">
      {members.map((m) => {
        const tel = dialable(m.phone);
        return (
          <li key={m.id} className="p-3 rounded-lg border space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{m.full_name || m.email}</div>
                <div className="text-sm text-muted-foreground break-all">{m.email}</div>
                {tel && (
                  <a href={`tel:${tel}`} className="text-sm text-primary underline underline-offset-2">
                    {m.phone}
                  </a>
                )}
              </div>
              {action?.(m)}
            </div>
            <div className="flex flex-wrap gap-2">
              {tel && (
                <>
                  <Button asChild size="sm" variant="outline">
                    <a href={`tel:${tel}`}><Phone className="w-4 h-4 mr-1.5" />Call</a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={`sms:${tel}`}><MessageSquare className="w-4 h-4 mr-1.5" />Text</a>
                  </Button>
                </>
              )}
              <Button asChild size="sm" variant="outline">
                <a href={`mailto:${m.email}`}><Mail className="w-4 h-4 mr-1.5" />Email</a>
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
