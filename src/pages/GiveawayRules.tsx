import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import treecheckLogo from '@/assets/treecheck-white-login.png';

/**
 * Official Rules for the RipSaw RS2511 giveaway, filled in 2026-10-29 from Mark's 2026-10-26 brief (entry when a trial
 * starts, no separate free entry, a prize worth more than $1,200), the first full rules draft, and the App Store seller
 * (Apple 5.3.1: the sponsor is the app's developer). A field set to `null` shows as a highlighted "To confirm" note.
 * The phone apps open this page from the website, so a change here reaches them with Publish alone.
 */
const RULES: Record<string, string | null> = {
  sponsor: 'TRADES MARKETING AI LLC (TreeCheck), 13496 McRaines Rd, Edmond, OK 73013, United States ("Sponsor").',
  eligibility: 'Open to legal residents of the 50 United States, the District of Columbia and Canada (excluding Quebec). Employees of Sponsor, and members of their immediate families or households, are not eligible.',
  age: 'Entrants must be at least 18 years old, or the age of majority in their state, province or territory if that is older, when they enter.',
  geography: 'The 50 United States, the District of Columbia and Canada, excluding Quebec.',
  startDate: "October 26, 2026 at 12:00 AM Central Time. Sponsor's computer is the official clock.",
  endDate: 'November 30, 2026 at 11:59 PM Central Time',
  prize: "One (1) prize: a ported RipSaw RS2511 chainsaw. The prize can't be exchanged for cash or transferred. If it becomes unavailable, Sponsor may substitute a prize of equal or greater value. The prize is provided as is; a ported (modified) saw may not be covered by the original manufacturer's warranty. The winner is responsible for using the prize safely and lawfully.",
  retailValue: 'More than $1,200 USD.',
  entryMethod: "Start a free 14-day TreeCheck trial during the giveaway period, either at app.treecheck.ai/start-trial or in the TreeCheck app for iPhone or Android. In the app, the trial starts when you choose your plan in the App Store or Google Play after creating your account. Each qualifying trial signup is automatically entered once. No separate form or checkbox is needed. There is no charge during the trial, and canceling before it ends doesn't cancel the entry.",
  entryLimit: 'Limit one entry per person and per email address. Extra entries are ignored. Entries made by script, bot or other automated means, or with false information, are void.',
  selection: 'The winner will be selected by random drawing from all eligible entries after the entry period closes. The plan, billing cycle or any other choice made at signup does not affect the odds of being selected.',
  notification: 'Sponsor will contact the potential winner by email and/or phone using the details given at signup. A Canadian resident must first correctly answer, without help, a time-limited mathematical skill-testing question.',
  responseDeadline: "The potential winner must reply within 7 days. If the potential winner can't be reached, doesn't reply in time, is found ineligible or doesn't meet these rules, the prize is forfeited and Sponsor may draw an alternate winner.",
  acceptance: "The potential winner may be required to sign a declaration of eligibility and release before receiving the prize. Sponsor will arrange delivery of the prize to the winner's address in the United States or Canada.",
  taxes: 'The winner is responsible for all taxes on the prize. A US winner may receive an IRS Form 1099 for the prize value and must provide a tax ID number to claim it.',
  odds: 'The odds of winning depend on the number of eligible entries received.',
  publicity: "Except where prohibited, the winner agrees that Sponsor may use their name, city and state or province to announce the winner, without further payment. To learn the winner's name, email support@treecheck.app within 60 days after the giveaway ends.",
  liability: "By entering, entrants agree to these rules and to Sponsor's decisions, which are final. Sponsor may disqualify anyone who tampers with the entry process or breaks these rules, and may cancel or change the giveaway if fraud, technical failure or anything else beyond its control affects how it runs, in which case it may draw from eligible entries received before the problem. Sponsor is not responsible for lost, late, incomplete or misdirected entries. To the extent the law allows, entrants release Sponsor and its affiliates, employees and agents from any claim arising from the giveaway or from accepting, possessing or using the prize.",
  privacy: 'Information given at signup is used to run the giveaway and contact the winner, as described in the TreeCheck Privacy Policy at app.treecheck.ai/privacy.',
  voidWhereProhibited: 'Void where prohibited or restricted by law.',
  governingLaw: 'These rules are governed by the laws of the State of Oklahoma, without regard to its conflict of law rules.',
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
  { title: 'Not affiliated', body: "This giveaway is not sponsored, endorsed or administered by, or associated with, Apple Inc., Google LLC, ECHO Incorporated, or the prize's manufacturer or modifier. Apple and Google are not sponsors of this giveaway and are not involved in it in any way." },
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
        <p className="text-sm text-muted-foreground"><em>Last updated: October 29, 2026</em></p>
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
