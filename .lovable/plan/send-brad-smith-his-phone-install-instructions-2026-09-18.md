# Send Brad Smith his phone install instructions

## Goal
Brad Smith (stump grinder) was invited, but he needs the same device-install walkthrough the other subs received, so he can get TreeCheck onto his phone's home screen and sign in.

## What happens
- Send Brad a text at 405-255-4961 with:
  - The install page link: https://app.treecheck.ai/crew-install (has separate iPhone and Android step-by-step instructions for adding the app to the home screen from the browser)
  - His login: brad__52@hotmail.com
  - His temporary password (Crewzk9gEF6fpu!1), in case the first invite text gets buried
- The install page tells iPhone users to open the link in Safari → Share → Add to Home Screen, and Android users to open it in Chrome → menu → Add to Home Screen.

## Technical details
- Reuse the existing invite/install SMS format sent through the notifications Edge Function (Twilio), pointing at the `/crew-install` page rather than app-store links.
- No code changes required; this is a one-off message send.
