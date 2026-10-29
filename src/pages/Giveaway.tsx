import { useEffect } from 'react';
import treecheckLogo from '@/assets/treecheck-white-login.png';
import { GiveawayBanner } from '@/components/giveaway/GiveawayBanner';
import { GiveawayRulesLink } from '@/components/giveaway/GiveawayRulesLink';
import { GIVEAWAY_END_LABEL, giveawayOpen } from '@/lib/giveaway';

/** Shareable giveaway page (QR codes, posts). Entering happens by starting the trial. */
export default function Giveaway() {
  const open = giveawayOpen();
  useEffect(() => { document.title = 'Win a Ported RipSaw RS2511 | TreeCheck'; }, []);
  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-12">
      {open ? (
        <GiveawayBanner ctaTo="/start-trial" />
      ) : (
        <div className="max-w-xl mx-auto text-center space-y-3">
          <img src={treecheckLogo} alt="TreeCheck" className="h-12 w-auto mx-auto" />
          <h1 className="text-2xl font-black">This giveaway has ended</h1>
          <p className="text-muted-foreground">Entries closed {GIVEAWAY_END_LABEL}.</p>
          <GiveawayRulesLink className="text-sm underline text-muted-foreground">Official Rules</GiveawayRulesLink>
        </div>
      )}
    </div>
  );
}
