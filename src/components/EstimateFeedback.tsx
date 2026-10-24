import { useEstimateFeedback, useUpsertEstimateFeedback, FeedbackValue } from '@/hooks/useEstimateFeedback';
import { cn } from '@/lib/utils';
import { CheckCircle } from 'lucide-react';

interface EstimateFeedbackProps {
  leadId: string;
  estimateLow: number;
  estimateHigh: number;
  jobType: string;
  city: string;
}

const options: { value: FeedbackValue; label: string; emoji: string }[] = [
  { value: 'too_low', label: 'Too Low', emoji: '👇' },
  { value: 'about_right', label: 'About Right', emoji: '✅' },
  { value: 'too_high', label: 'Too High', emoji: '👆' },
];

export function EstimateFeedback({ leadId, estimateLow, estimateHigh, jobType, city }: EstimateFeedbackProps) {
  const { data: existing, isLoading } = useEstimateFeedback(leadId);
  const upsertMutation = useUpsertEstimateFeedback();

  const currentFeedback = existing?.feedback ?? null;

  const handleClick = (value: FeedbackValue) => {
    upsertMutation.mutate({
      leadId,
      feedback: value,
      aiEstimateLow: estimateLow,
      aiEstimateHigh: estimateHigh,
      jobType,
      location: city,
    });
  };

  if (isLoading) return null;

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <p className="text-sm font-medium text-foreground mb-3">
        Does this estimate feel right to you?
      </p>
      <div className="flex gap-2">
        {options.map((opt) => {
          const isSelected = currentFeedback === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => handleClick(opt.value)}
              disabled={upsertMutation.isPending}
              className={cn(
                "flex-1 px-3 py-2 rounded-full text-sm font-medium transition-all border",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              )}
            >
              {opt.emoji} {opt.label}
            </button>
          );
        })}
      </div>
      {currentFeedback && (
        <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
          <CheckCircle className="h-3.5 w-3.5 text-primary" />
          <span>Thanks for your feedback — this helps our AI improve.</span>
        </div>
      )}
    </div>
  );
}
