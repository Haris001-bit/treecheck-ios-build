import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { productionCall } from '@/hooks/useProductionWork';
import type { ProductionStatus } from '@/lib/production/client';
import type { ServicesPreview, TeamPreview } from '@/lib/production/jobberExtras';
import { Section } from './fields';

type Permission = boolean | null;
interface Probe { connected: boolean; users: Permission; requests: Permission; products: Permission; customFields: Permission; timeSheets?: Permission; expenses?: Permission }
interface Info { probe: Probe; counts: { services: number; team: number; fields: number } }

const NONE = '__none';
const PERMISSIONS: [keyof Omit<Probe, 'connected'>, string][] = [
  ['products', 'Products and services'], ['users', 'Users'], ['requests', 'Requests'], ['customFields', 'Custom fields'],
  ['timeSheets', 'Time sheets'], ['expenses', 'Expenses'],
];
/** Matching, requests and the quote fields need these four; time sheets and expenses only fill in actual hours. */
const CORE: (keyof Omit<Probe, 'connected'>)[] = ['products', 'users', 'requests', 'customFields'];
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');
const call = <T,>(body: Record<string, unknown>) => productionCall<T>('production-setup', body);

/**
 * Settings > Crews & pricing: the Jobber parts that wait on Jobber's approval of TreeCheck's app. Hidden until the
 * rollout switches them on (production_status.jobber_extras); each company then reconnects Jobber once.
 */
export function JobberExtrasCard({ status }: { status: ProductionStatus }) {
  return status.jobber_extras ? <ExtrasCard /> : null;
}

