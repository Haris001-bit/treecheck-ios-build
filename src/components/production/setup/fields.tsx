import { useEffect, useId, useState, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clampTyped, RATE_CARD_MONEY_MAX } from '@/lib/inputLimits';
import { cn } from '@/lib/utils';

export function Section({ title, hint, action, children, className }: { title: string; hint?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <Card className={cn('p-4 space-y-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** A price in dollars. Blank means "not set" when `optional`, otherwise 0. */
export function MoneyField({ label, value, onChange, optional, max = RATE_CARD_MONEY_MAX, className }: {
  label: string; value: number | null | undefined; onChange: (v: number | undefined) => void; optional?: boolean; max?: number; className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <div className="relative">
        <span className="absolute left-2 top-2 text-sm text-muted-foreground">$</span>
        <Input id={id} type="number" inputMode="decimal" min={0} className="pl-5" value={value ?? ''}
          placeholder={optional ? 'None' : '0'}
          onChange={(e) => onChange(optional && e.target.value === '' ? undefined : clampTyped(e.target.value, max))} />
      </div>
    </div>
  );
}

export function NumberField({ label, value, onChange, unit, max = 100_000, optional, step, className }: {
  label: string; value: number | null | undefined; onChange: (v: number | undefined) => void; unit?: string; max?: number; optional?: boolean; step?: number; className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <div className="flex items-center gap-1">
        <Input id={id} type="number" inputMode="decimal" min={0} step={step} value={value ?? ''} placeholder={optional ? 'None' : '0'}
          onChange={(e) => onChange(optional && e.target.value === '' ? undefined : clampTyped(e.target.value, max))} />
        {unit && <span className="text-xs text-muted-foreground whitespace-nowrap">{unit}</span>}
      </div>
    </div>
  );
}

export function TextField({ label, value, onChange, multiline, max = 300, placeholder, className }: {
  label: string; value: string | undefined; onChange: (v: string) => void; multiline?: boolean; max?: number; placeholder?: string; className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {multiline
        ? <Textarea id={id} value={value ?? ''} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} rows={3} />
        : <Input id={id} value={value ?? ''} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

export function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <Label htmlFor={id} className="space-y-0.5 cursor-pointer">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground font-normal">{hint}</span>}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export function ChoiceField<T extends string>({ label, value, onChange, options, className }: {
  label: string; value: T | undefined; onChange: (v: T) => void; options: [T, string][]; className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger aria-label={label}><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}


/** A list typed as text (comma between, or one per line). Kept as typed while editing and saved on blur, so commas and new lines can be typed. */
export function ListField({ label, value, onChange, lines, max = 20, itemMax = 80, placeholder, className }: {
  label: string; value: string[]; onChange: (v: string[]) => void; lines?: boolean; max?: number; itemMax?: number; placeholder?: string; className?: string;
}) {
  const id = useId();
  const sep = lines ? '\n' : ', ';
  const [text, setText] = useState(value.join(sep));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(value.join(sep)); }, [value, editing, sep]);
  const commit = () => {
    setEditing(false);
    onChange(text.split(lines ? '\n' : ',').map((x) => x.trim()).filter(Boolean).slice(0, max).map((x) => x.slice(0, itemMax)));
  };
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {lines
        ? <Textarea id={id} rows={5} value={text} placeholder={placeholder} onFocus={() => setEditing(true)} onChange={(e) => setText(e.target.value)} onBlur={commit} />
        : <Input id={id} value={text} placeholder={placeholder} onFocus={() => setEditing(true)} onChange={(e) => setText(e.target.value)} onBlur={commit} />}
    </div>
  );
}
