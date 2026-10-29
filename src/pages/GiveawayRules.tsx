import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import treecheckLogo from '@/assets/treecheck-white-login.png';

/**
 * Official Rules for the RipSaw RS2511 giveaway.
 * EDIT HERE BEFORE LAUNCH: every `null` shows on the page as a highlighted "To confirm" placeholder. Replace it with the
 * approved wording (plain text) and it shows as written. Only the details TreeCheck has confirmed are filled in.
 */
const RULES: Record<string, string | null> = {
  sponsor: null, // Sponsor legal name and mailing address
  eligibility: null, // Who can enter (for example, owners of tree-care businesses), and who can't (employees, families)
  age: null, // Minimum age
  geography: null, // Eligible states, provinces or countries
  startDate: null, // Giveaway start date and time
  endDate: 'November 30, 2026 at 11:59 PM Central Time',
  prize: 'One ported RipSaw RS2511 chainsaw.',
  retailValue: null, // Approximate retail value (ARV)
  entryMethod: 'Start a free 14-day TreeCheck trial during the giveaway period, either at app.treecheck.ai/start-trial or in the TreeCheck app for iPhone or Android. In the app, the trial starts when you choose your plan in the App Store or Google Play after creating your account. Each qualifying trial signup is automatically entered once. No separate form or checkbox is needed.',
  entryLimit: null, // One entry per person and/or per company
  selection: 'The winner will be selected by random drawing from all eligible entries after the entry period closes. The plan, billing cycle or any other choice made at signup does not affect the odds of being selected.',
  notification: null, // How and when the winner is notified
  responseDeadline: null, // How long the winner has to respond before an alternate is drawn
  acceptance: null, // Prize acceptance requirements (declaration, release, delivery)
  taxes: null, // Taxes on the prize
  odds: null, // Odds of winning
  publicity: null, // Publicity release, if applicable
  liability: null, // Limitations of liability
  privacy: null, // How entry information is used
  voidWhereProhibited: null, // Void where prohibited language
  governingLaw: null, // Governing law and disputes
};

function Value({ field, label }: { field: string; label: string }) {
  const v = RULES[field];
  if (v) return <>{v}</>;
  return (
    <mark className="rounded bg-accent px-1.5 py-0.5 text-accent-foreground not-italic">[To confirm: {label}]</mark>
  );
}

const SECTIONS: { title: string; body: ReactNode }[] = [
  { title: 'Sponsor', body: <Value field="sponsor" label="sponsor name and address" /> },
  { title: 'Eligibility', body: <Value field="eligibility" label="who can enter" /> },
  { title: 'Age requirement', body: <Value field="age" label="minimum age" /> },
  { title: 'Geographic eligibility', body: <Value field="geography" label="eligible states, provinces or countries" /> },
  { title: 'Giveaway start date', body: <Value field="startDate" label="start date and time" /> },
  { title: 'Giveaway end date', body: <Value field="endDate" label="end date" /> },
  { title: 'Prize description', body: <Value field="prize" label="prize description" /> },
  { title: 'Approximate retail value', body: <Value field="retailValue" label="approximate retail value" /> },
  { title: 'How to enter', body: <Value field="entryMethod" label="entry method" /> },
  { title: 'Entry limit', body: <Value field="entryLimit" label="one entry per person or company" /> },
  { title: 'Random winner selection', body: <Value field="selection" label="how the winner is selected" /> },
  { title: 'Winner notification', body: <Value field="notification" label="how the winner is notified" /> },
  { title: 'Response deadline', body: <Value field="responseDeadline" label="response deadline" /> },
  { title: 'Prize acceptance', body: <Value field="acceptance" label="prize acceptance requirements" /> },
  { title: 'Taxes', body: <Value field="taxes" label="taxes" /> },
  { title: 'Odds of winning', body: <Value field="odds" label="odds of winning" /> },
  { title: 'Publicity', body: <Value field="publicity" label="publicity release, if applicable" /> },
  { title: 'Limitations of liability', body: <Value field="liability" label="limitations of liability" /> },
  { title: 'Privacy', body: <Value field="privacy" label="privacy" /> },
  { title: 'Void where prohibited', body: <Value field="voidWhereProhibited" label="void where prohibited" /> },
  { title: 'Governing law', body: <Value field="governingLaw" label="governing law" /> },
  // Required for the phone apps (Apple 5.3.2): the stores are not part of the giveaway.
  { title: 'Apple and Google', body: 'Apple Inc. and Google LLC are not sponsors of this giveaway and are not involved in it in any way.' },
];

export default function GiveawayRules() {
  // The phone apps open this page from the website in their in-app browser (in_app=1, GiveawayRulesLink). From there it
  // links nowhere into the website's signup and prices (Apple 3.1.1).
  const inApp = new URLSearchParams(useLocation().search).get('in_app') === '1';
  useEffect(() => { document.title = 'Official Rules: RipSaw RS2511 Giveaway | TreeCheck'; }, []);
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container py-4 flex items-center justify-between gap-3">
          {inApp ? (
            <img src={treecheckLogo} alt="TreeCheck" className="h-8 sm:h-10 w-auto" />
          ) : (
            <Link to="/" className="shrink-0"><img src={treecheckLogo} alt="TreeCheck" className="h-8 sm:h-10 w-auto" /></Link>
          )}
          {!inApp && <Link to="/start-trial" className="text-sm text-muted-foreground hover:text-primary whitespace-nowrap">← Start trial</Link>}
        </div>
      </header>
      <main className="container max-w-3xl py-10 space-y-6">
        <h1 className="text-3xl font-black leading-tight">Official Rules: TreeCheck RipSaw RS2511 Giveaway</h1>
        <p className="text-sm text-muted-foreground"><em>Draft. Details marked "To confirm" will be finalized before launch.</em></p>
        {SECTIONS.map((s, i) => (
          <section key={s.title} className="space-y-1.5">
            <h2 className="text-lg font-bold">{i + 1}. {s.title}</h2>
            <p className="text-muted-foreground leading-relaxed">{s.body}</p>
          </section>
        ))}
        <p className="text-sm text-muted-foreground">Questions: <a href="mailto:support@treecheck.app" className="text-primary underline">support@treecheck.app</a></p>
      </main>
    </div>
  );
}
