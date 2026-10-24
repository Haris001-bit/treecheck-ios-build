import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, HardHat, RotateCcw, ArrowRight } from 'lucide-react';

type Audience = 'owner' | 'subcontractor';
const STATES = ['New signup', 'Payment confirmation', 'Company setup', 'Pending approval', 'Active trial', 'Cancelled / lapsed', 'Reactivation'];
export default function AdminSignupSandbox() {
  const { isAdmin } = useAuth();
  const [audience, setAudience] = useState<Audience>('owner');
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(1);
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  const email = `signup-test+${audience}-${run}@treecheck.test`;
  return <div className="p-4 sm:p-8 max-w-3xl mx-auto space-y-6">
    <div><Badge>TEST MODE — NO CHARGES OR ALERTS</Badge><h1 className="text-3xl font-black mt-3">Signup Sandbox</h1><p className="text-muted-foreground mt-1">Walk through every signup state without contacting real people.</p></div>
    <div className="grid sm:grid-cols-2 gap-3">
      <Button variant={audience === 'owner' ? 'default' : 'outline'} className="h-auto justify-start p-4" onClick={() => { setAudience('owner'); setStep(0); }}><Building2 className="mr-3" />Tree company owner</Button>
      <Button variant={audience === 'subcontractor' ? 'default' : 'outline'} className="h-auto justify-start p-4" onClick={() => { setAudience('subcontractor'); setStep(0); }}><HardHat className="mr-3" />Subcontractor</Button>
    </div>
    <Card><CardHeader><CardTitle>{STATES[step]}</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="rounded-md border p-3 text-sm"><div className="text-muted-foreground">Test email</div><div className="font-medium break-all">{email}</div></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{STATES.map((state, index) => <Button key={state} size="sm" variant={index === step ? 'default' : 'outline'} onClick={() => setStep(index)}>{index + 1}</Button>)}</div>
      <p className="text-sm">{audience === 'owner' ? 'Scout $50/month plus $35 for each additional office teammate, after 14 days free.' : 'Local membership pricing is shown before profile details; approval appears before any payment step.'}</p>
      <Button className="w-full" disabled={step === STATES.length - 1} onClick={() => setStep((value) => Math.min(value + 1, STATES.length - 1))}>Continue simulation <ArrowRight className="ml-2 h-4 w-4" /></Button>
    </CardContent></Card>
    <Button variant="outline" className="w-full" onClick={() => { setStep(0); setRun((value) => value + 1); }}><RotateCcw className="mr-2 h-4 w-4" />End test and reset</Button>
  </div>;
}
