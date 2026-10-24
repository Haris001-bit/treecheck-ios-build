# Financial Pulse colors and 30-day chart

- Color profit, loss, money received and costs consistently: positive outcomes green, negative outcomes red, zero neutral. Keep incomplete comparisons neutral.
- Add a compact 30-day daily line chart to Home's Financial Pulse summary and the full Financial Pulse page, using the same server-calculated numbers and theme colors.
- Use the existing window-totals calculation for each day; never calculate bank rows in the browser. Label the incoming-money line according to Pulse's actual revenue basis rather than mislabel completed jobs as payments.
- Preserve setup, loading, missing-data and partial-history states. Test synthetic data only; never inspect real financial data.

## Technical details

- Extend the Pulse engine snapshot and Home summary with a daily series; increase the engine version and deploy its sole function consumer, `pulse-get`.
- Share one chart between both views, with date labels, dollar values on pointer/focus, and an accessible data table.
- No migrations, permission changes, secrets or Jobber switch changes.