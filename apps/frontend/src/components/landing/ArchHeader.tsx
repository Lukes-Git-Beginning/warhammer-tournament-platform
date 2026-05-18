import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ArchHeaderProps {
  icon: ReactNode;
  title: string;
  className?: string;
}

/**
 * Gothic-arch-inspired column header. A pointed-arch SVG outline above the
 * icon visually frames each column like a cloister opening.
 */
export function ArchHeader({ icon, title, className }: ArchHeaderProps) {
  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <svg
        viewBox="0 0 120 80"
        aria-hidden="true"
        className="mb-[-1.25rem] w-32 text-rizzotto-iron-600"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
      >
        {/* gothic arch outline */}
        <path d="M10 78 L10 40 Q10 8 60 8 Q110 8 110 40 L110 78" />
        {/* inner double-line */}
        <path d="M16 78 L16 42 Q16 14 60 14 Q104 14 104 42 L104 78" opacity="0.5" />
        {/* keystone diamond */}
        <path d="M60 14 L66 20 L60 26 L54 20 Z" />
        {/* base detail */}
        <path d="M4 78 L116 78" />
      </svg>
      <div className="z-10 mb-3 flex size-14 items-center justify-center rounded-full bg-rizzotto-iron-900 ring-1 ring-rizzotto-iron-600 text-rizzotto-gold-500">
        {icon}
      </div>
      <h3 className="font-display text-xl font-semibold uppercase tracking-wider text-rizzotto-stone-100">
        {title}
      </h3>
    </div>
  );
}
