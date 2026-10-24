import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, Camera, Globe, Star, CalendarClock } from 'lucide-react';

const DEMO_URL = 'https://calendly.com/hello-tradesmarketing/30min';

/**
 * Shown when a contractor's account is not yet connected to the Digital
 * Marketing Agent (no website publishing endpoint / social accounts linked).
 * Explains what DMA does and links to a free demo booking.
 */
export default function DMANotConnected() {
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Your account isn't set up for the Digital Marketing Agent yet
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              The Digital Marketing Agent turns a finished job into marketing while you're still
              packing up the truck — no writing, no posting, no waiting on an agency.
            </p>
          </div>
        </div>

        <ul className="space-y-3 text-sm">
          <li className="flex items-start gap-3">
            <Camera className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <span className="text-foreground">
              Snap a few photos and talk into your phone for 30 seconds.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Globe className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <span className="text-foreground">
              A written, search-friendly job page is published on your own website automatically.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Star className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <span className="text-foreground">
              The same job is posted to your Google Business Profile, Facebook and Instagram, and
              your customer gets a review request.
            </span>
          </li>
        </ul>

        <p className="text-sm text-muted-foreground">
          Getting set up takes one short call: we connect your website and your social accounts for
          you, then it runs from your phone.
        </p>

        <Button asChild className="w-full gradient-primary">
          <a href={DEMO_URL} target="_blank" rel="noopener noreferrer">
            <CalendarClock className="mr-2 h-4 w-4" />
            Schedule a free demo
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
