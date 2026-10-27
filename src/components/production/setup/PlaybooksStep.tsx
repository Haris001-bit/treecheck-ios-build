import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { starterDefinition } from '@/lib/production/starter';
import { taskTitle } from '@/lib/production/playbooks';
import { TASK_KINDS, type PlaybookRule, type TaskKind } from '@/lib/production/rules';
import { Section, TextField, ChoiceField, NumberField } from './fields';
import { keyFor } from './keys';
import type { StepProps } from './types';

const TASK_LABELS: Record<TaskKind, string> = {
  utility_contact: 'Contact the utility', utility_disconnect: 'Arrange a line drop', locate_request: 'Locate request (OKIE)',
  material_check: 'Check or order materials', rental: 'Reserve or rent equipment', vendor: 'Book an outside vendor',
  gate_code: 'Get the gate code', accounting: 'Internal adjustment', custom: 'Other task',
};
const FLAGS: [string, string][] = [
  ['utility_requirement=SAFETY_TRIM', 'Utilities: safety trim'], ['utility_requirement=LINE_DROP', 'Utilities: line drop'],
  ['utility_requirement=OKIE_LOCATE', 'Utilities: OKIE locate'], ['equipment_requirement=CRANE', 'Crane'],
  ['equipment_requirement=GRAPPLE', 'Grapple truck'], ['equipment_requirement=AIRSPADE', 'AirSpade'],
  ['scheduling_priority=ASAP', 'ASAP'], ['scheduling_priority=PRIORITY', 'Priority'], ['access=GATED', 'Gated access'], ['access=REAR', 'Rear yard access'],
];
type Due = 'immediate' | 'before_job' | 'days';

export function PlaybooksStep({ def, update }: StepProps) {
  const starter = useMemo(() => starterDefinition().playbooks, []);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<string>(FLAGS[0][0]);
  const [task, setTask] = useState<TaskKind>('custom');
  const has = (k: string) => def.playbooks.some((r) => r.key === k);
  const custom = def.playbooks.filter((r) => !starter.some((s) => s.key === r.key));

  const toggle = (rule: PlaybookRule, on: boolean) => update((d) => {
    if (on && !d.playbooks.some((r) => r.key === rule.key)) d.playbooks.push(structuredClone(rule));
    if (!on) d.playbooks = d.playbooks.filter((r) => r.key !== rule.key);
  });

  const addCustom = () => {
    if (!name.trim()) return;
    update((d) => {
      const when = trigger.startsWith('service:') ? { service: trigger.slice(8) } : { flag: { name: trigger.split('=')[0], value: trigger.split('=')[1] } };
      d.playbooks.push({ key: keyFor(name, d.playbooks.map((r) => r.key)), name: name.trim().slice(0, 120), when, actions: [{ kind: 'task', task, due: 'before_job', title: task === 'custom' ? name.trim().slice(0, 120) : undefined }] });
    });
    setName('');
  };

  return (
    <div className="space-y-4">
      <Section title="What happens when work is sold" hint="When an approved job includes one of these, TreeCheck adds the task to its work packet automatically, so nobody has to remember.">
        {[...starter, ...custom].map((rule) => {
          const live = def.playbooks.find((r) => r.key === rule.key);
          const on = has(rule.key);
          return (
            <div key={rule.key} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-sm">{rule.name}</div>
                <div className="flex items-center gap-2">
                  <Switch checked={on} aria-label={`Use ${rule.name}`} onCheckedChange={(c) => toggle(rule, c)} />
                  {!starter.some((s) => s.key === rule.key) && <Button size="icon" variant="ghost" aria-label={`Remove ${rule.name}`} onClick={() => toggle(rule, false)}><Trash2 className="w-4 h-4" /></Button>}
                </div>
              </div>
              {on && live && live.actions.map((a, ai) => a.kind === 'task' && (
                <div key={ai} className="grid gap-2 sm:grid-cols-[2fr_1fr_6rem] items-end">
                  <TextField label="Task" value={a.title ?? taskTitle(a.task)} max={120}
                    onChange={(v) => update((d) => { const r = d.playbooks.find((x) => x.key === rule.key); const act = r?.actions[ai]; if (act && act.kind === 'task') act.title = v || undefined; })} />
                  <ChoiceField<Due> label="Due" value={typeof a.due === 'string' ? a.due : 'days'}
                    options={[['immediate', 'Right away'], ['before_job', 'Before the job'], ['days', 'Days after approval']]}
                    onChange={(v) => update((d) => { const r = d.playbooks.find((x) => x.key === rule.key); const act = r?.actions[ai]; if (act && act.kind === 'task') act.due = v === 'days' ? { daysAfterApproval: 3 } : v; })} />
                  {typeof a.due === 'object' && (
                    <NumberField label="Days" max={365} value={a.due.daysAfterApproval}
                      onChange={(v) => update((d) => { const r = d.playbooks.find((x) => x.key === rule.key); const act = r?.actions[ai]; if (act && act.kind === 'task') act.due = { daysAfterApproval: Math.round(v ?? 0) }; })} />
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </Section>

      <Section title="Add your own step">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Name" value={name} onChange={setName} max={120} placeholder="For example: call the HOA" />
          <ChoiceField label="When the job has" value={trigger} onChange={setTrigger}
            options={[...FLAGS, ...def.services.map((s) => [`service:${s.key}`, s.name] as [string, string])]} />
          <ChoiceField<TaskKind> label="Task" value={task} onChange={setTask} options={TASK_KINDS.map((t) => [t, TASK_LABELS[t]] as [TaskKind, string])} />
        </div>
        <Button size="sm" onClick={addCustom} disabled={!name.trim()}><Plus className="w-4 h-4 mr-1" />Add step</Button>
      </Section>
    </div>
  );
}
