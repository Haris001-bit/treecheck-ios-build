import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useProductionConfig, keyFromName, type LaborRole, type EquipmentItem, type ProductionPricing } from '@/hooks/useProductionConfig';
import { ConsultationNote } from '@/components/ConsultationNote';

export function ProductionCostsForm() {
  const { data, isLoading, save } = useProductionConfig();
  const [roles, setRoles] = useState<LaborRole[]>([]);
  const [equip, setEquip] = useState<EquipmentItem[]>([]);
  const [pricing, setPricing] = useState<ProductionPricing | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !pricing) { setRoles(data.roles); setEquip(data.equipment); setPricing(data.pricing); }
  }, [data, pricing]);

  if (isLoading || !pricing) return <div className="p-4 text-sm text-muted-foreground">Loading costs…</div>;

  const onSave = async () => {
    setSaving(true);
    try {
      const fixR = roles.filter((r) => r.name.trim()).map((r) => ({ ...r, role_key: r.role_key || keyFromName(r.name) }));
      const fixE = equip.filter((e) => e.name.trim()).map((e) => ({ ...e, equipment_key: e.equipment_key || keyFromName(e.name) }));
      await save(fixR, fixE, pricing);
      toast.success('Production costs saved');
    } catch (e: any) { toast.error(e?.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div>
          <div className="font-semibold">Labor costs</div>
          <div className="text-xs text-muted-foreground">Loaded Hourly Cost is roughly what each employee costs the company per working hour (wage plus taxes, insurance, and benefits), not only their wage.</div>
        </div>
        {roles.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={r.name} onChange={(e) => setRoles(roles.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="flex-1" aria-label="Role name" />
            <div className="relative w-28">
              <span className="absolute left-2 top-2 text-sm text-muted-foreground">$</span>
              <Input type="number" inputMode="decimal" className="pl-5" value={r.loaded_hourly_cost}
                onChange={(e) => setRoles(roles.map((x, j) => j === i ? { ...x, loaded_hourly_cost: Number(e.target.value) } : x))} aria-label={`${r.name} loaded hourly cost`} />
            </div>
            <span className="text-xs text-muted-foreground">/hr</span>
            <Button size="icon" variant="ghost" onClick={() => setRoles(roles.filter((_, j) => j !== i))} aria-label="Remove role"><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setRoles([...roles, { role_key: '', name: '', loaded_hourly_cost: 0, sort_order: roles.length }])}><Plus className="w-4 h-4 mr-1" />Add role</Button>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <div className="font-semibold">Equipment costs</div>
          <div className="text-xs text-muted-foreground">Your estimated hourly operating cost for each machine.</div>
        </div>
        {equip.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={r.name} onChange={(e) => setEquip(equip.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="flex-1" aria-label="Equipment name" />
            <div className="relative w-28">
              <span className="absolute left-2 top-2 text-sm text-muted-foreground">$</span>
              <Input type="number" inputMode="decimal" className="pl-5" value={r.hourly_cost}
                onChange={(e) => setEquip(equip.map((x, j) => j === i ? { ...x, hourly_cost: Number(e.target.value) } : x))} aria-label={`${r.name} hourly cost`} />
            </div>
            <span className="text-xs text-muted-foreground">/hr</span>
            <Button size="icon" variant="ghost" onClick={() => setEquip(equip.filter((_, j) => j !== i))} aria-label="Remove equipment"><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setEquip([...equip, { equipment_key: '', name: '', hourly_cost: 0, sort_order: equip.length }])}><Plus className="w-4 h-4 mr-1" />Add equipment</Button>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="font-semibold">Pricing</div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Target margin %</Label>
            <Input type="number" value={Math.round(pricing.target_margin * 100)} onChange={(e) => setPricing({ ...pricing, target_margin: Math.min(95, Math.max(0, Number(e.target.value))) / 100 })} />
          </div>
          <div>
            <Label className="text-xs">Minimum job charge</Label>
            <Input type="number" placeholder="Optional" value={pricing.minimum_job_charge ?? ''} onChange={(e) => setPricing({ ...pricing, minimum_job_charge: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <div>
            <Label className="text-xs">Disposal per load</Label>
            <Input type="number" placeholder="Optional" value={pricing.disposal_per_load ?? ''} onChange={(e) => setPricing({ ...pricing, disposal_per_load: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Scout prices so your margin is a share of the sale: price = cost ÷ (1 − margin). 30% on a $1,750 job is $2,500.</p>
      </Card>

      <Button className="w-full" onClick={onSave} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save production costs</Button>
      <ConsultationNote />
    </div>
  );
}
