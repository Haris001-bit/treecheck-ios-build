import { Link } from 'react-router-dom';
import { Bell, CalendarIcon, CheckCircle2, Gavel, MapPin, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { StarRow } from '@/components/Reviews';
import removalPhoto from '@/assets/crew-sample-removal.jpg';
import pruningPhoto from '@/assets/crew-sample-pruning.jpg';

// Marketing sample of the subs' jobs page. Every name, number and photo here is fictional and labeled as such.
const TABS = [['Open', 4], ['My jobs', 2], ['Past work', 18], ['Archived', 7]] as const;

function Chip({ on, children }: { on?: boolean; children: React.ReactNode }) {
  return <span className={`rounded-md border px-2.5 py-1.5 text-xs ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}>{children}</span>;
}

export function CrewBidsAdvertisementSample() {
  return <div className="p-4 sm:p-6 max-w-2xl mx-auto">
    <header className="mb-4 flex items-start justify-between gap-2">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Gavel className="w-6 h-6 text-primary" />Jobs open for bids</h1>
        <p className="text-sm text-muted-foreground mt-1">See the tree, name your price, pick your days. Nobody else sees your numbers.</p>
      </div>
      <Button asChild variant="ghost" size="icon" title="Close sample"><Link to="/dashboard/crew-bids" aria-label="Close sample"><X className="h-4 w-4" /></Link></Button>
    </header>

    <Card className="mb-4 flex items-center gap-3 border-primary/40 bg-primary/5 p-3 text-sm">
      <Bell className="h-5 w-5 shrink-0 text-primary" />
      <div><p className="font-semibold">New job near you</p><p className="text-xs text-muted-foreground">Timber Edmond posted a Tree Removal in Edmond · 4 min ago</p></div>
    </Card>

    <div className="mb-4 grid grid-cols-4 rounded-md bg-muted p-1 text-xs sm:text-sm">
      {TABS.map(([label, n], i) => <div key={label} className={`rounded-sm px-1 py-1.5 text-center ${i === 0 ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}>{label} <span className="text-muted-foreground">({n})</span></div>)}
    </div>

    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 1 · Bid on a job</p>
    <Card className="mb-6 overflow-hidden">
      <img src={removalPhoto} alt="Large oak leaning over a backyard fence" width={1024} height={768} className="w-full h-72 object-contain bg-muted" />
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Tree Removal — Edmond</span><Badge className="text-[10px]">Open for your bid</Badge></div>
            <div className="mt-0.5 flex items-center gap-1 text-xs">Timber Edmond · <StarRow value={5} /> 5.0</div>
            <div className="text-xs text-muted-foreground mt-0.5">Customer timeline: within a month</div>
          </div>
          <div className="text-sm flex items-center gap-1 text-muted-foreground"><MapPin className="w-4 h-4" />Edmond</div>
        </div>
        <div className="rounded-md border bg-muted/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide">Scout observations</div>
          <div className="text-xs mt-1">Difficulty: <strong>Moderate</strong> · Risk: <strong>Fence and roofline</strong></div>
          <p className="text-sm mt-1">Large leaning trunk, about 30" across. Main lead hangs over the fence. Backyard access through a 10' gate.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Your minimum</p><p className="text-lg font-black tabular-nums">$850</p></div>
          <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Your ideal</p><p className="text-lg font-black tabular-nums text-primary">$1,100</p></div>
        </div>
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Days you can work</p>
          <div className="flex flex-wrap gap-1.5"><Chip on>Tue 11/3</Chip><Chip>Wed 11/4</Chip><Chip on>Thu 11/5</Chip><Chip on>Sat 11/7</Chip></div>
        </div>
        <div className="flex h-10 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground">Send my bid</div>
      </div>
    </Card>

    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 2 · Get hired, crew gets lined up</p>
    <Card className="mb-6 overflow-hidden">
      <div className="border-b p-3 text-sm flex items-center gap-2"><CalendarIcon className="h-4 w-4 text-primary" />Your days: <strong>Thu 11/5</strong></div>
      <img src={pruningPhoto} alt="Pecan limbs over a driveway and roof" width={1024} height={768} loading="lazy" className="w-full h-72 object-contain bg-muted" />
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Pruning/Trimming — Moore</span><Badge className="text-[10px]">You're hired</Badge></div>
            <div className="mt-0.5 flex items-center gap-1 text-xs">Timber Edmond · <StarRow value={5} /> 5.0</div>
          </div>
          <div className="text-sm flex items-center gap-1 text-muted-foreground"><MapPin className="w-4 h-4" />Moore</div>
        </div>
        <p className="text-sm">Raise limbs over the driveway and clear the roofline. Haul off the brush.</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Your pay</p><p className="text-lg font-black tabular-nums text-primary">$650</p></div>
          <div className="rounded-md border p-2"><p className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />Ground crew</p><p className="text-lg font-black">2 of 2 <span className="text-xs font-normal text-muted-foreground">confirmed</span></p></div>
        </div>
      </div>
    </Card>

    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 3 · Build your record</p>
    <Card className="mb-4 p-4 space-y-3">
      <div className="grid grid-cols-3 divide-x divide-border text-center">
        <div><p className="text-2xl font-black tabular-nums text-primary">18</p><p className="text-xs text-muted-foreground">Jobs done</p></div>
        <div><p className="text-2xl font-black tabular-nums">$14,320</p><p className="text-xs text-muted-foreground">Paid out</p></div>
        <div className="flex flex-col items-center"><StarRow value={5} size="md" /><p className="mt-1 text-xs text-muted-foreground">5.0 · 12 reviews</p></div>
      </div>
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <p className="flex items-center gap-1 text-xs font-semibold"><CheckCircle2 className="h-3.5 w-3.5 text-primary" />Tree Removal — Oklahoma City · <StarRow value={5} /></p>
        <p className="mt-1">"Showed up on time, dropped it clean between the fence and the shed. Left the yard spotless."</p>
      </div>
    </Card>

    <p className="border-t border-border pt-2 text-xs text-muted-foreground">Free for subs · Illustrative sample data · not actual jobs or pay</p>
  </div>;
}
