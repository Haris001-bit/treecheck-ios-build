import { FreePlanUpsell } from './FreePlanUpsell';

/**
 * A Scout estimate made on the Free plan. The real price, notes, difficulty and risk are not in the app at all (they
 * wait on the server until a trial or paid plan); the blurred figures here are a fixed placeholder.
 */
export function LockedScoutEstimate({ service }: { service: string | null }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-muted-foreground uppercase tracking-wide">Service</div>
        <div className="text-lg font-semibold">{service ?? 'Tree job'}</div>
      </div>
      <div className="grid grid-cols-2 gap-4" aria-hidden="true">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Estimate</div>
          <div className="text-2xl font-bold text-primary blur-md select-none">$0,000</div>
        </div>
        <div className="space-y-1 blur-sm select-none">
          <div className="text-xs text-muted-foreground">Difficulty: Moderate</div>
          <div className="text-xs text-muted-foreground">Risk: Medium</div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground blur-sm select-none" aria-hidden="true">
        Scout's findings and the recommended work for this tree are written here for the homeowner.
      </p>
      <FreePlanUpsell title="Scout made your estimate" body="Start your 14-day free trial to see this estimate: the price, Scout's notes, difficulty and risk." />
    </div>
  );
}
