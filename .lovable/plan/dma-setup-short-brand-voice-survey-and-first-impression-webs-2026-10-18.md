# DMA setup, short brand voice survey, and First Impression Websites

## Outcome
New companies can use DMA without a website built by TradesMarketing. Connected website customers keep automatic publishing; everyone else can generate the same job-based content and receive it by email. Website consultations are optional, not a setup requirement.

## Simple setup
1. **Company and delivery:** prefill company name, contact name, service area and email from their account; let them correct them. Ask for an optional existing website address. Clearly confirm where posts will be emailed; do not change their login email.
2. **Your brand voice:** six short questions, mostly tap-to-select, grouped into two short screens. Save progress and allow optional details to be skipped.
3. **Preview and finish:** show a short sample paragraph based on their answers, with an edit option. Confirm “Email my content” or the existing connected website destination, then open job capture. No website, social-account or bank connection required to use email mode.

Delivery depends on an actual configured publishing connection, not just a website URL or a paid DMA subscription. A website built elsewhere can still use emailed content.

## Shortened survey
Replace the long discovery questionnaire with these six DMA-focused questions:

| Question | In-app answers |
| --- | --- |
| **1. How should your company sound?** | Pick up to three: Friendly & neighborly / Calm & professional / Direct & no-nonsense / Educational / Thankful & family-oriented / Premium & polished. Optional “Other.” |
| **2. What worries your customers most?** | Pick up to three: Property damage / Safety / Fair pricing / No-shows & poor communication / Mess left behind / Pressure or unnecessary work. Optional “Other.” |
| **3. What do you want to be known for?** | Pick up to three: Careful work / Clear estimates / Reliable communication / Thorough cleanup / Honest recommendations / Difficult jobs. Optional short detail or real customer quote. Treat these as positioning, not verified credentials or guarantees. |
| **4. What is your local story?** | Optional short answer: local connection, why they started, or what makes them different. No invented years in business, ownership claims or community history. |
| **5. What should we say—or never say?** | Two optional short fields: favorite phrases and words, claims or tones to avoid. No scare tactics, fake urgency or invented credentials by default. |
| **6. Give us one example of your voice.** | Optional short answer to “A homeowner says another company quoted less. What would you say?” Or paste a real review or a sentence they naturally use. |

Company name, email and service area stay outside the voice survey. The long survey's many scales, influences and situational questions are consolidated into tone, concerns, standards, local identity, boundaries and one real example. Keep the complete survey as an optional later refinement, not required setup.

Save both the answers and a reusable voice summary. Apply that voice to job stories, social captions and revisions in both delivery modes. Company facts and job details remain the source of truth; never invent insurance, certification, pricing, availability or customer promises.

## Email-mode experience
- Same photos and job notes → generated job story and social-ready captions → review/edit → send to the confirmed company email.
- Include the photos or secure photo links and clearly separated content for their website, Google Business Profile, Facebook and Instagram. Email mode does not claim to publish to those destinations automatically.
- Keep a saved content history with copy, resend, delivery status and useful failure messages. Failed sends must be retryable without regenerating or duplicating posts.
- **Unlimited posts during the existing 14-day free trial**, as Mark requested. Remove the old three-post proposal; never restart, extend or add a second trial.
- After trial expiry, use the existing DMA entitlement and supported purchase rules. Preserve founder/website-included access and existing prices; no automatic enrollment or new charges. Paid non-website customers continue with email delivery.
- Preserve current publishing and social flows for connected customers; do not show them email-mode upsell reminders.

## First Impression Websites page
For companies without connected website publishing, “Explore First Impression Websites” opens a dedicated page inside the app—not Calendly directly.

The page will use **Mark's supplied marketing copy and approved website examples/images** to explain the offer, show the website product, and offer “Schedule a demo.” Its booking link goes to the Calendly event Mark confirms for website consultations. Do not assume the existing general DMA demo or paid setup consultation event is the correct one.

Keep the page optional and let users return to unfinished DMA setup without losing their answers. Do not invent testimonials, results, pricing or claims. Do not add native purchase paths or expose them to subcontractors.

## Current state and implementation
Inspection found that website publishing already reads a saved brand voice, but setup does not collect it. The current job submission requires a website publishing destination; recipient-email setup and generated-post email delivery still need implementation.

### Technical details
- Reuse `dma_integrations` and its existing `brand_voice` input; store structured survey answers, company delivery email and setup completion alongside protected company settings as appropriate.
- Separate content generation from website delivery so email mode uses the same generator and voice guidance without requiring a publishing endpoint.
- Reuse existing company access and DMA entitlement checks; validate company ownership/permissions and trial dates server-side. Keep capture-only contributors restricted to their existing permissions.
- Add authenticated, company-scoped content history and email delivery records with RLS and explicit grants; validate forms and sending requests on client and server, encode URLs and escape generated email content.
- Use the project's supported transactional email service after checking existing email configuration. Never put email credentials in the browser. Confirm delivery/retry behavior before claiming emails work.
- Preserve existing/native billing, legacy prices and test-only payment boundaries. No new pricing decision in this task.

## Build order and verification
1. Company email + short survey + reusable voice preview and settings editing.
2. Shared generation, email delivery and saved history; unlimited existing-trial access.
3. Optional First Impression Websites page and approved demo link.
4. Verify a signed-in non-website company can complete setup, generate, edit and receive a real test email; saved content reads back and resend works.
5. Test trial access immediately before and at expiry, paid email access, connected-publisher behavior, company isolation, rejected invalid email and delivery failures. Confirm no charges or changes to existing trial dates.

## Inputs still needed
- Mark's First Impression Websites marketing copy and approved examples/images.
- The Calendly URL specifically intended for that website demo/consultation.

These inputs block the final promotional page, not the independent email setup and brand voice work. This is the plan only; no app behavior or email delivery has been changed yet.
