# DMA: Published posts library + voice-memo revisions

Yes, this is possible. Everything needed is already in place except a record of what was published — right now DMA publishes and forgets. Once we store each published post, we can show it in the app, open it, and let the contractor talk into a memo to get it fixed.

## What the contractor sees

1. **DMA → "Published posts"** list: cover photo, title, location, published date, last-updated date.
2. Tap a post → detail sheet showing the photos and the actual published copy (summary / challenge / approach / result), plus **View on your site**.
3. A **"Request a change"** button with the same big mic button used elsewhere in the app. They hold and talk casually: *"It says we used a crane, we didn't, it was a bucket truck, and take out the part about the fence."*
4. Hit Submit → status flips to "Updating…" → about a minute later the post shows the corrected copy and the live page is updated. If they want, they can also add or replace photos on the same screen.
5. If anything fails, the post shows "Update failed" with the reason, and the memo is preserved so they can retry.

## How the fix reaches the site

The site receiver already upserts on `slug`, so re-publishing the same slug replaces the live page instead of creating a duplicate. A revision:

- Transcribes the voice memo (Lovable AI speech-to-text).
- Sends the AI the *current published copy* plus the transcribed correction and asks it to return the same structured fields with only the requested changes applied — keeping slug, tone, and SEO structure intact.
- Re-sends the full payload (existing stored photos, recompressed as today) to the same publish endpoint.
- Saves the new copy as the current version and keeps the old one in history.

Guardrails: the revision prompt is told to treat the contractor's correction as fact, to change only what was asked, never to invent details, and never to name a tree species (existing project rule). Slug never changes, so links and SEO don't break.

## Technical notes

- **New table `dma_published_projects`**: contractor_id, slug (unique per contractor), title, location, service_category, public_url, publish_endpoint_url, photo_paths, the full generated copy as jsonb, status (`published` / `revising` / `failed`), revision_count, last_error, timestamps. RLS scoped to the contractor and their team (same pattern as `dma_integrations`), plus GRANTs.
- **New table `dma_project_revisions`**: project_id, transcript, voice memo path, copy_before / copy_after jsonb, status, error, created_at — gives history and an audit trail.
- **`dma-publish-project`**: on success, insert/update the row in `dma_published_projects` with the copy and photo paths. No change to the publish contract.
- **New edge function `dma-revise-project`**: verifies ownership, marks the row `revising`, transcribes the memo via `POST /v1/audio/transcriptions`, calls the model with current copy + transcript using the existing structured tool schema, re-fires the webhook with existing photos, then writes the new copy and revision row. Errors always return JSON and set `last_error`.
- **Frontend**: `useDMAPublishedProjects` hook (list / detail / revise mutation with polling while `revising`), `DMAPublishedProjects.tsx` list + `DMAProjectRevisionSheet.tsx` detail/memo sheet, mounted as a section on the DMA page. Voice capture reuses `useAudioRecorder`; memos upload to the existing `scout-media` bucket under a `dma/` prefix.

## Out of scope for this pass

- Editing the copy by hand in text fields (voice-only for now, per your description).
- Deleting/unpublishing a post from the app.
- Review-before-publish on the initial submission — this plan fixes posts after the fact, which is what you asked for.
