import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useServiceAreas } from '@/hooks/useServiceAreas';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, MapPin, Phone, Unlock } from 'lucide-react';

const ACTIVE = ['oklahoma city', 'okc', 'edmond', 'austin', 'testville'];

export default function LeadsHub() {
  const { isAdmin } = useAuth();
  const { data: areas, isLoading } = useServiceAreas();
  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const active = isAdmin || (areas ?? []).some((a) => ACTIVE.some((c) => a.city.toLowerCase().includes(c)));
  if (active) return <Navigate to="/dashboard" replace />;

  const steps = [
    { icon: Phone, title: 'Homeowners ask for tree work', body: 'People in your area request quotes for tree removal, stump grinding and trimming.' },
    { icon: Unlock, title: 'You unlock the ones you want', body: 'See photos and job details first. Each lead goes to no more than 3 companies.' },
    { icon: MapPin, title: 'Only in your service area', body: 'You only see leads from the cities you serve.' },
  ];
  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <p className="text-sm font-bold uppercase tracking-wide text-primary">Coming soon</p>
        <h1 className="text-2xl font-display font-bold text-foreground">Homeowner leads</h1>
        <p className="text-muted-foreground mt-2">
          We send ready-to-quote homeowner leads to tree companies. We're not in your area yet, but we're expanding.
        </p>
      </div>
      {steps.map((s) => (
        <Card key={s.title}>
          <CardContent className="flex gap-4 p-4">
            <s.icon className="h-6 w-6 text-primary shrink-0" />
            <div>
              <p className="font-bold text-foreground">{s.title}</p>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
          </CardContent>
        </Card>
      ))}
      <p className="text-sm text-muted-foreground">Want leads in your city? Reach out through Support and we'll let you know when we launch there.</p>
    </div>
  );
}
