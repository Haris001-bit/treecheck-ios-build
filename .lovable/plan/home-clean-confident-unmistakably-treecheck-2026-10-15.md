# Home: clean, confident, unmistakably TreeCheck

## Direction
Make the first screen feel like a thoughtfully designed business workspace, not an AI-generated template. Keep TreeCheck’s dark identity, brand green, and Roboto typography. Excitement comes from real work in hand, visible progress, and a clear next action—not decoration.

## The new layout
- **A composed opening:** TreeCheck prominently identified, a simple welcome, and the current date. No slogans, oversized promotional headline, or decorative hero.
- **Work in hand leads:** give Booked vs sold the strongest visual position. Large booked value, a clear label, and a separate sold-this-month figure with their job counts. Keep the current definitions and calculations unchanged.
- **New jobs beside it:** a large unread-job count and one obvious action to open the existing filtered Jobs view. Keep the caught-up state useful and calm.
- **Progress below:** Scout accuracy and Marketing posts in a lighter, aligned summary row with generous spacing, readable numbers, and restrained trend indicators. Preserve the under-five-jobs learning state and all existing counts.
- **Financial Pulse stays available:** retain the existing placeholder and Open Pulse / Set up link in a quiet, clearly separated area. Do not add financial numbers or read bank data.
- On smaller screens, stack in the same priority order. Use balanced spacing rather than shrinking text, and keep the next section visible without a tall introductory block.

## Visual treatment
- Replace Home’s five-identical-card layout with unframed sections, fine dividers, and deliberate hierarchy.
- Use flat dark surfaces and limited green emphasis. Remove grid, cyan glow, glass gradients, and heavy shadows **from Home only**; leave every other screen and the navigation unchanged.
- Use Roboto Light/regular for supporting text and Black for key figures, with normal letter spacing.
- No stock photos, decorative illustrations, sparkles, gradient blobs, fake charts, confetti, pulsing, scanning, or animated counters. Retain meaningful icons only where they help an action.
- Keep labels concise and factual. Do not imply that Scout learns automatically from each selection or invent positive trends.
- Reserve space for loading states so the page does not jump as numbers arrive. Include readable unavailable states rather than presenting a failed request as a successful zero.

## Scope and technical details
- Presentation-only changes to Home and narrowly scoped semantic style tokens in the global design system as needed.
- Preserve existing queries, metric formulas, destinations, per-person new-job tracking, and owner/office versus subcontractor navigation behavior.
- Continue using existing Button components and semantic color tokens; no new service, migration, payment change, or notification.
- No Financial Pulse files, tables, functions, or financial data accessed or changed. Its Home slot remains a placeholder for Haris.

## Verification
- Check authenticated Home at desktop, the current intermediate width, and phone widths using only permitted Home data.
- Confirm the visual hierarchy, text fit, contrast, stable loading space, and no sideways scrolling.
- Open the new-jobs action and confirm its existing filter; verify Jobs, Marketing, and Pulse link destinations without opening or invoking Pulse data.
- Check existing populated, learning, caught-up, and no-post states without fabricating production results.