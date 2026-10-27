import { Link } from "react-router-dom";
import { Mail, MessageSquare, HelpCircle } from "lucide-react";
import treecheckLogo from "@/assets/treecheck-white-login.png";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Support() {
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

      <main className="container max-w-3xl py-12 space-y-8">
        <div>
          <h1 className="text-4xl font-bold mb-3">Support</h1>
          <p className="text-muted-foreground text-lg">
            We're here to help. Most questions get answered the same business day.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <Mail className="w-6 h-6 text-primary mb-2" />
              <CardTitle>Email</CardTitle>
            </CardHeader>
            <CardContent>
              <a href="mailto:support@treecheck.app" className="text-primary font-medium">
                support@treecheck.app
              </a>
              <p className="text-sm text-muted-foreground mt-2">
                Best for billing, refunds, and account questions.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <MessageSquare className="w-6 h-6 text-primary mb-2" />
              <CardTitle>Text</CardTitle>
            </CardHeader>
            <CardContent>
              <a href="sms:+13036693816" className="text-primary font-medium">
                (303) 669-3816
              </a>
              <p className="text-sm text-muted-foreground mt-2">
                Fastest for urgent lead or app issues.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <HelpCircle className="w-6 h-6 text-primary mb-2" />
            <CardTitle>Common Questions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-semibold">How do I get a refund on a lead?</p>
              <p className="text-muted-foreground">
                Open the lead from your dashboard and tap "Request Refund".
                Refunds are reviewed within 1 business day. See our refund policy in-app.
              </p>
            </div>
            <div>
              <p className="font-semibold">How many contractors get each lead?</p>
              <p className="text-muted-foreground">
                A maximum of 3. Once unlocked by 3 contractors, the lead is sold out.
              </p>
            </div>
            <div>
              <p className="font-semibold">How do auto-refills work?</p>
              <p className="text-muted-foreground">
                When your wallet drops below your threshold, we'll charge your
                saved card and top you up. You can disable this anytime from Settings.
              </p>
            </div>
            <div>
              <p className="font-semibold">How do I close my account?</p>
              <p className="text-muted-foreground">
                Email support@treecheck.app and we'll close it within 24 hours.
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          TREECHECK · Hours: Mon–Fri 7am–6pm CT
        </p>
      </main>
    </div>
  );
}
