import type { ReactNode } from 'react';
import { Card, CardContent } from './card';
import { Picture } from './picture';
import { RizzottoSigil } from '../icons/RizzottoSigil';
import { cn } from '@/lib/utils';

export type EmptyStateVariant = 'banner' | 'sigil' | 'compact';

export interface EmptyStateImage {
  src: string;
  alt?: string;
  width: number;
  height: number;
}

export interface EmptyStateProps {
  title: string;
  body: string;
  motto?: string;
  mottoTitle?: string;
  variant?: EmptyStateVariant;
  image?: EmptyStateImage;
  cta?: ReactNode;
  className?: string;
}

const epigraphClass =
  'font-display italic text-sm tracking-wider text-karaz-gold-500/70';

export function EmptyState({
  title,
  body,
  motto,
  mottoTitle,
  variant = 'sigil',
  image,
  cta,
  className,
}: EmptyStateProps) {
  if (variant === 'compact') {
    return (
      <div
        data-testid="empty-state-compact"
        className={cn('flex items-center gap-3 px-4 py-6', className)}
      >
        <RizzottoSigil
          aria-hidden="true"
          className="size-8 text-karaz-iron-600 opacity-50 shrink-0"
        />
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <span className="font-display text-sm font-semibold text-karaz-stone-200">
            {title}
          </span>
          <span className="text-sm text-karaz-stone-400">{body}</span>
        </div>
      </div>
    );
  }

  const headingAndCopy = (
    <div className={variant === 'banner' ? 'text-center sm:text-left' : 'text-center'}>
      <h3 className="font-display text-2xl font-semibold text-karaz-stone-100">
        {title}
      </h3>
      <p className="mt-3 text-karaz-stone-300">{body}</p>
      {motto && (
        <p
          aria-hidden="true"
          lang="la"
          title={mottoTitle}
          className={cn('mt-4', epigraphClass)}
        >
          {motto}
        </p>
      )}
      {cta && (
        <div
          className={cn(
            'mt-6 flex',
            variant === 'banner' ? 'justify-center sm:justify-start' : 'justify-center',
          )}
        >
          {cta}
        </div>
      )}
    </div>
  );

  if (variant === 'banner') {
    return (
      <Card
        variant="banner"
        data-testid="empty-state-banner"
        className={cn('mx-auto max-w-3xl overflow-hidden', className)}
      >
        <CardContent className="grid grid-cols-1 items-center gap-6 p-6 pb-6 sm:grid-cols-[auto_1fr] sm:gap-8 sm:p-8">
          {image ? (
            <Picture
              src={image.src}
              alt={image.alt ?? ''}
              width={image.width}
              height={image.height}
              className="mx-auto h-44 w-auto rounded-md ring-1 ring-karaz-iron-700/60"
            />
          ) : (
            <RizzottoSigil
              aria-hidden="true"
              className="mx-auto size-32 text-karaz-iron-600 opacity-60"
            />
          )}
          {headingAndCopy}
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      data-testid="empty-state-sigil"
      className={cn(
        'relative overflow-hidden rounded-md border border-karaz-iron-700 bg-karaz-iron-900/40',
        className,
      )}
    >
      <RizzottoSigil
        aria-hidden="true"
        className="pointer-events-none absolute right-6 top-1/2 size-48 -translate-y-1/2 text-karaz-iron-700 opacity-30 max-sm:left-1/2 max-sm:-translate-x-1/2"
      />
      <div className="relative z-10 mx-auto max-w-prose px-6 py-10 sm:px-10">
        {headingAndCopy}
      </div>
    </div>
  );
}
