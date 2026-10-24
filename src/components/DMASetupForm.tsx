import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Mail, Save, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useSaveDMASetup, type DMASetupStatus } from '@/hooks/useDMASetup';
import { dmaSetupSchema, EMPTY_VOICE, VOICE_OPTIONS, buildBrandVoice, voiceSample, type DMASetupValues, type VoiceAnswers } from '@/lib/dmaSetup';

const headings = ['Company & delivery', 'Your voice', 'Your story', 'Review your setup'];

export default function DMASetupForm({ status, onDone }: { status: DMASetupStatus; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<DMASetupValues>(() => status.setup ? { ...status.setup, voice_answers: { ...EMPTY_VOICE, ...status.setup.voice_answers } } : { ...status.defaults, voice_answers: { ...EMPTY_VOICE }, voice_preview: '' });
  const [error, setError] = useState('');
  const save = useSaveDMASetup();
  const change = (key: keyof Omit<DMASetupValues, 'voice_answers'>, value: string) => setValues(v => ({ ...v, [key]: value }));
  const voice = (key: keyof VoiceAnswers, value: string | string[]) => setValues(v => ({ ...v, voice_answers: { ...v.voice_answers, [key]: value } }));
  const persist = async (complete: boolean, advance: boolean) => {
    setError('');
    const parsed = dmaSetupSchema.safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || 'Check your answers.'); setStep(0); return; }
    try {
      await save.mutateAsync({ values: parsed.data, complete });
      if (complete) { toast.success('Marketing setup saved.'); onDone(); }
      else if (advance) {
        if (step === 2 && !values.voice_preview) change('voice_preview', voiceSample(values.voice_answers));
        setStep(s => s + 1);
      } else toast.success('Your progress is saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save your setup.'); }
  };
  const choices = (key: 'tone' | 'concerns' | 'standards', title: string, otherKey: 'toneOther' | 'concernsOther' | 'standardsOther') => (
    <fieldset className="space-y-3">
      <legend className="font-semibold">{title}</legend>
      <p className="text-xs text-muted-foreground">Choose up to three.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {VOICE_OPTIONS[key].map(option => {
          const selected = values.voice_answers[key].includes(option);
          return <label key={option} className={`flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer ${selected ? 'border-primary bg-primary/10' : 'border-border'}`}>
            <Checkbox aria-label={option} checked={selected} disabled={!selected && values.voice_answers[key].length >= 3}
              onCheckedChange={checked => voice(key, checked ? [...values.voice_answers[key], option] : values.voice_answers[key].filter(v => v !== option))} />
            <span>{option}</span>
          </label>;
        })}
      </div>
      <Label htmlFor={otherKey} className="text-xs text-muted-foreground">Other / details (optional)</Label>
      <Input id={otherKey} maxLength={1000} value={values.voice_answers[otherKey]} onChange={e => voice(otherKey, e.target.value)} />
    </fieldset>
  );
  const field = (key: 'story' | 'favoritePhrases' | 'avoid' | 'example', title: string, placeholder: string) => (
    <div className="space-y-2"><Label htmlFor={`voice-${key}`}>{title}</Label><Textarea id={`voice-${key}`} value={values.voice_answers[key]} onChange={e => voice(key, e.target.value)} rows={3} maxLength={1000} placeholder={placeholder} /></div>
  );
  return <section className="space-y-6">
    <div className="border-b border-border pb-4">
      <p className="text-sm text-muted-foreground mb-2">Step {step + 1} of 4</p>
      <h2 className="text-xl font-semibold flex items-center gap-2"><Settings2 className="h-5 w-5 text-primary" />{headings[step]}</h2>
    </div>
    {step === 0 && <div className="space-y-4">
      {([
        ['company_name', 'Company name', 150, 'text'], ['contact_name', 'Contact name', 100, 'text'],
        ['delivery_email', 'Email for your content', 255, 'email'], ['service_area', 'Service area / city', 200, 'text'],
        ['website_url', 'Existing website (optional)', 500, 'url'],
      ] as const).map(([key, title, max, type]) => <div key={key} className="space-y-2"><Label htmlFor={`dma-${key}`}>{title}</Label>
        <Input id={`dma-${key}`} type={type} maxLength={max} value={values[key]} onChange={e => change(key, e.target.value)} placeholder={key === 'website_url' ? 'https://yourwebsite.com' : undefined} />
      </div>)}
      <p className="text-sm text-muted-foreground flex gap-2"><Mail className="h-4 w-4 shrink-0 mt-0.5" />{status.connected ? 'Your connected website remains your publishing destination.' : 'Your content will go to this email. A website is optional.'}</p>
    </div>}
    {step === 1 && <div className="space-y-6">
      {choices('tone', '1. How should your company sound?', 'toneOther')}
      {choices('concerns', '2. What worries your customers most?', 'concernsOther')}
      {choices('standards', '3. What do you want to be known for?', 'standardsOther')}
    </div>}
    {step === 2 && <div className="space-y-6">
      {field('story', '4. What is your local story? (optional)', 'Your local connection, why you started, or what makes you different.')}
      <fieldset className="space-y-4"><legend className="font-semibold mb-3">5. What should we say—or never say?</legend>
        {field('favoritePhrases', 'Favorite phrases (optional)', 'Words you naturally use with customers.')}
        {field('avoid', 'Words or tones to avoid (optional)', 'Words, claims or styles that do not fit your company.')}
      </fieldset>
      {field('example', '6. Give us one example of your voice. (optional)', 'A homeowner says another company quoted less. What would you say? Or paste a real review or a sentence you use.')}
      <Button variant="link" asChild><a href="https://tradesmarketing.ai/tree-service-brand-voice-survey" target="_blank" rel="noopener noreferrer">Full brand voice survey</a></Button>
    </div>}
    {step === 3 && <div className="space-y-5">
      <dl className="space-y-2 text-sm"><div><dt className="text-muted-foreground">Company</dt><dd>{values.company_name}</dd></div><div><dt className="text-muted-foreground">Delivery</dt><dd className="break-words">{status.connected ? 'Connected website' : values.delivery_email}</dd></div><div><dt className="text-muted-foreground">Service area</dt><dd>{values.service_area}</dd></div></dl>
      <div className="space-y-2"><Label htmlFor="dma-voice-preview">Sample paragraph</Label><Textarea id="dma-voice-preview" rows={4} maxLength={2000} value={values.voice_preview || voiceSample(values.voice_answers)} onChange={e => change('voice_preview', e.target.value)} /></div>
      <details className="text-sm"><summary className="cursor-pointer font-medium">Brand voice summary</summary><p className="mt-3 whitespace-pre-wrap text-muted-foreground">{buildBrandVoice(values.voice_answers)}</p></details>
      {status.trial_ends_at && <p className="text-sm text-primary">Unlimited posts during your current 14-day trial, ending {new Date(status.trial_ends_at).toLocaleDateString()}.</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
      <Button variant="outline" disabled={save.isPending} onClick={() => step > 0 ? setStep(s => s - 1) : onDone()}><ArrowLeft className="h-4 w-4 mr-2" />{step > 0 ? 'Back' : 'Cancel'}</Button>
      <Button variant="ghost" disabled={save.isPending} onClick={() => persist(false, false)}><Save className="h-4 w-4 mr-2" />Save progress</Button>
      <Button className="sm:ml-auto" disabled={save.isPending} onClick={() => persist(step === 3, true)}>
        {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : step === 3 ? <CheckCircle2 className="h-4 w-4 mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
        {step === 3 ? 'Finish setup' : 'Continue'}
      </Button>
    </div>
  </section>;
}