# DMA Port Guide for Harris — Handoff Document

Goal: give Harris a complete, step-by-step build guide so the other (industry-agnostic) Lovable app can publish AI-written job pages to each registered user's own website, exactly the way TreeCheck does — including editing/regenerating an existing post.

## What gets created

One new document in this project, `docs/DMA-PORT-GUIDE.md`, written as a build guide for another developer. Nothing in the app changes.

## Document outline

**1. How it works end to end**
Contractor picks 1-4 job photos + records a voice memo → photos and memo go to private storage → one backend function transcribes the memo, writes an SEO-structured page with AI, shrinks the photos, and POSTs the finished page + images to that user's own website endpoint → the website saves it and returns the live URL → the app records the post so it can be revised or regenerated later.

**2. Data model to recreate**
- `dma_integrations` (one row per user): `website_url`, `public_site_url`, `publish_endpoint_url`, `site_provider` eligibility flag, `brand_voice`.
- `dma_published_projects`: `contractor_id` + `slug` unique, `title`, `location`, `service_category`, `public_url`, `photo_paths`, `copy` (full generated JSON), `status`, `last_error`, `revision_count`, `published_at`.
- `dma_project_revisions`: transcript, memo path, `copy_before`/`copy_after`, status.
- Private photo bucket + RLS/GRANT notes, owner-only policies, service-role access for the function.

**3. The publish function (app side)**
- Auth: verify the caller's JWT, resolve team members to their owner account, gate on the beta/entitlement flag.
- Tenant routing: look up the user's integration row, resolve endpoint URL + per-tenant bearer secret, refuse to publish when no endpoint is configured (never let one tenant write to another's site).
- AI generation: Lovable AI Gateway — speech-to-text for the memo, a single tool-call schema that returns slug, seoTitle, metaDescription, H1, intro, 5-8 sections (paragraphs/bullets/recommendations), service category, internal-link anchor, CTA, per-photo alt text. The document explains which parts of the current tree-specific prompt are industry-locked and must become data (service slug list, brand voice, phone, region, banned phrases) instead of hardcoded copy.
- Photo normalization: long edge capped at 1600px, aspect preserved, no cropping, JPEG re-encoded at descending quality until under ~700 KB, extra photos dropped if total base64 exceeds ~4 MB.
- Modes: new post, voice-memo revision (AI rewrite), and regenerate/republish (re-push same slug, no AI, no duplicate).

**4. The website side (what each registered site must implement)**
- One HTTPS receiver at a stable path (e.g. `/api/public/dma-inbound`), reachable without site login.
- Auth: `Authorization: Bearer <shared secret>`, 401 on mismatch; must accept ~5 MB JSON bodies.
- Documented request body: `slug`, `title`, `location`, `summary`, `challenge`, `approach`, `result`, `seoTitle`, `metaDescription`, `intro`, `heroAlt`, `photoAlts`, `sections[]` (with `paragraphs`, `bullets`, and the `body`/`text`/`content`/`html` aliases), `serviceCategory`, `seeAlsoServiceSlug`, `seeAlsoAnchor`, `ctaHeadline`, `ctaSub`, `photos[]` (`filename`, `base64`, `contentType`, `isCover`).
- Required behaviour: decode and store photos, upsert by `slug` (same slug = update, never a duplicate), render the page, respond `200 {"ok":true,"url":"https://…"}`, and surface failures in an `x-dma-error` header.
- Notes on the three host patterns already proven: static-repo commit (GitHub + rebuild), platform edge function, and Cloudflare Worker — including the gotchas hit in production (unpublished worker returning 404, platform function-size limits, 401 from a mismatched secret).

**5. Onboarding a new user's website (repeatable checklist)**
Create the site receiver → generate one shared secret → store it in the app's secret store → map the user to that secret name → fill the integration row (endpoint, public URL, eligibility, brand voice) → send one test post → confirm the live URL, then Regenerate to confirm updates land on the same page.

**6. Multi-tenant improvement Harris should make**
TreeCheck currently keeps a hardcoded contractor-ID → secret-name map and a legacy hardcoded repo path. The guide recommends the agnostic app store the secret reference per integration row (and drop the legacy branch entirely) so onboarding needs no code deploy.

**7. Troubleshooting table**
401, 403 beta gate, 400 "no website connected", 404 endpoint, empty sections on the rendered page, wrong city on the page, oversized photos, duplicate posts — each with cause and fix.

## Notes

Written for a developer, no TreeCheck-specific credentials or secret values included; real tenant secrets are referenced by name only.
