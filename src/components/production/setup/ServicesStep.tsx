import { useMemo, useState } from 'react';
import { FileUp, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { starterDefinition } from '@/lib/production/starter';
import { CATEGORIES, FULFILLMENT, type Category, type Strategy } from '@/lib/production/rules';
import type { ImportResult } from '@/hooks/useProductionSetup';
import { Section, ChoiceField, TextField } from './fields';
import { keyFor } from './keys';
import { blankService, CATEGORY_LABELS, STRATEGY_LABELS } from './serviceTemplates';
import { photoToDataUrl, fileToDataUrl, MAX_PDF_BYTES } from './sheetFiles';
import type { StepProps } from './types';

const FULFILLMENT_LABELS: Record<(typeof FULFILLMENT)[number], string> = {
  internal: 'Our crews', subcontractor: 'Subcontractor', vendor: 'Outside vendor', hybrid: 'Mixed',
};

export function ServicesStep(props: StepProps & { importSheet: (i: { text?: string; images?: string[]; pdf?: string }) => Promise<ImportResult> }) {
  const { def, update, goTo, importSheet } = props;
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<Strategy['kind']>('per_unit');
  const [newCat, setNewCat] = useState<Category>('other');
  const missingStarter = useMemo(() => starterDefinition().services.filter((s) => !def.services.some((x) => x.key === s.key)), [def.services]);

  const addCustom = () => {
    if (!newName.trim()) return;
    update((d) => { d.services.push(blankService(newKind, newName.trim().slice(0, 120), newCat, keyFor(newName, d.services.map((s) => s.key)), d.crews)); });
    setNewName('');
  };

  return (
    <div className="space-y-4">
      <SheetImport importSheet={importSheet} onUse={(r) => update((d) => { Object.assign(d, r.definition); })} />

      <Section title="Services you sell" hint="Turn off what you don't offer. Who does the work decides what happens after a sale: our crews get a work packet; subcontracted work can go out for sub bids.">
        {def.services.length === 0 && <p className="text-sm text-muted-foreground">No services yet.</p>}
        <div className="divide-y">
          {def.services.map((s, i) => (
            <div key={s.key} className="py-3 flex flex-wrap items-center gap-2">
              <Switch checked={s.offered !== false} aria-label={`Offer ${s.name}`} onCheckedChange={(c) => update((d) => { d.services[i].offered = c; })} />
              <Input value={s.name} maxLength={120} aria-label="Service name" className="flex-1 min-w-[10rem]"
                onChange={(e) => update((d) => { d.services[i].name = e.target.value || d.services[i].name; })} />
              <Badge variant="secondary">{CATEGORY_LABELS[s.category]}</Badge>
              <div className="w-40">
                <ChoiceField label="Done by" value={s.fulfillment ?? 'internal'} options={FULFILLMENT.map((f) => [f, FULFILLMENT_LABELS[f]] as [typeof f, string])}
                  onChange={(v) => update((d) => { d.services[i].fulfillment = v; })} />
              </div>
              <Button size="sm" variant="outline" onClick={() => goTo('pricing', s.key)}>Prices</Button>
              <Button size="icon" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => update((d) => { d.services.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>
      </Section>

      {missingStarter.length > 0 && (
        <Section title="Add a standard service">
          <div className="flex flex-wrap gap-2">
            {missingStarter.map((s) => (
              <Button key={s.key} size="sm" variant="outline" onClick={() => update((d) => { d.services.push(structuredClone(s)); })}><Plus className="w-4 h-4 mr-1" />{s.name}</Button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Add your own service">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Name" value={newName} onChange={setNewName} max={120} />
          <ChoiceField<Category> label="Kind of work" value={newCat} onChange={setNewCat} options={CATEGORIES.map((c) => [c, CATEGORY_LABELS[c]] as [Category, string])} />
          <ChoiceField<Strategy['kind']> label="How it's priced" value={newKind} onChange={setNewKind} options={(Object.keys(STRATEGY_LABELS) as Strategy['kind'][]).map((k) => [k, STRATEGY_LABELS[k]] as [Strategy['kind'], string])} />
        </div>
        <Button size="sm" onClick={addCustom} disabled={!newName.trim()}><Plus className="w-4 h-4 mr-1" />Add service</Button>
      </Section>
    </div>
  );
}

function SheetImport({ importSheet, onUse }: { importSheet: (i: { text?: string; images?: string[]; pdf?: string }) => Promise<ImportResult>; onUse: (r: ImportResult) => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const read = async () => {
    setBusy(true);
    try {
      const pdf = files.find((f) => f.type === 'application/pdf');
      if (pdf && pdf.size > MAX_PDF_BYTES) throw new Error('That PDF is over 8 MB. Add photos of its pages instead.');
      const images = await Promise.all(files.filter((f) => f.type.startsWith('image/')).slice(0, 10).map((f) => photoToDataUrl(f)));
      const r = await importSheet({ text: text.trim() || undefined, images: images.length ? images : undefined, pdf: pdf ? await fileToDataUrl(pdf) : undefined });
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The sheet could not be read');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Start from your price sheet" hint="Paste the text, or add photos of the pages or a PDF. TreeCheck reads it into the services below. Anything unclear or contradictory comes back as an open item for you to settle; nothing is guessed.">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your price sheet here" rows={4} maxLength={60000} aria-label="Price sheet text" />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 py-2 hover:bg-muted">
          <FileUp className="w-4 h-4" /> Add photos or a PDF
          <input type="file" className="hidden" multiple accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))} />
        </label>
        {files.length > 0 && <span className="text-xs text-muted-foreground">{files.length} file{files.length === 1 ? '' : 's'}</span>}
        <Button onClick={read} disabled={busy || (!text.trim() && files.length === 0)}>
          {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}Read the sheet
        </Button>
      </div>
      {result && (
        <div className="rounded-md border p-3 space-y-2 text-sm">
          <div className="font-medium">Read {result.definition.services.length} services.</div>
          {result.findings.length > 0 && (
            <ul className="list-disc pl-5 space-y-1">
              {result.findings.slice(0, 8).map((f) => <li key={f.key}>{f.text}{f.quote ? <span className="text-muted-foreground"> ("{f.quote}")</span> : null}</li>)}
              {result.findings.length > 8 && <li>and {result.findings.length - 8} more in Open items</li>}
            </ul>
          )}
          {result.warnings.length > 0 && <ul className="text-xs text-muted-foreground list-disc pl-5">{result.warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}</ul>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { onUse(result); setResult(null); setText(''); setFiles([]); toast.success('Loaded. Check each service under Prices.'); }}>Use this</Button>
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>Discard</Button>
          </div>
        </div>
      )}
    </Section>
  );
}
