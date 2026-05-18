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
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rizzotto-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-rizzotto-iron-950',
    'disabled:pointer-events-none disabled:opacity-50',
    'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
  ].join(' '),
  {
    variants: {
      variant: {
        forge:
          'bg-rizzotto-gold-400 text-rizzotto-iron-950 shadow-rizzotto-emboss hover:bg-rizzotto-gold-500 hover:shadow-rizzotto-forge-glow hover:-translate-y-px active:translate-y-0 active:bg-rizzotto-gold-600',
        iron: 'bg-rizzotto-iron-800 text-rizzotto-stone-100 border border-rizzotto-iron-600 shadow-rizzotto-emboss hover:bg-rizzotto-iron-700 hover:border-rizzotto-iron-500 hover:text-rizzotto-gold-300 active:bg-rizzotto-iron-800',
        etched:
          'bg-transparent text-rizzotto-stone-300 border border-rizzotto-iron-700 hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-400 active:bg-rizzotto-iron-900',
        banner:
          'bg-rizzotto-forge-500 text-rizzotto-iron-950 shadow-rizzotto-banner hover:bg-rizzotto-forge-400 hover:-translate-y-px active:translate-y-0 active:bg-rizzotto-forge-600',
        ghost: 'bg-transparent text-rizzotto-stone-300 hover:bg-rizzotto-iron-800 hover:text-rizzotto-stone-100',
        danger: 'bg-rizzotto-blood-500 text-rizzotto-stone-100 hover:bg-rizzotto-blood-600',
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
