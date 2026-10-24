# Clear crew installation guide with walkthrough video

## Goal
Turn the existing `/crew-install` page into the single link every invited person receives for understanding TreeCheck, installing it on their phone, and signing in.

## What will change
- Add the uploaded two-minute TreeCheck grounds walkthrough video near the top of the page, with standard play, pause, sound, fullscreen, and mobile controls.
- Rework the installation instructions into two clearly separated sections:
  - **iPhone:** open the page in Safari, tap Share, choose Add to Home Screen, then tap Add.
  - **Android:** open the page in Chrome, open the three-dot menu, choose Add to Home screen or Install app, then confirm.
- Make the critical browser and home-screen steps visually prominent and easy to scan on a phone.
- Keep the sign-in reminder and clearly explain that invited users should use the login details sent in their text.
- Update subcontractor and team invitation texts/emails so they point to this single video-and-instructions page instead of splitting account setup and installation directions across messages.

## Technical details
- Store the uploaded MP4 through the project’s hosted media flow rather than committing the 101 MB video into the app source.
- Preserve automatic device detection, while still allowing anyone to view both iPhone and Android instructions.
- Keep `/crew-install` public so an invited person can watch and follow it before signing in.
- Verify the page on a phone-sized screen and confirm all invitation paths use `https://app.treecheck.ai/crew-install`.