function ExtrasCard() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [services, setServices] = useState<ServicesPreview | null>(null);
  const [serviceChoice, setServiceChoice] = useState<Record<string, string | null>>({});
  const [team, setTeam] = useState<TeamPreview | null>(null);
  const [teamChoice, setTeamChoice] = useState<Record<string, string | null>>({});

  const run = async <T,>(key: string, body: Record<string, unknown>, then: (r: T) => void) => {
    setBusy(key);
    try {
      then(await call<T>(body));
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(null);
    }
  };
  const load = (refresh = false) => run<Info>('probe', { action: 'jobber_extras', refresh }, setInfo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const probe = info?.probe;
  const missing = !!probe && (!probe.connected || PERMISSIONS.some(([k]) => probe[k] === false));
  const ready = !!probe && probe.connected && CORE.every((k) => probe[k] !== false);
  // Every Jobber item or user once (duplicates in Jobber are left out), as [id, name].
  const jobberItems = services ? [...new Map<string, string>([
    ...services.matches.flatMap((m) => (m.productId ? [[m.productId, m.productName ?? '']] as [string, string][] : [])),
    ...services.unused.map((p) => [p.id, p.name] as [string, string]),
  ])] : [];
  const jobberUsers = team ? [...new Map<string, string>([
    ...team.matched.map((m) => [m.jobberUserId, m.jobberName] as [string, string]),
    ...team.onlyInJobber.map((u) => [u.id, u.name] as [string, string]),
  ])] : [];

  return (
    <Section title="Jobber" hint="Matches your services and team to Jobber, starts estimates from Jobber requests, adds TreeCheck's details to each quote, and fills in actual hours from Jobber's time sheets."
      action={<Button size="sm" variant="outline" disabled={!!busy} onClick={() => load(true)}>{busy === 'probe' && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Check again</Button>}>
      {!probe ? <p className="text-sm text-muted-foreground">Checking Jobber…</p> : (
        <div className="flex flex-wrap gap-1">
          {PERMISSIONS.map(([k, label]) => (
            <Badge key={k} variant={probe[k] ? 'default' : 'secondary'} className="gap-1">
              {probe[k] ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}{label}
            </Badge>
          ))}
        </div>
      )}
      {missing && (
        <div className="text-sm space-y-2">
          <p>{probe!.connected ? 'Jobber needs to be reconnected once so TreeCheck gets these permissions.' : "Jobber isn't connected."}</p>
          <Button asChild size="sm"><Link to="/dashboard/integrations/jobber">{probe!.connected ? 'Reconnect Jobber' : 'Connect Jobber'}</Link></Button>
        </div>
      )}

      {ready && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">Services ({info!.counts.services} matched)</div>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run<{ preview: ServicesPreview }>('services', { action: 'jobber_services' }, (r) => {
                setServices(r.preview);
                setServiceChoice(Object.fromEntries(r.preview.matches.map((m) => [m.serviceKey, m.productId])));
              })}>{busy === 'services' && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Match services</Button>
            </div>
            {services && (
              <div className="space-y-2">
                {services.matches.map((m) => (
                  <div key={m.serviceKey} className="grid gap-1 sm:grid-cols-2 sm:items-center">
                    <span className="text-sm">{m.serviceName}</span>
                    <Select value={serviceChoice[m.serviceKey] ?? NONE} onValueChange={(v) => setServiceChoice({ ...serviceChoice, [m.serviceKey]: v === NONE ? null : v })}>
                      <SelectTrigger aria-label={`Jobber item for ${m.serviceName}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not in Jobber</SelectItem>
                        {jobberItems.map(([pid, name]) => <SelectItem key={pid} value={pid}>{name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {services.duplicates.length > 0 && (
                  <p className="text-xs text-muted-foreground">Jobber has {services.duplicates.length} item{services.duplicates.length === 1 ? '' : 's'} listed twice ({services.duplicates.map((d) => d.name).join(', ')}). TreeCheck uses the first; you can tidy the others in Jobber.</p>
                )}
                {services.unused.length > 0 && (
                  <p className="text-xs text-muted-foreground">Not used by any service here: {services.unused.map((p) => p.name).join(', ')}.</p>
                )}
                <Button size="sm" disabled={!!busy} onClick={() => run<{ saved: number }>('services_save', { action: 'jobber_services_save', choice: serviceChoice }, (r) => {
                  toast.success(`Saved: ${r.saved} service${r.saved === 1 ? '' : 's'} use a Jobber item.`);
                  setServices(null);
                  void load();
                })}>Save services</Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">Team ({info!.counts.team} matched)</div>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run<{ preview: TeamPreview }>('team', { action: 'jobber_team' }, (r) => {
                setTeam(r.preview);
                setTeamChoice(Object.fromEntries([...r.preview.matched.map((m) => [m.userId, m.jobberUserId]), ...r.preview.onlyInTreeCheck.map((m) => [m.id, null])]));
              })}>{busy === 'team' && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Match team</Button>
            </div>
            {team && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">The Jobber user each person is. Quotes they write show them as the salesperson in Jobber.</p>
                {[...team.matched.map((m) => ({ id: m.userId, name: m.name })), ...team.onlyInTreeCheck].map((p) => (
                  <div key={p.id} className="grid gap-1 sm:grid-cols-2 sm:items-center">
                    <span className="text-sm break-all">{p.name}</span>
                    <Select value={teamChoice[p.id] ?? NONE} onValueChange={(v) => setTeamChoice({ ...teamChoice, [p.id]: v === NONE ? null : v })}>
                      <SelectTrigger aria-label={`Jobber user for ${p.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not in Jobber</SelectItem>
                        {jobberUsers.map(([uid, name]) => <SelectItem key={uid} value={uid}>{name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {team.onlyInJobber.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    In Jobber, not in TreeCheck: {team.onlyInJobber.map((u) => u.name).join(', ')}. <Link to="/dashboard/team" className="text-primary underline">Invite them from Team</Link>.
                  </p>
                )}
                <Button size="sm" disabled={!!busy} onClick={() => run<{ saved: number }>('team_save', { action: 'jobber_team_save', choice: teamChoice }, (r) => {
                  toast.success(`Saved: ${r.saved} ${r.saved === 1 ? 'person' : 'people'} matched.`);
                  setTeam(null);
                  void load();
                })}>Save team</Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <div className="font-medium">Quote fields ({info!.counts.fields} of 5 in Jobber)</div>
              <div className="text-xs text-muted-foreground">TreeCheck link, Production class, Required resources, Operational flags and Priority, filled on every crew quote and copied to its jobs.</div>
            </div>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run<{ created: number; reused: number }>('fields', { action: 'jobber_fields' }, (r) => {
              toast.success(r.created ? `Added ${r.created} field${r.created === 1 ? '' : 's'} to Jobber.` : 'The fields are already in Jobber.');
              void load();
            })}>{busy === 'fields' && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{info!.counts.fields >= 5 ? 'Check fields' : 'Add fields'}</Button>
          </div>
        </div>
      )}
    </Section>
  );
}
