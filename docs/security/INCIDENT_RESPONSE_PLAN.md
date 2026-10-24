# TreeCheck Incident Response Plan

**Company:** Trades Marketing AI LLC, doing business as TreeCheck
**Version:** 1.0 | **Effective:** 2026-10-23 | **Next review:** 2027-10-23 (and after every incident)
**Incident lead and decision maker:** Mark Cafiero, Owner, mark@tradesmarketing.ai
**Approved by:** Mark Cafiero, on 2026-10-23

## What counts as an incident
Any suspected or confirmed:
- access to, or disclosure of, consumer financial data or other customer data by someone not allowed to see it;
- exposure of a secret, such as a Plaid access token or key, an API key or a password;
- compromise of a system listed in the Information Security Policy;
- loss of data or service caused by an attack.

## Steps
1. **Report.** Anyone who notices a possible incident tells the owner at once, by text or email. Reports from customers or partners come in through support@treecheck.app.
2. **Assess, within 4 hours.** The owner, with TreeCheck's developers, confirms what happened, which data and customers are affected, and the severity: critical, high or low.
3. **Contain.** As needed:
   - rotate the affected secrets and keys, including Plaid credentials and the key that encrypts Plaid access tokens;
   - switch off affected functions or features;
   - sign users out;
   - remove the access that was misused.
4. **Notify.**
   - **Plaid:** for anything involving data received from Plaid or Plaid credentials, email security@plaid.com as soon as possible and within 12 hours of discovery.
   - **Customers and authorities:** affected customers, and any authorities, are notified as applicable law requires (for example US state breach notification laws), in plain language, with what happened, what data was involved and what to do.
   - **Other partners:** Jobber, Stripe, Apple, Google and others, as their terms require.
5. **Fix and recover.** Remove the cause, restore service and data from backups if needed, and confirm the fix holds.
6. **Review within 5 business days.** Write down the timeline, the cause and what changes so it doesn't happen again. Update the policies if needed.

## Records and practice
Every incident and its review are kept for at least 3 years. The plan is walked through once a year with a short practice scenario.

## Contacts
| Who | How |
|---|---|
| Owner, incident lead | Mark Cafiero, mark@tradesmarketing.ai |
| Customer reports | support@treecheck.app |
| Plaid security | security@plaid.com |
