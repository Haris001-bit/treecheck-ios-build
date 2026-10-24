import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLSASettings, useUpdateLSASettings } from '@/hooks/useLSA';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft } from 'lucide-react';
import { isAppStoreSafeMode } from '@/lib/platform';

export default function LSASettings() {
  const { data, isLoading } = useLSASettings();
  const update = useUpdateLSASettings();

  const [enabled, setEnabled] = useState(false);
  const [callback, setCallback] = useState('');
  const [template, setTemplate] = useState('');
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('18:00');
  const [behavior, setBehavior] = useState<'always' | 'office_only'>('always');

  useEffect(() => {
    if (data) {
      setEnabled(data.enabled);
      setCallback(data.callback_number || '');
      setTemplate(data.sms_template);
      setStart(data.office_hours_start.slice(0, 5));
      setEnd(data.office_hours_end.slice(0, 5));
      setBehavior(data.after_hours_behavior);
    }
  }, [data]);

  const save = () => update.mutate({
    enabled,
    callback_number: callback || null,
    sms_template: template,
    office_hours_start: start,
    office_hours_end: end,
    after_hours_behavior: behavior,
  });

  if (isLoading) return <div className="p-8">Loading…</div>;

  return (
    <div className="container mx-auto p-4 lg:p-8 max-w-3xl">
      <Button asChild variant="ghost" className="mb-4">
        <Link to="/dashboard/lsa"><ArrowLeft className="w-4 h-4 mr-2" />Back to LSA Leads</Link>
      </Button>

      <h1 className="text-3xl font-bold mb-2">LSA Auto-Response Settings</h1>
      <p className="text-muted-foreground mb-6">Configure how First Responder Voice handles your {isAppStoreSafeMode() ? 'Local Services Ads' : 'Google Local Services Ads'} leads.</p>

      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">Turn on LSA auto-response</Label>
            <p className="text-sm text-muted-foreground">When on, new LSA leads trigger an immediate call or text.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="space-y-2">
          <Label>Call-back number (First Responder Voice)</Label>
          <Input
            type="tel"
            placeholder="+1 555 123 4567"
            value={callback}
            onChange={(e) => setCallback(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">The number Retell will use when calling LSA leads back.</p>
        </div>

        <div className="space-y-2">
          <Label>Default SMS reply</Label>
          <Textarea rows={4} value={template} onChange={(e) => setTemplate(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Use <code>{'{name}'}</code>, <code>{'{company}'}</code>, <code>{'{job_type}'}</code> as placeholders.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Office hours start</Label>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Office hours end</Label>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>After-hours behavior</Label>
          <Select value={behavior} onValueChange={(v) => setBehavior(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="always">Always respond (24/7)</SelectItem>
              <SelectItem value="office_only">Only during office hours</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={save} disabled={update.isPending} className="w-full">
          {update.isPending ? 'Saving…' : 'Save settings'}
        </Button>
      </Card>

      <Card className="p-6 mt-6 bg-muted/40">
        <h3 className="font-semibold mb-2">Webhook for n8n</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Point your n8n LSA workflow to this URL with header <code>x-lsa-secret</code>:
        </p>
        <code className="block bg-background p-3 rounded text-xs break-all">
          https://wsbtxxobbvcdxiovnssi.supabase.co/functions/v1/lsa-webhook
        </code>
        <p className="text-xs text-muted-foreground mt-3">
          POST body: <code>{'{ contractor_id, lead_type: "call"|"message", customer_name, customer_phone, job_type, message, received_at }'}</code>
        </p>
      </Card>
    </div>
  );
}
