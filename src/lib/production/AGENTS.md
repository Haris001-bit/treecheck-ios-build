# Production engine rules

- Employee production estimates come only from src/lib/production/engine.ts (pure, versioned) and never use climber-entered crew/hours, because every screen must produce the same estimate and predictions must be measurable against sub input.
- Company operating_model defaults to subcontractors; the Production Plan appears only for employees/hybrid, because the Timber sub workflow must stay untouched.
- Calibration keeps AI-inferred and owner-confirmed characteristics separately and locks the prediction once saved, because photo-reading errors must be distinguishable from Production Engine errors.
- Calibration photos go only through calibration-analyze (no texts, jobs, or n8n), because the live Scout submit dispatches real alerts.
- Selling price lives in production_pricing_history, never in production calibration, because price must not drive crew/hour predictions.
