import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, LineChart, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function HomeAdvertisementSample({ demo = false }: { demo?: boolean }) {
  return <div className="home-workspace min-h-[calc(100svh-4rem)] bg-background text-foreground font-normal">
    <div className="mx-auto max-w-5xl px-5 pb-4 sm:px-9 lg:px-12">
      <header className="flex items-center justify-between border-b border-border py-3">
        <div><p className="text-xs text-primary">TREECHECK</p><h1 className="mt-1 text-2xl font-light">Business is growing.</h1></div>
        {!demo && <Button asChild variant="ghost" size="icon" title="Return to live Home"><Link to="/dashboard/home" aria-label="Return to live Home"><X className="h-4 w-4" /></Link></Button>}
      </header>
      <section aria-label="Booked vs sold" className="py-4">
        <h2 className="mb-3 text-sm font-normal text-muted-foreground">Booked vs sold · month to date</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><p className="text-3xl font-black tabular-nums text-primary">$42,800</p><p className="mt-1 text-xs text-muted-foreground">Booked · 18 jobs still to do</p></div>
          <div><p className="text-3xl font-black tabular-nums">$68,450</p><p className="mt-1 text-xs text-muted-foreground">Sold · 24 jobs accepted this month</p></div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Both figures cover quotes accepted this month.</p>
      </section>
      <section aria-label="New jobs" className="home-new py-3">
        <h2 className="mb-1 text-sm font-normal text-muted-foreground">New jobs</h2>
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-4xl font-black tabular-nums text-primary">12</p><p className="mt-1 text-xs text-muted-foreground">Ready for your next move</p></div>
          <Button asChild><Link to="/dashboard/bid-board?new=1">Open new jobs<ArrowRight /></Link></Button>
        </div>
      </section>
      <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
        <section aria-label="Scout AI Accuracy" className="py-4 pr-3">
          <h2 className="mb-2 text-sm font-normal text-muted-foreground">Scout AI Accuracy</h2>
          <p className="text-3xl font-black tabular-nums text-primary">86<span className="text-lg font-light">%</span></p>
          <p className="mt-2 text-xs text-muted-foreground">AI vs sold price · 124 jobs</p>
          <p className="mt-2 flex items-center gap-1 text-xs text-primary"><ArrowUpRight className="h-4 w-4" />+8 pts vs last month</p>
        </section>
        <section aria-label="New Blog Posts This month" className="py-4 pl-3">
          <h2 className="mb-2 text-sm font-normal text-muted-foreground">New Blog Posts<br />This month</h2>
          <p className="text-3xl font-black tabular-nums">13</p>
          <p className="mt-2 flex items-center gap-1 text-xs text-primary"><ArrowUpRight className="h-4 w-4" />+5 vs last month</p>
          <p className="mt-2 text-xs text-muted-foreground">87 posts total</p>
        </section>
      </div>
      <section aria-label="Financial Pulse" className="border-t border-border py-3">
        <h2 className="flex items-center gap-2 text-sm"><LineChart className="h-4 w-4 text-primary" />Financial Pulse</h2>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-3xl font-black tabular-nums text-primary">$18,450</p><p className="mt-1 text-xs text-muted-foreground">Profit · month to date</p></div>
          <div className="text-right"><p className="flex items-center justify-end gap-1 text-sm text-primary"><ArrowUpRight className="h-4 w-4" />24% ahead</p><p className="mt-1 text-xs text-muted-foreground">vs same days last month</p></div>
        </div>
        <div className="mt-3" role="img" aria-label="Line chart of payments versus costs over the past 30 days">
          <svg viewBox="0 0 320 110" className="h-24 w-full" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" x2="320" y1="100" y2="100" stroke="hsl(var(--border))" strokeWidth="1" /><line x1="0" x2="320" y1="55" y2="55" stroke="hsl(var(--border))" strokeWidth="0.5" /><line x1="0" x2="320" y1="10" y2="10" stroke="hsl(var(--border))" strokeWidth="0.5" />
            <polyline fill="none" stroke="hsl(0 72% 55%)" strokeWidth="1.5" strokeDasharray="4 3"
              points="0.0,88 10.7,91 21.3,100 32.0,100 42.7,87 53.3,92 64.0,91 74.7,95 85.3,90 96.0,100 106.7,100 117.3,96 128.0,95 138.7,92 149.3,70 160.0,100 170.7,98 181.3,78 192.0,94 202.7,96 213.3,91 224.0,88 234.7,96 245.3,94 256.0,97 266.7,100 277.3,86 288.0,90 298.7,97 309.3,95 320.0,100" />
            <polyline fill="none" stroke="hsl(142 60% 45%)" strokeWidth="2"
              points="0.0,94 10.7,100 21.3,100 32.0,100 42.7,55 53.3,96 64.0,100 74.7,90 85.3,86 96.0,100 106.7,100 117.3,100 128.0,97 138.7,8 149.3,94 160.0,90 170.7,96 181.3,97 192.0,40 202.7,92 213.3,98 224.0,100 234.7,97 245.3,62 256.0,100 266.7,100 277.3,25 288.0,96 298.7,100 309.3,94 320.0,50" />
          </svg>
          <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ backgroundColor: 'hsl(142 60% 45%)' }} />Payments in</span>
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ backgroundColor: 'hsl(0 72% 55%)' }} />Costs out</span>
            <span className="ml-auto">Past 30 days</span>
          </div>
        </div>
      </section>
      <p className="border-t border-border pt-2 text-xs text-muted-foreground">Illustrative sample data · not actual results</p>
    </div>
  </div>;
}