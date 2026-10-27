import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { findContradictions, type Contradiction } from '@/lib/production/contradictions';
import { Section } from './fields';
import type { StepProps } from './types';

export function ReviewStep({ def, update, goTo }: StepProps) {
  const all = findContradictions(def);
  const open = all.filter((c) => c.blocking && !c.resolved);
  const warnings = all.filter((c) => !c.blocking && !c.resolved);
  const settled = all.filter((c) => c.resolved);
  const decide = (c: Contradiction, choice: string) => update((d) => {
    d.decisions = [...d.decisions.filter((x) => x.key !== c.key), { key: c.key, choice, at: new Date().toISOString().slice(0, 10) }];
  });
  const fix = (c: Contradiction) => goTo(c.kind === 'policy' ? 'policies' : c.kind === 'crew' ? 'crews' : 'pricing', c.serviceKey);

  return (
    <div className="space-y-4">
      <Section title={open.length ? `${open.length} open item${open.length === 1 ? '' : 's'}` : 'Nothing open'}
        hint="Places where your prices contradict themselves or aren't finished. TreeCheck never guesses: you decide once, and it applies to every salesperson.">
        {open.length === 0 && <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="w-4 h-4 text-primary" />Every rule is settled.</p>}
        {open.map((c) => (
          <div key={c.key} className="rounded-md border p-3 space-y-2">
            <p className="text-sm flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />{c.message}</p>
            <div className="flex flex-wrap gap-2">
              {c.choices?.map((ch) => <Button key={ch.value} size="sm" variant="outline" onClick={() => decide(c, ch.value)}>{ch.label}</Button>)}
              {!c.choices && <Button size="sm" variant="outline" onClick={() => fix(c)}>Fix it</Button>}
            </div>
          </div>
        ))}
      </Section>
      {warnings.length > 0 && (
        <Section title="Worth a look">
          <ul className="text-sm list-disc pl-5 space-y-1">{warnings.map((w) => <li key={w.key}>{w.message}</li>)}</ul>
        </Section>
      )}
      {settled.length > 0 && (
        <Section title="Settled">
          {settled.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 text-sm border-b py-2 last:border-0">
              <span className="min-w-0">{c.message}</span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">{c.choices?.find((x) => x.value === c.decision)?.label ?? c.decision}</span>
                <Button size="sm" variant="ghost" onClick={() => update((d) => { d.decisions = d.decisions.filter((x) => x.key !== c.key); })}>Change</Button>
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
