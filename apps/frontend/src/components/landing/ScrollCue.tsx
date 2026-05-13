import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Subtle downward chevron + eyebrow shown at the bottom of the hero section.
 * Auto-hides once the user scrolls past 80px.
 */
export function ScrollCue({ className }: { className?: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY < 80);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none flex flex-col items-center gap-2 text-karaz-stone-400 transition-opacity duration-base ease-burn',
        visible ? 'opacity-80' : 'opacity-0',
        className,
      )}
    >
      <span className="font-display text-[10px] tracking-[0.3em] uppercase text-karaz-gold-500/80">
        Begin the Muster
      </span>
      <ChevronDown
        className="size-5 animate-bounce motion-reduce:animate-none"
        strokeWidth={1.25}
      />
    </div>
  );
}
