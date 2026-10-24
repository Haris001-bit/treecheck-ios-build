# DMA Port Guide — Publishing AI Job Pages to a Registered User's Website

Audience: Harris (taking over the industry-agnostic app).
Source of truth for this document: the TreeCheck implementation, primarily
`supabase/functions/dma-publish-project/index.ts` plus the `dma_*` tables.

The goal is feature parity: a registered user records a voice memo, attaches
job photos, and a fully written, SEO-structured page appears on **their own**
website. They can then revise it by voice memo, or regenerate it — always on
the same URL, never as a duplicate post.

---

## 1. How it works end to end

```text
App (mobile/web)
  1. user picks 1-4 job photos + records a voice memo (or types notes)
  2. photos + memo uploaded to a PRIVATE storage bucket
  3. app calls the publish function with { notes | voice_memo_path, photo_paths[] }
         |
Backend publish function (one edge function does everything)
  4. verify JWT -> resolve team member to account owner -> check entitlement
  5. look up this account's website integration row
       -> endpoint URL + per-tenant bearer secret  (no row = refuse, 400)
  6. transcribe the memo (speech-to-text)
  7. generate the page copy with one AI tool-call (strict JSON schema)
  8. download each photo, resize (long edge <= 1600px, aspect kept), JPEG <= ~700KB
  9. POST { copy + base64 photos } to the tenant's website endpoint
         |
Tenant website receiver (/api/public/dma-inbound)
 10. verify bearer secret, decode photos, UPSERT page by slug, rebuild/render
 11. respond 200 { ok: true, url: "https://site/featured-jobs/<slug>" }
         |
Backend
 12. upsert dma_published_projects (contractor_id + slug unique) with the full copy
 13. return { success, slug, url, title } to the app
```

Revision and regenerate reuse steps 4-13 with the stored row: same slug in, same
slug out, so the live page is updated in place.

---

## 2. Data model to recreate

### 2.1 `dma_integrations` — one row per account (the website connection)

| Column | Purpose |
| --- | --- |
| `contractor_id` (uuid, unique) | account owner id |
| `website_url` | the user's public site, e.g. `https://example.com` |
| `public_site_url` | origin used to build the finished page link (falls back to `website_url`) |
| `publish_endpoint_url` | the HTTPS receiver we POST to (preferred over `website_url`) |
| `site_provider` | eligibility flag. TreeCheck only publishes when this equals `first_impression` (i.e. "we built/own this site"). Keep an equivalent gate. |
| `brand_voice` (text) | canonical tone/voice document for this tenant, injected above the system prompt |
| `webhook_secret_name` | **add this in the new app** — see §6 |

RLS: owner can `SELECT`/`UPDATE` their own row; admins full access; edge function
uses the service role. Remember `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`
and `GRANT ALL ... TO service_role` on every new public table.

### 2.2 `dma_published_projects` — the post library

`contractor_id`, `slug` (UNIQUE together — this is what prevents duplicates),
`title`, `location`, `service_category`, `public_url`, `publish_endpoint_url`,
`photo_paths` (text[]), `copy` (jsonb — the entire generated object, needed for
revisions/regenerate), `status` (`published` | `revising` | `failed`),
`last_error`, `revision_count`, `published_at`, `updated_at`.

### 2.3 `dma_project_revisions` — voice-memo edit history

`project_id`, `contractor_id`, `requested_by`, `transcript`,
`voice_memo_path`, `copy_before` (jsonb), `copy_after` (jsonb),
`status` (`pending` | `applied` | `failed`).

### 2.4 Storage

One **private** bucket (TreeCheck reuses `lead-photos`) with paths like
`dma/<jobId>/photo1.jpg` and `dma/<jobId>/memo.webm`. Users upload via the
authenticated client; the edge function downloads with the service role. Never
make this bucket public — the publish step copies the bytes to the tenant site,
so no public URL is required.

All three tables get a `BEFORE UPDATE ... update_updated_at_column()` trigger.

---

## 3. The publish function (app side)

Single edge function, three modes, decided by the request body:

```ts
{
  notes?: string;            // NEW post (>= 5 chars) — required if no project_id
  photo_paths?: string[];    // NEW post: 1-4 storage paths
  project_id?: string;       // REVISION or REGENERATE: existing published row
  voice_memo_path?: string;  // REVISION: memo to transcribe
  transcript?: string;       // REVISION: pre-transcribed text (skips STT)
  republish?: boolean;       // REGENERATE: re-push existing copy, no AI, no new row
}
```

