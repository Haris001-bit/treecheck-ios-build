# TreeCheck Data Retention and Deletion Policy

**Company:** Trades Marketing AI LLC, doing business as TreeCheck
**Version:** 1.0 | **Effective:** 2026-10-23 | **Next review:** 2027-10-23 (at least yearly)
**Owner:** Mark Cafiero, Owner, mark@tradesmarketing.ai
**Approved by:** Mark Cafiero, on 2026-10-23

## Principles
- TreeCheck collects only the data it needs.
  - For Financial Pulse that is read-only bank and card accounts, balances and transactions from Plaid. TreeCheck can't move money.
  - Plus jobs and payments from Jobber.
- That data is used only to show the company owner their own business numbers. It is never sold, never used for advertising and never sent to an AI service.
- This policy follows applicable privacy laws, matches the public privacy policy at https://app.treecheck.ai/privacy, and is enforced in the product's code.

## How long data is kept
| Data | Kept | Then |
|---|---|---|
| Bank and card data from Plaid | While the company's account is active and that bank is connected | Deleted as below |
| Transactions of accounts marked personal during setup | Until setup is finished | Deleted when setup finishes, and never counted |
| Plaid access tokens (encrypted) | While the bank is connected | Deleted when the bank is removed |
| Jobber data | While the company's account is active | Deleted when the account is deleted |
| Account and job records | While the account is active, and longer only where the law requires | Deleted when the account is deleted |

## Deletion
- **Removing a bank:** TreeCheck closes the connection at Plaid, then deletes that bank's encrypted access token, accounts and transactions.
- **Deleting an account:** done in the app, or by request. TreeCheck first closes all of the company's bank connections at Plaid, then deletes its bank and Jobber data and the account. If Plaid can't be reached, nothing is deleted, and the owner can try again.
- **Requests:** people can ask to access, correct, export or delete their data by emailing support@treecheck.app. TreeCheck checks the request comes from the account holder and completes it within 30 days, unless the law requires keeping something.
- **Backups:** the host keeps backups for its standard period, after which they expire. Deleted data is restored only for disaster recovery, and is deleted again afterwards.

## Review
The owner reviews this policy at least once a year, and whenever the data TreeCheck collects or the laws that apply change. Any change is reflected in the public privacy policy.

## Version history
| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-23 | First version |
