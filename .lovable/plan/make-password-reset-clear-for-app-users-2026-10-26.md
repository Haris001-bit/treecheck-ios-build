# Make password reset clear for app users

## Right now (no change needed for Daniel)
Opening the reset link in the browser is expected. Daniel should:
1. Tap the link in the email; it opens TreeCheck in his browser.
2. Type a new password twice and save.
3. Open the TreeCheck app and sign in with his email and that new password.

## Changes
1. Reset link always points to app.treecheck.ai (from the phone app it can currently point to the app's internal address, which can break the link).
2. After saving a new password, show: "Password saved. Open the TreeCheck app and sign in with your new password." Phone-app users are not pushed into the browser dashboard.
3. Forgot-password screen tells users the link opens in their browser, and that they come back to the app afterward.

## Technical details
- `ForgotPassword.tsx`: `redirectTo` uses `https://app.treecheck.ai/reset-password` when running natively (or always).
- `ResetPassword.tsx`: success state with the message above instead of auto-redirecting to the dashboard.
- Confirm app.treecheck.ai/reset-password is in the allowed auth redirect list.