### 3.1 Auth and tenancy (do this first, in this order)

1. Read the `Authorization` header, build a user-scoped client, `getUser()`.
   No user → 401.
2. Load the caller's profile. If it has a `parent_contractor_id`, load the
   parent and use it as `effectiveContractorId` — **team members publish to the
   owner's website**. Every subsequent lookup uses the effective id.
   (TreeCheck lost a day to this: a team member's own id had no integration row
   and every publish 400'd.)
3. Entitlement gate: owner's beta/subscription flag. Fail 403 with a plain
   message.
4. Load `dma_integrations` for the effective id. Resolve:
   - `endpoint = publish_endpoint_url || website_url`, must match `^https://`
   - `secret = <the tenant's bearer secret>`
   - eligible only when the `site_provider` gate passes
5. **If there is no endpoint + secret, return 400** ("No website is connected to
   this account yet"). This is the tenant-safety boundary: without it a new
   account inherits whatever default publishing path exists and writes pages onto
   someone else's site. TreeCheck needs an extra allow-list for its legacy
   GitHub path; the new app should have no default path at all.

### 3.2 Revision / regenerate branch

- Load the row by `project_id`; 404 if missing; 403 if `contractor_id` mismatch.
- Set `status = 'revising'`, clear `last_error`.
- If `republish !== true`: get the correction text (`transcript`, else transcribe
  `voice_memo_path`); under 3 chars → 400 "we couldn't hear the memo".
  Insert a `dma_project_revisions` row (`pending`, with `copy_before`).
- Reuse `photo_paths` from the stored row unless new ones were supplied.
- Keep the original `published_at`; bump `revision_count` only for real
  revisions, not for `republish`.
- `republish` skips the AI call entirely and re-sends the stored `copy`.

### 3.3 Transcription

Lovable AI Gateway, multipart POST to
`https://ai.gateway.lovable.dev/v1/audio/transcriptions` with
`model=openai/gpt-4o-transcribe` and the downloaded audio blob. Auth header
`Bearer ${LOVABLE_API_KEY}` (server-side secret only).

### 3.4 Copy generation

One chat call with a single function/tool the model **must** call exactly once,
returning a strict object. Required fields (keep all of them — the website
renderer depends on the shape):

`slug`, `title` (H1, Title Case human sentence), `shortDescription`, `seoTitle`
(< 60 chars), `metaDescription` (150-158 chars), `heroAlt`, `location`,
`intro`, `sections[]` (`heading`, `paragraphs[]`, optional `bullets[]`,
optional `recommendations[{label, description}]`), `whyChoices[]`,
`whyChoicesHeading`, `serviceCategory` (enum), `seeAlsoServiceSlug` (enum),
`seeAlsoAnchor`, `photoAlts[]`, `ctaHeadline`, `ctaSub`.

Prompt structure that produced good results: (1) pick the SEO opportunity —
primary service + distinguishing detail + city/neighbourhood; (2) head elements;
(3) 5-8 sections in a fixed order (backstory, problem, the work, the result,
plus at least one educational deep-dive with bullets); (4) internal link to the
best-fit service page; (5) CTA; (6) one alt text per photo; (7) voice guardrails
+ banned-phrase list.

**What must become data, not code, in the agnostic app.** TreeCheck hardcodes
these into the prompt — every one of them is industry- or tenant-specific:

| Hardcoded in TreeCheck | Move to |
| --- | --- |
| Company name, owner, phone, website, estimate page | `dma_integrations` fields (or a tenant JSON blob) |
| `SERVICE_SLUGS` list (tree-removal, stump-grinding, …) | per-tenant service slug list, loaded and injected into the tool enum at request time |
| Region/default city ("Edmond, OK") | tenant `service_areas` — never a literal in the function |
| Arborist-specific deep-dive instructions (species, ice storms) | generic "educational deep-dive about the trade/material/local conditions" + the tenant's `brand_voice` |
| `seeAlsoAnchor` fallback string | template built from tenant city + service |
| Banned phrases / tone | keep the generic list in code, let `brand_voice` win on style |

Location rule (a real bug worth avoiding): use the location the AI extracted
from the memo; if empty, fall back to the **publishing tenant's own first
service area**. Never a literal city in the function — TreeCheck shipped a
`"Nashville, TN"` fallback that ended up on an Oklahoma company's pages.

### 3.5 Photo normalization (required — do not skip)

For each photo path, download from storage then:

- decode, and if the long edge > **1600px** resize with aspect preserved
  (imagescript `RESIZE_AUTO`) — **no cropping, ever**;
- re-encode JPEG at quality 80, then 70 / 60 / 50 until the file is under
  **~700 KB**;
- name them `hero.jpg`, `photo-2.jpg`, … (index 0 is the cover);
- base64 each and accumulate; if adding one would push the total base64 over
  **~4,000,000 chars**, drop that photo (keep at least the cover). Serverless
  receivers commonly cap request bodies near 6 MB.

On `republish`, photos are re-fetched and re-normalized too, which is how
oversized legacy posts get fixed.

---

## 4. The website side — what every registered site must implement

One HTTPS endpoint, e.g. `POST https://<tenant-site>/api/public/dma-inbound`,
reachable without a site login.

### 4.1 Contract

Headers we send:

```
Authorization: Bearer <shared secret>
Content-Type: application/json
```

Body:

```jsonc
{
  "slug": "oak-elm-tree-removal-guthrie",
  "title": "Removing an Oak and an Elm in Guthrie",
  "location": "Guthrie, OK",
  "summary": "one-sentence card blurb",
  "challenge": "flattened text of section 1",
  "approach":  "flattened text of section 2",
  "result":    "flattened text of section 3",
  "seoTitle": "...", "metaDescription": "...",
  "shortDescription": "...", "intro": "...",
  "heroAlt": "...", "photoAlts": ["...", "..."],
  "sections": [
    {
      "heading": "THE BACKSTORY",
      "paragraphs": ["para 1", "para 2"],
      "bullets": [],
      "body":    "para 1\n\npara 2",   // aliases — same text, different keys
      "text":    "para 1\n\npara 2",
      "content": "para 1\n\npara 2",
      "html":    "<p>para 1</p>\n<p>para 2</p>"
    }
  ],
  "serviceCategory": "tree-removal",
  "seeAlsoServiceSlug": "tree-removal",
  "seeAlsoAnchor": "tree removal in Edmond and Oklahoma City",
  "ctaHeadline": "GOT A TREE THAT NEEDS TO GO?",
  "ctaSub": "Send a photo and we'll get you a number.",
  "photos": [
    { "filename": "hero.jpg", "base64": "…", "contentType": "image/jpeg", "isCover": true }
  ]
}
```

Why the `body` / `text` / `content` / `html` aliases exist: the first tenant
renderer read `body` and silently rendered empty section shells because we only
sent `paragraphs`. Sending all four keys makes the payload work with any
renderer. Keep them.

### 4.2 Required receiver behaviour

1. `401` on a missing/mismatched bearer secret (constant-time compare).
2. Accept request bodies up to ~5 MB.
3. Decode each `photos[].base64` and store it (repo asset, object storage, or a
   media table). The `isCover` photo is the hero.
4. **UPSERT by `slug`** — an existing slug is an update, not a new post. This is
   what makes revision/regenerate non-duplicating.
5. Render/rebuild the page at a stable public path, e.g.
   `/featured-jobs/<slug>`, with `seoTitle` / `metaDescription` in the head,
   `title` as the only H1, alt text on every image, and each section heading as
   an H2 with its paragraphs and bullets.
6. Respond `200 {"ok": true, "url": "https://site/featured-jobs/<slug>"}`.
   The app stores that URL; if `url` is absent it falls back to
   `<public_site_url>/featured-jobs/<slug>`.
7. On failure, return a non-2xx **and** set an `x-dma-error: <reason>` header.
   The app logs and surfaces that header verbatim, which is the difference
   between a five-minute fix and an afternoon of guessing.

### 4.3 Three host patterns already proven in production

| Pattern | When | Gotchas hit |
| --- | --- | --- |
| **Static site + repo commit** (GitHub API writes page + images, host rebuilds) | site is a static React/Vite build with no backend | slowest (waits on a rebuild); needs a PAT with repo write; page component must be registered in the router; only worth it for a site we fully control |
| **Platform edge/serverless function** (e.g. a Supabase function on the site's own project) | the tenant site already has a backend | function bundle/body size limits — this is why we cap base64 at ~4 MB; used for Tree Giants after the host's own function limits blocked the direct route |
| **Cloudflare Worker in front of the domain** | static host, no backend, want instant publish | a Worker that is saved but **not deployed** answers `404` on the route — verify with a real POST; a route pattern that misses `/api/*` also 404s; wrong secret shows up as `401 Unauthorized` (that exact pair of symptoms cost us a day on thearborimage.com) |

---

## 5. Onboarding a new user's website — repeatable checklist

1. **Build the receiver** on the tenant site at `/api/public/dma-inbound` per §4
   and deploy/publish it. Confirm with a POST that returns `401` (not `404`) —
   `401` proves the route is live.
2. **Generate one shared secret** (e.g. `openssl rand -hex 32`).
3. **Store it on the tenant site** as an environment secret.
4. **Store it in the app's secret store** under a per-tenant name, e.g.
   `ACME_ROOFING_WEBHOOK_SECRET`.
5. **Point the account at it**: fill `dma_integrations` with
   `publish_endpoint_url`, `public_site_url`, `website_url`, the eligibility
   flag, `webhook_secret_name`, and a real `brand_voice` (scrape the tenant's
   own site for tone, services, phone, service area — a thin brand voice
   produces generic copy).
6. **Send one test post** from a test account on that tenant (one photo + a
   short memo). Confirm the returned URL renders with images, headings,
   paragraphs, and correct city.
7. **Press Regenerate** and confirm the same URL updates and no second post
   appears in the site's listing.
8. Only then hand the account to the customer.

---

## 6. Multi-tenant improvement to make in the new app

TreeCheck carries two pieces of technical debt. Do not port them:

1. **Hardcoded secret map.** The function holds
   `{ "<contractor-uuid>": "TENANT_WEBHOOK_SECRET" }` in code, so every new
   customer needs a code edit + deploy. Instead add
   `dma_integrations.webhook_secret_name` and read
   `Deno.env.get(row.webhook_secret_name)`. Validate the name against
   `^[A-Z0-9_]+$` before the env lookup so a bad DB value can't probe arbitrary
   env vars. Onboarding then becomes: add a secret, insert a row.
2. **Legacy default publish path.** TreeCheck still has a GitHub-commit branch
   plus an allow-list of contractor ids that may use it. The agnostic app should
   have exactly one path — webhook — and refuse to publish when a tenant has no
   endpoint configured. Fewer branches, no cross-tenant risk.

Also worth doing while porting: store `webhook_secret_name` and the service slug
list per tenant, and expose both on an admin screen so onboarding needs no
engineer at all.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401 Unauthorized` from the tenant site | bearer secret differs between the app secret store and the site env | re-set both sides to the same value; check for trailing newline |
| `404` from the tenant endpoint | receiver not deployed, or route pattern doesn't cover `/api/*` | deploy/publish the worker/function; POST until you get `401` |
| App returns `403 "DMA beta access required"` | entitlement flag off on the **owner** account (team member inherits it) | enable on the owner row |
| App returns `400 "No website is connected"` | no `dma_integrations` row, non-https endpoint, or eligibility flag not set | fill the integration row |
| Page renders with headings but no text | renderer reads `body`/`text`/`content`, payload only had `paragraphs` | send all aliases (§4.1) |
| Wrong city on the page | hardcoded location fallback | fall back to the tenant's own service area only |
| Publish fails on large photos / `413` | normalization skipped or base64 total over the receiver's body cap | enforce 1600px / 700 KB / ~4 MB total |
| Duplicate posts after an edit | receiver inserts instead of upserting by slug, or the app minted a new slug | upsert by slug; reuse the stored slug on revision |
| `500` with `ghForBrand is not defined`-style errors | branch-scoped variable used in the other branch | hoist shared clients above the branch |
| Function deployed but user still sees the old error | stale auth session in the client | full sign out / sign in (no app reinstall needed) |

---

## 8. Secrets checklist (app side)

- `LOVABLE_API_KEY` — AI Gateway (transcription + copy generation)
- `<TENANT>_WEBHOOK_SECRET` — one per tenant site
- storage + service-role access is provided by the platform; never expose the
  service role or the AI key to client code

Every AI and publish call is server-side only.
