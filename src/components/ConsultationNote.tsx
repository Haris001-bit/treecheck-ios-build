import { Wrench } from 'lucide-react';

export const CONSULTATION_URL = 'https://calendly.com/hello-tradesmarketing/new-client-kickoff-call';

/**
 * Shown on setup and estimate-worksheet screens: offers a custom setup for
 * companies whose billing doesn't fit the standard worksheet.
 */
export function ConsultationNote({ className }: { className?: string }) {
  return (
    <div className={`rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground ${className ?? ''}`}>
      <div className="flex items-start gap-2">
        <Wrench className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
        <p>
          We can customize this for you. Whether you use man-hours or your own proprietary billing
          method, we can customize your account appropriately.{' '}
          <a
            href={CONSULTATION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Click here to schedule a consultation.
          </a>{' '}
          <span className="font-medium text-foreground">Setup fee required.</span>
        </p>
      </div>
    </div>
  );
}
