# Marketing: open, not greyed out

## What owners will see
- **Menu:** Marketing looks like every other item, with no lock and no grey. Tapping it opens the usual Marketing page.
- **On that page, for companies without Marketing:** a welcome box at the top:
  - "The Marketing Agent is built to work with TreeCheck's First Impression websites. It publishes your finished jobs to your site automatically."
  - **Learn more** opens the First Impression page on TradesMarketing.ai (tradesmarketing.ai/dma-web).
  - **Already have a website? Use copy-and-paste posts:** Scout writes the post from your job photos and notes, and you paste it into your own site.
- **Copy-and-paste path:** the owner makes a few free sample posts right away, using the free-preview flow we already have (the brand voice step is optional). After the free samples, the next step is the $99/month plan.
- **Phone apps:** same page and same free samples, but no prices or website links, because Apple and Google don't allow them. The "Learn more" box explains First Impression without the link, and continuing after the samples goes through the app's own plan screen.
- **Companies that already have Marketing:** nothing changes.

## Technical details
- `DashboardLayout.tsx`: keep the lock for other products, but stop treating `dma` as locked. The item always routes to `/dashboard/dma`.
- `DMA.tsx`: when the owner has no DMA entitlement (and isn't on the Free plan or in a trial), show a new `DMAIntro` card above `DMAEmailWorkspace`. Learn more uses `openExternal(PRODUCT_MARKETING_URLS.dma_web)` and is hidden when `isNativeStoreBilling()`.
- Free samples: reuse the existing Free plan preview allowance (3 previews), so copy-and-paste uses `freePreview` mode for non-entitled owners. This needs a check that the server's free-preview check allows non-Oklahoma owners. If it doesn't, extend `free_preview` eligibility in the DMA setup function to any owner without DMA, capped at 3 samples, with the price-free upgrade path in the apps.
- Tests: a non-entitled owner sees Marketing unlocked and the intro card; the Learn more link is absent in the native apps; entitled owners don't see the intro.
