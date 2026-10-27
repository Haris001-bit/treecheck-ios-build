import { useState } from 'react';
import { Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { publishBlockers } from '@/lib/production/contradictions';
import { validatePastJobs } from '@/lib/production/validation';
import type { CardRow } from '@/lib/production/client';
import { Section, TextField } from './fields';
import { today, type StepProps } from './types';

export function PublishStep({ def, goTo, label, setLabel, published, onPublish, flush }: StepProps & {
  label: string; setLabel: (v: string) => void; published: CardRow[];
  onPublish: (i: { effectiveFrom: string; label?: string }) => Promise<{ version: number }>; flush: () => Promise<void>;
}) {
  const [from, setFrom] = useState(today());
  const [busy, setBusy] = useState(false);
  const blockers = publishBlockers(def);
  const check = validatePastJobs(def, today());
  const ready = blockers.length === 0 && check.ready && from >= today();

  const publish = async () => {
    setBusy(true);
    try {
      await flush();
      const r = await onPublish({ effectiveFrom: from, label: label.trim() || undefined });
      toast.success(`Version ${r.version} published`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not publish');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Section title="Publish" hint="Salespeople quote from the published card. Once published it never changes: to change prices later, edit and publish a new version. Quotes already sent stay on the version they were priced with.">
        <ul className="text-sm space-y-1">
          <li>{blockers.length === 0 ? 'Every rule is settled.' : <button type="button" className="text-primary underline" onClick={() => goTo('review')}>{blockers.length} open item{blockers.length === 1 ? '' : 's'} to settle</button>}</li>
          <li>{check.ready ? 'Checked against past jobs.' : <button type="button" className="text-primary underline" onClick={() => goTo('validate')}>{check.reason}</button>}</li>
          <li>{def.services.filter((s) => s.offered !== false).length} services offered, {def.crews.length} crews.</li>
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name for this version" value={label} onChange={setLabel} max={120} placeholder="For example: Fall 2026 rates" />
          <div className="space-y-1">
            <Label htmlFor="effective-from" className="text-xs">Prices apply from</Label>
            <Input id="effective-from" type="date" min={today()} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
        </div>
        <Button onClick={publish} disabled={!ready || busy}>
          {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Rocket className="w-4 h-4 mr-1" />}Publish
        </Button>
      </Section>
      {published.length > 0 && (
        <Section title="Versions">
          {published.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0 text-sm">
              <span>Version {c.version}{c.label ? `: ${c.label}` : ''}</span>
              <span className="flex items-center gap-2 text-muted-foreground">
                from {c.effective_from}
                <Badge variant={c.status === 'published' ? 'default' : 'secondary'}>{c.status === 'published' ? 'Live' : 'Archived'}</Badge>
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
