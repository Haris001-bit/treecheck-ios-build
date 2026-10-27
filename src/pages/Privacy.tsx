import { Link } from "react-router-dom";
import treecheckLogo from "@/assets/treecheck-white-login.png";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container py-4 flex items-center justify-between">
          <Link to="/">
            <img src={treecheckLogo} alt="TREECHECK" className="h-10 w-auto" />
          </Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-primary">← Home</Link>
        </div>
      </header>

      {/* The typography plugin behind "prose" isn't switched on in tailwind.config, so the page styles its
          own headings, paragraphs, lists and links (readable on the dark theme). */}
      <main className="container max-w-3xl py-12 prose prose-neutral dark:prose-invert [&_h1]:text-3xl [&_h1]:font-black [&_h1]:mb-1 [&_h2]:text-xl [&_h2]:font-black [&_h2]:mt-8 [&_h2]:mb-2 [&_p]:font-normal [&_p]:leading-relaxed [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ul]:space-y-2 [&_li]:font-normal [&_li]:leading-relaxed [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2">
        <h1>Privacy Policy</h1>
        <p className="text-muted-foreground"><em>Last updated: October 5, 2026</em></p>

        <p>
          TREECHECK ("we", "us") provides a lead marketplace and workflow tools
          for tree-service contractors. This policy explains what we collect,
          how we use it, and your rights.
        </p>

        <h2>1. Information We Collect</h2>
        <ul>
          <li><strong>Account info:</strong> name, email, phone, business name, service areas.</li>
          <li><strong>Lead data:</strong> homeowner name, address, phone, photos, and project details — only visible to you after you unlock a lead.</li>
          <li><strong>Payment info:</strong> processed securely by Stripe. We never store full card numbers.</li>
          <li><strong>Usage data:</strong> device type, app version, crash logs, and basic analytics to keep the app working.</li>
        </ul>

        <h2>2. How We Use It</h2>
        <ul>
          <li>Match leads to contractors in their service area.</li>
          <li>Process payments, refunds, and credit balances.</li>
          <li>Send SMS and push alerts about new leads, estimates, and account activity.</li>
          <li>Prevent fraud and enforce our Terms of Service.</li>
        </ul>

        <h2>3. Sharing</h2>
        <p>
          We do not sell your personal information. We share data only with
          service providers required to run TREECHECK (Stripe for payments,
          Twilio for SMS, Supabase for hosting, Apple/Google push services,
          Plaid for bank connections, and Jobber when you connect it).
        </p>

        <h2>4. Homeowner Privacy</h2>
        <p>
          Homeowner contact details (name, exact address, phone) are masked
          until a contractor unlocks the lead. Each lead is unlocked by a
          maximum of three contractors.
        </p>

        <h2>5. Financial Pulse: Bank and Jobber Connections</h2>
        <p>
          Financial Pulse is an optional profit dashboard for business owners.
          If you turn it on:
        </p>
        <ul>
          <li>
            <strong>Bank and card connections through Plaid:</strong> we use Plaid
            Inc. ("Plaid") to connect the business bank accounts and credit cards
            you choose. By connecting an account, you grant TREECHECK and Plaid the
            right, power and authority to act on your behalf to access and transmit
            your financial information from your bank. You agree to your
            information being transferred, stored and processed by Plaid in
            accordance with{" "}
            <a href="https://plaid.com/legal/#end-user-privacy-policy" target="_blank" rel="noopener noreferrer">
              Plaid's End User Privacy Policy
            </a>
            . We never see or store your bank username or password, and we can only
            read data. We cannot move money.
          </li>
          <li>
            <strong>What we receive:</strong> account names, the last four digits of
            account numbers, account types, balances, and transactions (date,
            amount, description, merchant and category). We use them only to show
            your business's profit, costs and payroll in Financial Pulse.
          </li>
          <li>
            <strong>Jobber:</strong> if you connect Jobber, we read your jobs, visits,
            invoice totals and the payments you record, to count your sales.
          </li>
          <li>
            <strong>Who sees it:</strong> only your company's owner login. Team
            members and other companies cannot see it. We do not sell this data,
            use it for advertising, or send it to any AI service.
          </li>
          <li>
            <strong>Personal accounts:</strong> accounts you mark as not business are
            never counted, and their transactions are deleted when you finish setup.
          </li>
          <li>
            <strong>Security:</strong> the keys that connect your bank are encrypted.
          </li>
          <li>
            <strong>Disconnecting and deletion:</strong> to disconnect a bank, email{" "}
            <a href="mailto:support@treecheck.app">support@treecheck.app</a>. If you
            delete your TREECHECK account, we disconnect your banks at Plaid and
            delete your bank and Jobber data.
          </li>
        </ul>

        <h2>6. Data Retention</h2>
        <p>
          We retain account and transaction records as long as your account is
          active and as required by law. You can request deletion of your
          account at any time by emailing <a href="mailto:support@treecheck.app">support@treecheck.app</a>.
        </p>

        <h2>7. Your Rights</h2>
        <p>
          You may access, correct, export, or delete your personal data. To
          exercise these rights, contact <a href="mailto:support@treecheck.app">support@treecheck.app</a>.
        </p>

        <h2>8. Children</h2>
        <p>TREECHECK is not directed to anyone under 18.</p>

        <h2>9. Changes</h2>
        <p>
          We may update this policy. Material changes will be announced in-app
          or by email.
        </p>

        <h2>10. Contact</h2>
        <p>
          TREECHECK · <a href="mailto:support@treecheck.app">support@treecheck.app</a>
        </p>
      </main>
    </div>
  );
}
