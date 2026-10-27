import { Link } from "react-router-dom";
import treecheckLogo from "@/assets/treecheck-white-login.png";

export default function Terms() {
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

      <main className="container max-w-3xl py-12 prose prose-neutral dark:prose-invert">
        <h1>Terms of Service</h1>
        <p className="text-muted-foreground"><em>Last updated: July 25, 2026</em></p>

        <p>
          These Terms of Service ("Terms") govern your use of TREECHECK ("we", "us",
          "the Service"), a lead marketplace and workflow platform for tree-service
          contractors. By creating an account or using the Service, you agree to
          these Terms.
        </p>

        <h2>1. Eligibility &amp; Accounts</h2>
        <ul>
          <li>You must be 18 or older and operating a legitimate tree-service business.</li>
          <li>You are responsible for keeping your login credentials secure and for all activity under your account.</li>
          <li>Accounts are issued per business. Additional team members require paid seats.</li>
        </ul>

        <h2>2. Leads &amp; Credits</h2>
        <ul>
          <li>Leads are sold on a credit basis. One credit equals one U.S. dollar of purchasing value.</li>
          <li>Each lead may be unlocked by a limited number of contractors. Unlocking is final once homeowner contact details are revealed, except as described in our refund policy.</li>
          <li>We do not guarantee that any lead will convert into a booked or completed job.</li>
          <li>Refund requests must be submitted through the app within the stated request window and are reviewed individually. Approved refunds are issued as account credits.</li>
        </ul>

        <h2>3. Subscriptions &amp; Billing</h2>
        <ul>
          <li>Subscriptions, add-ons, and team seats renew automatically until cancelled.</li>
          <li>Payments are processed by Stripe. Purchases made through a mobile app store are billed and managed by that store under its own terms.</li>
          <li>You authorize us to charge your saved payment method for renewals, credit purchases, and any auto-refill settings you enable.</li>
          <li>Cancelling stops future charges; it does not refund amounts already paid or credits already spent.</li>
        </ul>

        <h2>4. Acceptable Use</h2>
        <ul>
          <li>Do not resell, share, scrape, or redistribute lead data or homeowner contact information.</li>
          <li>Do not use the Service to send unlawful, harassing, or deceptive communications.</li>
          <li>Do not attempt to reverse engineer, disrupt, or gain unauthorized access to the Service.</li>
          <li>You must comply with all licensing, insurance, and consumer-protection laws applicable to your work.</li>
        </ul>

        <h2>5. Third-Party Integrations</h2>
        <p>
          The Service can connect to third-party tools you authorize, such as your
          CRM or field-service software. When you connect an integration, you grant
          us permission to read and write data in that account solely to provide the
          features you requested — for example creating clients, quotes, jobs, or
          invoices on your behalf. You may disconnect an integration at any time,
          after which we stop syncing. Your use of any third-party service remains
          governed by that provider's own terms.
        </p>

        <h2>6. Your Content</h2>
        <p>
          You retain ownership of photos, notes, and business information you upload.
          You grant us a limited license to store, process, and display that content
          to operate the Service and any marketing features you explicitly enable.
        </p>

        <h2>7. Service Availability</h2>
        <p>
          We aim for continuous availability but do not guarantee uninterrupted or
          error-free operation. We may modify, suspend, or discontinue features with
          reasonable notice where practical.
        </p>

        <h2>8. Termination</h2>
        <p>
          You may close your account at any time. We may suspend or terminate access
          for violations of these Terms, non-payment, or fraudulent activity. Unused
          credits are forfeited upon termination for cause.
        </p>

        <h2>9. Disclaimers &amp; Limitation of Liability</h2>
        <p>
          The Service is provided "as is" without warranties of any kind. To the
          maximum extent permitted by law, our total liability for any claim arising
          out of the Service is limited to the amount you paid us in the three months
          preceding the claim. We are not liable for indirect, incidental, or
          consequential damages, including lost profits or missed jobs.
        </p>

        <h2>10. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. Material changes will be
          communicated in-app or by email. Continued use after an update constitutes
          acceptance.
        </p>

        <h2>11. Contact</h2>
        <p>
          Questions about these Terms? Reach us through the Support page in the app.
        </p>

        <p className="text-sm text-muted-foreground">
          See also our <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </main>
    </div>
  );
}
