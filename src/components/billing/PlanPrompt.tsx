// What a locked screen shows once the company plans are open on the website (payments milestone, 2026-10-21), in
// place of the old $50 Scout checkout: one way in, the plan picker.
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CATALOG, formatCents } from '@/lib/pricing/catalog';

export function PlanPrompt({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-lg mx-auto py-10">
      <Card>
        <CardContent className="p-6 space-y-4 text-center">
          <Lock className="w-8 h-8 mx-auto text-primary" />
          <h2 className="text-xl font-black">{title}</h2>
          <p>{body}</p>
          <p className="font-bold">From {formatCents(CATALOG.core.month)}/month, or {formatCents(CATALOG.core.month + CATALOG.scout.month)}/month with a Scout license</p>
          <Button asChild className="w-full"><Link to="/dashboard/plans">Choose a plan</Link></Button>
          <p className="text-xs text-muted-foreground">14 days free if your company hasn't had a trial. Cancel anytime before it ends and you won't be charged.</p>
        </CardContent>
      </Card>
    </div>
  );
}
