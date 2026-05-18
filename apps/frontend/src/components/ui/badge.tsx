import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-display uppercase tracking-wider',
  {
    variants: {
      variant: {
        default: 'bg-rizzotto-iron-800 border-rizzotto-iron-600 text-rizzotto-stone-200',
        gold: 'bg-rizzotto-gold-500/15 border-rizzotto-gold-500/40 text-rizzotto-gold-400',
        forge: 'bg-rizzotto-forge-500/20 border-rizzotto-forge-500/40 text-rizzotto-forge-400',
        blood: 'bg-rizzotto-blood-500/15 border-rizzotto-blood-500/40 text-rizzotto-blood-500',
        bronze: 'bg-rizzotto-bronze/15 border-rizzotto-bronze/40 text-rizzotto-bronze',
        success: 'bg-rizzotto-success/15 border-rizzotto-success/40 text-rizzotto-success',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, className }))} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { badgeVariants };
