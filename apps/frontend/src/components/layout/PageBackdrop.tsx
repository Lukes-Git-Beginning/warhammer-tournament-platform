import { useState } from 'react';
import { Picture } from '@/components/ui/picture';

export interface PageBackdropProps {
  src?: string;
  opacity?: number;
}

export function PageBackdrop({
  src = '/img/inner-page-atmosphere-v2',
  opacity = 0.32,
}: PageBackdropProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-[1] overflow-hidden"
    >
      <Picture
        src={src}
        alt=""
        width={1920}
        height={1080}
        className="h-full w-full object-cover object-center saturate-[0.7] contrast-[1.05]"
        style={{ opacity, filter: 'brightness(0.85)' }}
        onError={() => setHasError(true)}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 70% at center, transparent 25%, rgba(8,7,10,0.65) 75%, rgba(8,7,10,0.92) 100%)',
        }}
      />
    </div>
  );
}
