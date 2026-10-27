import { Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Answers, RateCardDefinition } from '@/lib/production/rules';
import type { PricedItem } from '@/lib/production/estimate';
import { isMaterialOverride, isOffered, type LineKind } from '@/lib/production/pricing';
import { headcountOf } from '@/lib/production/productionRules';
import { dollars } from '@/lib/production/answers';
import { QuestionInputs } from '@/components/production/setup/QuestionInputs';
import { ChoiceField, MoneyField } from '@/components/production/setup/fields';
import { today } from '@/components/production/setup/types';
import { rememberChoice, startingAnswers, type ItemDraft } from './choices';

export function WorkItemCard({ def, item, priced, onChange, onRemove, canSeeSteps = true }: {
  def: RateCardDefinition; item: ItemDraft; priced: PricedItem | undefined; onChange: (i: ItemDraft) => void; onRemove: () => void; canSeeSteps?: boolean;
}) {
  const service = def.services.find((s) => s.key === item.serviceKey);
  const offered = def.services.filter((s) => isOffered(s, today()).kind === 'ok');
  const st = service?.strategy;
  const set = (patch: Partial<ItemDraft>) => onChange({ ...item, ...patch });
  // Anything the salesperson picks or types counts as known, and stops being outlined as uncertain.
  const answer = (next: Answers) => {
    const changed = Object.keys(next).filter((k) => next[k] !== item.answers[k]);
    set({
      answers: next,
      answerSources: { ...(item.answerSources ?? {}), ...Object.fromEntries(changed.map((k) => [k, 'known' as const])) },
      uncertain: (item.uncertain ?? []).filter((k) => !changed.includes(k)),
    });
  };
  const engine = priced?.engineAmount ?? null;
  const material = engine !== null && item.sell !== null && item.sell !== undefined && isMaterialOverride(engine, item.sell);
  const direction = engine !== null && item.sell !== null && item.sell !== undefined && item.sell < engine ? 'lower' : 'higher';
  const reasons = def.policies.overrideReasons?.[direction] ?? ['Other'];

  return (
    <Card className="p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <ChoiceField className="flex-1 min-w-[10rem]" label="Service" value={item.serviceKey}
          options={offered.map((s) => [s.key, s.name] as [string, string])}
          onChange={(v) => onChange({ ...item, serviceKey: v, answers: startingAnswers(def, v), answerSources: {}, sell: null, overrideReason: null, uncertain: [] })} />
        <ChoiceField<LineKind> className="w-36" label="On the quote" value={item.kind}
          options={[['required', 'Required'], ['recommended', 'Recommended'], ['optional', 'Optional']]} onChange={(v) => set({ kind: v })} />
        <Button size="icon" variant="ghost" aria-label="Remove this work" onClick={onRemove}><Trash2 className="w-4 h-4" /></Button>
      </div>
      {service && st?.kind === 'crew_time' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {def.crews.filter((c) => (service.questions.find((q) => q.key === st.crewQuestion)?.choices ?? []).some((ch) => ch.value === c.key)).map((c) => (
              <Button key={c.key} type="button" size="sm" variant={item.answers[st.crewQuestion] === c.key ? 'default' : 'outline'}
                onClick={() => { rememberChoice(service.key, c.key, item.answers[st.hoursQuestion] as number | undefined); answer({ ...item.answers, [st.crewQuestion]: c.key }); }}>
                {headcountOf(c)}-person
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {[[def.pricing.dayHours / 2, '½ day'], [def.pricing.dayHours, 'Full day'], [2, '2 hr'], [4, '4 hr'], [6, '6 hr']].map(([h, l]) => (
              <Button key={String(l)} type="button" size="sm" variant={Number(item.answers[st.hoursQuestion]) === h ? 'default' : 'outline'}
                onClick={() => { rememberChoice(service.key, item.answers[st.crewQuestion] as string | undefined, Number(h)); answer({ ...item.answers, [st.hoursQuestion]: Number(h) }); }}>{l}</Button>
            ))}
          </div>
        </div>
      )}
      {service && (
        <QuestionInputs questions={service.questions.filter((q) => !(st?.kind === 'crew_time' && (q.key === st.crewQuestion)))} answers={item.answers}
          uncertain={item.uncertain} idPrefix={`item-${item.id}`}
          onChange={answer} />
      )}
      <div className="rounded-md bg-muted p-3 text-sm space-y-2">
        {priced?.status === 'ok' || priced?.status === 'needs_reason' ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-lg font-semibold">{dollars(priced.price ?? engine ?? 0)}</span>
              {priced.production && <span className="text-xs text-muted-foreground">{priced.production.headcount}-person crew, {priced.production.hours} hr, {priced.production.manHours} man-hours</span>}
            </div>
            {canSeeSteps && <ul className="text-xs text-muted-foreground">{priced.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>}
            {item.kind !== 'required' && <Badge variant="secondary">{item.kind === 'recommended' ? 'Recommended option' : 'Optional'}</Badge>}
          </>
        ) : (
          <span className={priced?.status === 'blocked' || priced?.status === 'not_offered' ? 'text-destructive' : 'text-muted-foreground'}>{priced?.message ?? 'Pick a service'}</span>
        )}
        {engine !== null && (
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr] items-end">
            <MoneyField label="Change the price" optional value={item.sell ?? undefined} onChange={(v) => set({ sell: v ?? null, overrideReason: v === undefined ? null : item.overrideReason })} />
            {material && (
              <div className="flex flex-wrap gap-1">
                {reasons.map((r) => <Button key={r} type="button" size="sm" variant={item.overrideReason === r ? 'default' : 'outline'} onClick={() => set({ overrideReason: r })}>{r}</Button>)}
              </div>
            )}
          </div>
        )}
        {priced?.status === 'needs_reason' && <p className="text-xs text-destructive">Pick why the price is {direction}.</p>}
      </div>
    </Card>
  );
}
