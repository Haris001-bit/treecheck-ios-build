# Shared Sub Network, Two-Way Ratings, and a Scout-First Start

This plan reuses what already exists: sub profiles, trades and skills, availability, the Bid Board, dispatch, the $20/mo sub plan, and the "Request crew bids" button in Scout. It has three parts.

---

## Part 1: One local sub network shared by all companies

**Today:** each company keeps its own private list of subs. A sub who works for you and for another company exists twice, and each company has to find and invite subs on its own.

**Change:** each sub has **one profile** and can choose to be **"Open to work for other companies."**

- **For subs**
  - A new switch on the sub's Profile: "Let other tree companies in my area find me and send me jobs." It is on by default for paying subs.
  - The sub sets their home city and how far they'll travel (for example, 25 miles). These come from the existing service-area cities, OKC and Austin.
  - The sub keeps one availability calendar, no matter how many companies they work for.
  - A sub can hide themselves from any single company.
- **For owners (on My Subs)**
  - A new **"Find subs near you"** tab lists network subs by trade (climber, ground, stump grinder, crane). It shows their skills, star rating, jobs completed and whether they're taking work.
  - Owners can see names, ratings and skills. Phone and email stay hidden until the sub is hired or accepts the connection.
  - Owners can **Add to my subs** (the sub gets a notice and can decline) or mark a sub as a **Favorite**. Favorites get first refusal.
- **For jobs**
  - When an owner sends a job out, they choose who gets it: "My subs only," "My subs first, then the network after X minutes," or "Everyone nearby."
  - The default is "My subs first, then the network." This uses the existing first-refusal timer.
  - Subs see jobs from every company they're connected to in one Jobs to Bid list, labeled with the company name.
- **Your company:** your existing subs stay yours, and you still get first refusal on them. They just also become findable by others, but only if they switch the setting on.

## Part 2: Two-way 1–5 star ratings with flagging

- **When:** after a job is marked **Job complete**, both sides are asked to rate. The owner rates each hired sub, and each sub rates the company.
- **What:** 1–5 stars, plus quick tags. For subs: on time, safe, quality, equipment ready. For owners: paid on time, clear scope, safe site, fair. Written comments are optional.
- **Fairness**
  - Ratings are only allowed after a real hire, so nobody can leave a fake review.
  - Neither side sees the other's rating until both have submitted, or until 14 days pass.
  - A public average shows once someone has 3 or more ratings; before that it shows "New."
- **Where ratings show:**
  - Sub ratings show on sub cards, bids and "Find subs near you."
  - Owner ratings show on job cards in Jobs to Bid.
- **Flagging**
  - Anyone can tap **Report** on a review. Reasons: offensive language, false or unrelated, personal information, harassment, other.
  - Written comments are also screened automatically by AI when they are submitted. Comments that look abusive are held for review instead of being posted.
  - Reported or held reviews go to a new **Review Reports** queue in the TreeCheck admin menu. Admins can keep, hide the comment (stars still count), or remove the review.
  - A person can respond once, publicly, to each review about them.

## Part 3: A Scout-first start for new owners

**After setup, the owner lands on a "Start with Scout" screen instead of the leads list.**

1. **Big button: "Price your first job."** It opens the camera and upload directly. At least one photo is required, and the screen explains why.
2. **Address and customer details.** These are optional and can be added later.
3. **Choose how to price it** (two big cards):
   - **"Let AI estimate it."** The owner adds a voice memo or notes plus the trunk size, and the AI returns a price, difficulty and risk. The owner can adjust it.
   - **"I'll price it myself."** This goes straight to the worksheet: climber, rigging, ground crew, hours, disposal loads, crane, stump, chipper and extras. The total uses their rates.
   - The owner's choice is remembered as the default for next time. It is the same as the "AI estimate visibility" setting from setup, and can be changed on How we work.
4. **"Do you need subs for this job?"** This appears as the last question on the Scout job. Each answer fills in suggestions from the worksheet.
   - **Toggle:** No, my crew has it / Yes, I need help.
   - **If yes, a short form:**
     - Which roles: climber, ground workers, stump grinder, crane operator.
     - How many of each: pre-filled from the worksheet's ground crew count.
     - Estimated hours: pre-filled from the worksheet hours.
     - Equipment they must bring (chipper, mini skid, saws, truck/trailer).
     - Preferred dates.
     - Pay: either **"Ask for bids"** (subs name their price, which is the current flow) or **"I'll set the pay"** (a fixed hourly or per-job amount; subs just accept or pass).
   - **Send.** The job goes to the owner's subs first and then the network, using the rules in Part 1. For owners who already priced the job, this is the "Request help" flow planned earlier.
5. A simple **setup checklist** on the dashboard:
   - Price your first job in Scout
   - Set your rates
   - Invite or find subs
   - Connect your CRM

## Suggested order

1. Scout-first start and "Need subs?" (fastest win, and it drives Scout sign-ups)
2. Two-way ratings and flagging
3. Shared sub network and "Find subs near you"

## Open questions (sensible defaults are used unless you say otherwise)

- Network subs are visible only to companies in the same city/market. Default: yes.
- A sub can be connected to any number of companies. Default: unlimited.
- Owners pay nothing extra to use the network. It is included in Scout for now, and this can be revisited with advisors.

---

## Technical details

- **Network:**
  - Add `network_visible`, `home_city` and `travel_radius_miles` to a new `crew_profiles` table, one per sub user.
  - Existing `crew_members` rows become per-company **connections** that link a sub to an owner, with a `connection_status` (invited, active, declined, hidden) and `is_favorite`.
  - Migrate the existing rows by grouping on `user_id`.
  - New security-definer function `network_subs_near(city, trade)` returns the masked fields.
  - Broadcast in `bid-request-create` and `job-dispatch-open` gains an `audience` option (`own`, `own_then_network`, `all`), reusing `first_refusal_until`.
- **Ratings:**
  - Generalize into a `reviews` table: `job_id` (bid_request_id), `reviewer_user_id`, `reviewee_type` (crew or company), `reviewee_id`, `stars` 1–5, `tags` text[], `comment`, `status` (published, pending_review, hidden, removed), `revealed_at`, `response`.
  - Insert through an edge function that checks there was a real hire and screens comments with the AI Gateway.
  - Add a `review_reports` table with `review_id`, `reporter`, `reason`, `notes` and `status`.
  - Rating averages are recalculated by trigger into `crew_profiles.rating_avg` and a new `company_rating_avg` on `profiles`.
  - Migrate the existing `crew_ratings` table (currently unused in the UI) into `reviews`.
  - RLS rules:
    - Reviewers can insert through the function only.
    - Anyone logged in can read published reviews.
    - Admins can manage everything.
  - Add a new admin page, Review Reports.
- **Scout-first:**
  - Add a new `/dashboard/start` route shown after onboarding until the first Scout capture exists.
  - Add an `InstantEstimator` mode switch (`ai` or `manual`) saved to `company_settings.ai_estimate_visibility`.
  - Add a "Need subs?" step that extends `RequestCrewBidsDialog` with a roles/quantity/hours/equipment/pay-mode form. It is pre-filled from the `wk_*` worksheet fields.
  - New `pay_mode` (bid or fixed) and `fixed_pay` columns on `bid_requests`.
  - Add a setup checklist component on the Dashboard.
