import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Answers, Question } from '@/lib/production/rules';
import { clampTyped, RATE_CARD_MONEY_MAX } from '@/lib/inputLimits';
import { cn } from '@/lib/utils';

/** The questions of one service as a small form. Uncertain answers (from the AI) are outlined for the person to check. */
export function QuestionInputs({ questions, answers, onChange, uncertain = [], compact, idPrefix }: {
  questions: Question[]; answers: Answers; onChange: (a: Answers) => void; uncertain?: string[]; compact?: boolean; idPrefix: string;
}) {
  const set = (k: string, v: Answers[string]) => onChange({ ...answers, [k]: v });
  return (
    <div className={cn('grid gap-3', compact ? 'grid-cols-2' : 'sm:grid-cols-2')}>
      {questions.map((q) => {
        const id = `${idPrefix}-${q.key}`;
        const flag = uncertain.includes(q.key);
        const label = <Label htmlFor={id} className="text-xs">{q.label}{q.unit ? ` (${q.unit})` : ''}{q.required ? '' : ' (optional)'}{flag ? ' · check' : ''}</Label>;
        const v = answers[q.key];
        if (q.kind === 'yes_no') {
          return (
            <div key={q.key} className={cn('flex items-center justify-between gap-2 rounded-md border p-2', flag && 'border-amber-500')}>
              {label}
              <Switch id={id} checked={v === true || v === 'yes'} onCheckedChange={(c) => set(q.key, c)} />
            </div>
          );
        }
        if (q.kind === 'choice') {
          return (
            <div key={q.key} className="space-y-1">
              {label}
              <Select value={v === null || v === undefined ? undefined : String(v)} onValueChange={(x) => set(q.key, x)}>
                <SelectTrigger id={id} className={cn(flag && 'border-amber-500')}><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>{(q.choices ?? []).map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          );
        }
        if (q.kind === 'text') {
          return (
            <div key={q.key} className="space-y-1">
              {label}
              <Input id={id} value={v === null || v === undefined ? '' : String(v)} maxLength={200} className={cn(flag && 'border-amber-500')}
                onChange={(e) => set(q.key, e.target.value)} />
            </div>
          );
        }
        const max = q.max ?? (q.kind === 'count' ? 1000 : RATE_CARD_MONEY_MAX);
        return (
          <div key={q.key} className="space-y-1">
            {label}
            <Input id={id} type="number" inputMode="decimal" min={0} step={q.kind === 'count' ? 1 : 'any'} className={cn(flag && 'border-amber-500')}
              value={v === null || v === undefined ? '' : String(v)}
              onChange={(e) => set(q.key, e.target.value === '' ? null : (q.kind === 'count' ? Math.round(clampTyped(e.target.value, max)) : clampTyped(e.target.value, max)))} />
          </div>
        );
      })}
    </div>
  );
}
