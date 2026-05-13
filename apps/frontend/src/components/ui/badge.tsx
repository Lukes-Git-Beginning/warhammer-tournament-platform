import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-display uppercase tracking-wider',
  {
    variants: {
      variant: {
        default: 'bg-karaz-iron-800 border-karaz-iron-600 text-karaz-stone-200',
        gold: 'bg-karaz-gold-500/15 border-karaz-gold-500/40 text-karaz-gold-400',
        forge: 'bg-karaz-forge-500/20 border-karaz-forge-500/40 text-karaz-forge-400',
        blood: 'bg-karaz-blood-500/15 border-karaz-blood-500/40 text-karaz-blood-500',
        bronze: 'bg-karaz-bronze/15 border-karaz-bronze/40 text-karaz-bronze',
        success: 'bg-karaz-success/15 border-karaz-success/40 text-karaz-success',
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
