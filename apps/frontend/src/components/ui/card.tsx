import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const cardVariants = cva(
  [
    'relative overflow-hidden',
    'transition-[transform,background-color,border-color,box-shadow]',
    'duration-base ease-burn',
    'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
  ].join(' '),
  {
    variants: {
      variant: {
        stone: 'bg-rizzotto-iron-900 border border-rizzotto-iron-600 rounded-lg shadow-rizzotto-emboss',
        banner:
          'bg-rizzotto-iron-900 border border-rizzotto-iron-600 rounded-lg shadow-rizzotto-banner before:absolute before:inset-0 before:bg-bronze-plate-texture before:bg-[length:512px_512px] before:opacity-[0.12] before:pointer-events-none before:mix-blend-overlay',
        parchment:
          'bg-rizzotto-iron-900 border border-rizzotto-bronze/30 rounded-lg shadow-rizzotto-banner before:absolute before:inset-0 before:bg-parchment-aged-texture before:bg-[length:512px_512px] before:opacity-[0.18] before:pointer-events-none before:mix-blend-overlay',
        forge:
          'bg-rizzotto-iron-900 border border-rizzotto-forge-500/40 rounded-lg shadow-rizzotto-banner before:absolute before:inset-0 before:bg-[radial-gradient(ellipse_at_center,rgba(216,99,42,0.16),transparent_70%)] before:pointer-events-none',
      },
      interactive: {
        true: 'cursor-pointer hover:border-rizzotto-iron-500 hover:bg-rizzotto-iron-800 hover:-translate-y-0.5 hover:shadow-rizzotto-banner',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'stone',
      interactive: false,
    },
  },
);

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, interactive, children, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, interactive, className }))} {...props}>
      <div className="relative z-10">{children}</div>
    </div>
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-2 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('font-display text-xl font-semibold text-rizzotto-stone-100', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-rizzotto-stone-400 leading-relaxed', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-6 pb-4', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center justify-between gap-3 px-6 pb-6 pt-2', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { cardVariants };
