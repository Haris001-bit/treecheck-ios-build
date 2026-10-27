import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { Camera, MapPin, Ruler, Mic, Send, Inbox, CheckCircle2, Info } from "lucide-react";
import treecheckLogo from "@/assets/treecheck-white-login.png";
import measureTreeImg from "@/assets/measure-tree-circumference.png";

const steps = [
  {
    icon: Camera,
    title: "1. Take a photo of the tree",
    body: "Stand back far enough to get the whole tree in frame — trunk to top — plus anything nearby that matters (house, fence, power lines, driveway). One clear photo is all Scout needs to get started.",
  },
  {
    icon: MapPin,
    title: "2. Pick the service and enter the address",
    body: "Choose Tree Removal, Stump Grinding, or Pruning/Trimming, then fill in the property address. Homeowner name, phone, and email are optional but helpful for follow-up.",
  },
  {
    icon: Ruler,
    title: "3. Trunk diameter calculator (optional)",
    body: "You can skip this entirely. If you do measure, wrap a tape around the trunk at chest height (about 4.5 ft up) and enter the circumference in inches — Scout converts it to diameter (DBH) for you and tightens the estimate. No tape? Submit without it and the AI sizes the tree from the photo.",
    highlight: true,
  },
  {
    icon: Mic,
    title: "4. Add notes or a voice memo",
    body: "Tap Voice and just talk: access issues, slope, dead limbs, crane or bucket needed, how close it is to the roof. Speak naturally — Scout pulls the useful details out. Typed notes work too.",
  },
  {
    icon: Send,
    title: "5. Submit and keep working",
    body: "Hit submit and move on to the next property. You don't have to wait on the screen — Scout processes the capture in the background.",
  },
  {
    icon: Inbox,
    title: "6. Review the estimate in Scout Inbox",
    body: "When the AI estimate is ready you get a text and a push notification. Open Scout Inbox to see the price, adjust anything, and approve it. Approving turns the capture into a real lead (and a Jobber quote if your Jobber account is connected).",
  },
];

export default function ScoutGuide() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
          <img src={treecheckLogo} alt="TREECHECK" className="h-9 w-auto object-contain" />
          <Link to="/dashboard/instant-estimator" className="text-sm font-semibold text-primary hover:underline">
            Open Scout
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">How to use Scout</h1>
        <p className="mt-3 text-muted-foreground">
          Scout turns a photo, an address, and a quick voice memo into a priced tree-work estimate in about a
          minute. Here's the whole workflow — six steps, and one of them is optional.
        </p>

        <div className="mt-6 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/10 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-sm">
            <strong>The trunk diameter calculator is optional.</strong> You never need a measuring tape to submit
            a capture. Measuring just makes the estimate more precise — leave it blank and Scout estimates the
            size from your photo.
          </p>
        </div>

        <div className="mt-8 space-y-4">
          {steps.map((step) => (
            <Card key={step.title} className={step.highlight ? "border-primary/40" : undefined}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <step.icon className="h-5 w-5 text-primary" />
                  {step.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{step.body}</CardContent>
            </Card>
          ))}
        </div>

        <section className="mt-10">
          <h2 className="text-xl font-bold">Measuring the trunk (if you want to)</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Pull a measuring tape around the trunk at chest height, about 4.5 ft off the ground. Read the number
            where the tape meets, in inches, and type it into the circumference field. Scout does the math and
            shows you the diameter (DBH).
          </p>
          <img
            src={measureTreeImg}
            alt="Measuring tape wrapped around a tree trunk at chest height"
            className="mt-4 w-full max-w-md rounded-lg border bg-muted object-contain"
            loading="lazy"
          />
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-bold">Tips for better estimates</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {[
              "Shoot in daylight with the whole tree in frame — top to base.",
              "Show the obstacles: roof, fence, pool, power lines, tight gates.",
              "Say the hard parts out loud in the voice memo; that's what moves the price.",
              "Capture one tree per submission so each estimate stays clean.",
              "Add the homeowner's phone so the office can follow up fast.",
            ].map((tip) => (
              <li key={tip} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-10 flex flex-wrap items-center gap-4 border-t pt-6 text-sm">
          <Link to="/dashboard/instant-estimator" className="font-semibold text-primary hover:underline">
            Open Scout →
          </Link>
          <Link to="/install" className="text-muted-foreground hover:text-primary">
            Install the app
          </Link>
          <Link to="/support" className="text-muted-foreground hover:text-primary">
            Get help
          </Link>
        </div>
      </main>
    </div>
  );
}
