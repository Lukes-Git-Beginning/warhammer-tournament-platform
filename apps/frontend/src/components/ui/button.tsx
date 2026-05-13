import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-display font-semibold tracking-wider uppercase',
    'transition-[transform,background-color,box-shadow,color,border-color]',
    'duration-base ease-burn',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-karaz-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-karaz-iron-950',
    'disabled:pointer-events-none disabled:opacity-50',
    'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
  ].join(' '),
  {
    variants: {
      variant: {
        forge:
          'bg-karaz-gold-400 text-karaz-iron-950 shadow-karaz-emboss hover:bg-karaz-gold-500 hover:shadow-karaz-forge-glow hover:-translate-y-px active:translate-y-0 active:bg-karaz-gold-600',
        iron: 'bg-karaz-iron-800 text-karaz-stone-100 border border-karaz-iron-600 shadow-karaz-emboss hover:bg-karaz-iron-700 hover:border-karaz-iron-500 hover:text-karaz-gold-300 active:bg-karaz-iron-800',
        etched:
          'bg-transparent text-karaz-stone-300 border border-karaz-iron-700 hover:border-karaz-gold-500 hover:text-karaz-gold-400 active:bg-karaz-iron-900',
        banner:
          'bg-karaz-forge-500 text-karaz-iron-950 shadow-karaz-banner hover:bg-karaz-forge-400 hover:-translate-y-px active:translate-y-0 active:bg-karaz-forge-600',
        ghost: 'bg-transparent text-karaz-stone-300 hover:bg-karaz-iron-800 hover:text-karaz-stone-100',
        danger: 'bg-karaz-blood-500 text-karaz-stone-100 hover:bg-karaz-blood-600',
      },
      size: {
        sm: 'h-9 px-4 text-[12px] rounded-sm',
        md: 'h-11 px-6 text-[13px] rounded-md',
        lg: 'h-14 px-10 text-[14px] rounded-md',
        icon: 'size-11 rounded-md p-0',
      },
    },
    defaultVariants: {
      variant: 'iron',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
