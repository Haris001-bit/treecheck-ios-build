import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Answers } from '@/lib/production/rules';
import { validatePastJobs } from '@/lib/production/validation';
import { dollars } from '@/lib/production/answers';
import { Section, MoneyField, TextField, ChoiceField } from './fields';
import { QuestionInputs } from './QuestionInputs';
import { today, type StepProps } from './types';

export function ValidateStep({ def, update }: StepProps) {
  const result = validatePastJobs(def, today());
  const [label, setLabel] = useState('');
  const [service, setService] = useState<string | undefined>(def.services[0]?.key);
  const [outcome, setOutcome] = useState<'won' | 'lost'>('won');
  const [answers, setAnswers] = useState<Answers>({});
  const [actual, setActual] = useState<number | undefined>();
  const svc = def.services.find((s) => s.key === service);

  const add = () => {
    if (!svc || !actual || !label.trim()) return;
    update((d) => {
      d.validation.jobs.push({
        id: `${Date.now()}`, label: label.trim().slice(0, 120), outcome, service: svc.key, actualPrice: actual,
        answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== null && v !== undefined && v !== '')) as Record<string, string | number | boolean>,
      });
    });
    setLabel(''); setAnswers({}); setActual(undefined);
  };

  return (
    <div className="space-y-4">
      <Section title="Check against past jobs" hint="Pick five jobs you won and two you lost. Enter what you knew at the time and what you quoted; TreeCheck prices them with this card so you can see where it's off before it goes live.">
        <div className="text-sm">
          {result.summary.won} won, {result.summary.lost} lost
          {result.summary.averageGapPct !== null && <> · average difference {Math.round(result.summary.averageGapPct * 100)}%</>}
          {result.ready ? <Badge className="ml-2">Ready</Badge> : <span className="block text-muted-foreground">{result.reason}</span>}
        </div>
        {result.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Job</th><th>Quoted</th><th>This card</th><th>Difference</th><th /></tr></thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{r.label}<span className="block text-xs text-muted-foreground">{r.service}, {r.outcome}</span></td>
                    <td>{dollars(r.actualPrice)}</td>
                    <td>{r.enginePrice !== null ? dollars(r.enginePrice) : <span className="text-destructive text-xs">{r.note}</span>}</td>
                    <td>{r.diffPct !== null && <Badge variant={r.flag === 'ok' ? 'secondary' : 'destructive'}>{r.diffPct > 0 ? '+' : ''}{Math.round(r.diffPct * 100)}%</Badge>}</td>
                    <td><Button size="icon" variant="ghost" aria-label={`Remove ${r.label}`} onClick={() => update((d) => { d.validation.jobs = d.validation.jobs.filter((j) => j.id !== r.id); })}><Trash2 className="w-4 h-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Add a past job">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Job" value={label} onChange={setLabel} max={120} placeholder="For example: oak removal, Elm St" />
          <ChoiceField label="Service" value={service} onChange={(v) => { setService(v); setAnswers({}); }} options={def.services.map((s) => [s.key, s.name] as [string, string])} />
          <ChoiceField<'won' | 'lost'> label="Outcome" value={outcome} onChange={setOutcome} options={[['won', 'We won it'], ['lost', 'We lost it']]} />
        </div>
        {svc && <QuestionInputs questions={svc.questions} answers={answers} onChange={setAnswers} idPrefix="past" />}
        <MoneyField label="What you quoted" value={actual} optional onChange={setActual} />
        <Button size="sm" onClick={add} disabled={!svc || !actual || !label.trim()}><Plus className="w-4 h-4 mr-1" />Add job</Button>
      </Section>

      <Section title="No past jobs?" hint="A brand new company can skip this with a short reason.">
        <TextField label="Reason to skip" value={def.validation.skippedReason ?? ''} max={300} onChange={(v) => update((d) => { d.validation.skippedReason = v || undefined; })} />
      </Section>
    </div>
  );
}
