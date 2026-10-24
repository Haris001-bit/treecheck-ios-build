// What a locked screen shows an owner in the phone apps once they sell the company plans (payments milestone, Part B):
// one way in, the phone plan screen. The prices come from the App Store or Google Play there, never from here.
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function StorePlanPrompt({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-lg mx-auto py-10">
      <Card>
        <CardContent className="p-6 space-y-4 text-center">
          <Lock className="w-8 h-8 mx-auto text-primary" />
          <h2 className="text-xl font-black">{title}</h2>
          <p>{body}</p>
          <Button asChild className="w-full"><Link to="/plan">Choose a plan</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
