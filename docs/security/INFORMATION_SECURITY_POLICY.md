# TreeCheck Information Security Policy

**Company:** Trades Marketing AI LLC, doing business as TreeCheck (Edmond, Oklahoma)
**Version:** 1.0 | **Effective:** 2026-10-23 | **Next review:** 2027-10-23 (at least yearly, and after any significant change or incident)
**Owner and security lead:** Mark Cafiero, Owner, mark@tradesmarketing.ai
**Approved by:** Mark Cafiero, on 2026-10-23

## 1. Purpose and scope
This policy sets out how TreeCheck identifies, reduces and monitors information security risks. It covers the TreeCheck web app (app.treecheck.ai), the iPhone and Android apps, and every system that stores, processes or deploys TreeCheck data:
- Lovable, which holds the code, deploys and secrets, and Lovable Cloud (Supabase), which holds the database, sign-in, server functions and file storage;
- the GitHub code repository;
- the Plaid Dashboard and the Jobber developer app;
- Stripe, RevenueCat, App Store Connect, Google Play Console and Codemagic;
- Twilio and Google, which send text and email notifications.

Everyone with access to these systems follows this policy.

## 2. Data classification
| Class | Examples | Rules |
|---|---|---|
| Restricted | Bank and card data received from Plaid: accounts, balances and transactions | Owner-only in the app, encrypted at rest, never used for advertising, never sold and never sent to an AI service |
| Secret | Plaid access tokens, API keys, signing keys and passwords | Kept only in the secret stores (section 4), never in code, git, logs or chat |
| Confidential | Account details, jobs, Jobber data and pricing | Visible only to the company and the people it authorizes |

## 3. Access control
- **Least privilege.** People get only the access their work needs. Each person has their own login, and shared accounts are not used.
- **Role-based access in the app.** Owner, team member (with per-permission switches) and admin roles are enforced in the database with row-level security. Bank data is visible only to the company owner's login. Team members, admins and other companies can't read it.
- **Production systems.** Access to the systems in section 1 is limited to the people named in the access review record.
- **Multi-factor authentication** is required on every account with access to production systems or consumer financial data.
- **Two-step sign-in for customers before bank linking.** A company owner must enter a 6-digit code from an authenticator app (TOTP) in the current session before Plaid Link opens or a bank connection is saved. The server enforces this, and the first use sets up the authenticator. An owner who loses their authenticator contacts support, which confirms they hold the account before removing it so they can set up a new one.
- **Removing access.** Access is removed within 1 business day when someone no longer needs it, and the secrets they could see are rotated.
- **Access reviews.** The owner reviews every system's members each quarter, removes anything unneeded, and records the review in the access review record.

## 4. Secrets and non-human access
- Services authenticate with OAuth tokens or API keys, always over TLS.
- Secrets live only in the hosting platform's encrypted secret store, with build-only keys in the build service's protected settings. They are never in code, git, logs or messages.
- Plaid access tokens are encrypted by TreeCheck with AES-256-GCM (a fresh random IV per token) in a table no browser can read. The key is kept outside the database, with an escrow copy held by the owner, and key versioning allows rotation.
- Secrets are rotated after suspected exposure, and when someone who could see them leaves.

## 5. Encryption
- **In transit:** TLS 1.2 or higher for all traffic. The app's domain refuses older TLS and sends HSTS.
- **At rest:** the database and file storage are encrypted at rest by the host (AES-256). Plaid access tokens are also encrypted at the application level (section 4).

## 6. Secure development and change management
- Code changes go through GitHub pull requests, with automated tests (application tests and database permission tests) passing before they are merged. Changes made in the development platform are checked in a preview before they are published.
- Changes are reviewed before they go live. Only the people named in the access review record deploy changes.
- Tests use sandbox test companies, never real customer data.
- Database changes ship as versioned migrations.

## 7. Vulnerability and patch management
- Dependencies are scanned for known vulnerabilities (npm audit) at least monthly and before every store release.
- Identified vulnerabilities are fixed within these times, counted from discovery:

  | Severity | Fix within |
  |---|---|
  | Critical | 7 days |
  | High | 30 days |
  | Medium | 90 days |
  | Low | the next scheduled update |

  A fix that needs a new phone app build ships in the next store release, and the risk is recorded until then.
- **End of life:** frameworks, runtimes, native app tooling and partner API versions (Plaid, Jobber, Stripe) are checked each quarter. Anything nearing end of support is upgraded before support ends.

## 8. Logging and monitoring
Server function logs and webhook event records are kept. Serious errors alert the owner by text message and are recorded. Unusual access or errors are investigated under the Incident Response Plan.

## 9. Vendors
TreeCheck relies on Lovable and Supabase (hosting), Plaid (bank connections), Jobber, Stripe, RevenueCat, Apple, Google, Twilio and Codemagic. Each is used only for its purpose, with the least access it needs. Vendors are reviewed every year, and when a new vendor is added.

## 10. Incidents, retention and continuity
- Security incidents follow the TreeCheck Incident Response Plan.
- Data retention and deletion follow the TreeCheck Data Retention and Deletion Policy.
- The host keeps database backups. Secrets that can't be recovered elsewhere, such as the Plaid token key, have an escrow copy with the owner.

## 11. Awareness
Everyone with access reads this policy, the Incident Response Plan and the Data Retention and Deletion Policy when they join and every year after.

## Version history
| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-23 | First version |
