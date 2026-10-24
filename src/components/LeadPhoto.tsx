import { useSignedPhotoUrl } from '@/hooks/useSignedPhotoUrl';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface LeadPhotoProps {
  photoUrl: string | null | undefined;
  alt?: string;
  className?: string;
  aspectRatio?: 'video' | 'square' | '4/3';
  objectFit?: 'contain' | 'cover';
}

export function LeadPhoto({ 
  photoUrl, 
  alt = "Tree for removal",
  className,
  aspectRatio = '4/3',
  objectFit = 'contain'
}: LeadPhotoProps) {
  const { signedUrl, isLoading } = useSignedPhotoUrl(photoUrl);

  const aspectClass = {
    'video': 'aspect-video',
    'square': 'aspect-square',
    '4/3': 'aspect-[4/3]',
  }[aspectRatio];

  const objectFitClass = objectFit === 'contain' ? 'object-contain' : 'object-cover';

  if (isLoading || !signedUrl) {
    return (
      <div className={cn(aspectClass, "bg-muted", className)}>
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  return (
    <div className={cn(aspectClass, "bg-muted relative overflow-hidden", className)}>
      <img
        src={signedUrl}
        alt={alt}
        className={cn("w-full h-full", objectFitClass, "bg-muted")}
        onError={(e) => {
          (e.target as HTMLImageElement).src = '/placeholder.svg';
        }}
      />
    </div>
  );
}
