import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { PageBackdrop } from './PageBackdrop';

const pageShellVariants = cva('relative mx-auto w-full px-4 sm:px-6 lg:px-8 xl:px-12', {
  variants: {
    variant: {
      tight: 'container-tight',
      narrow: 'container-narrow',
      wide: 'container-wide',
      full: 'container-full',
    },
    spacing: {
      none: '',
      tight: 'py-6 lg:py-8',
      base: 'py-10 lg:py-14',
      loose: 'py-14 lg:py-20',
    },
  },
  defaultVariants: {
    variant: 'narrow',
    spacing: 'base',
  },
});

export interface PageShellProps
  extends HTMLAttributes<HTMLElement>,
    VariantProps<typeof pageShellVariants> {
  as?: 'main' | 'section' | 'div';
  children: ReactNode;
  /** Render the atmospheric inner-page backdrop. Defaults to true. */
  backdrop?: boolean;
}

export const PageShell = forwardRef<HTMLElement, PageShellProps>(
  ({ className, variant, spacing, as: Tag = 'main', backdrop = true, children, ...props }, ref) => {
    const Component = Tag as 'main';
    return (
      <>
        {backdrop && <PageBackdrop />}
        <Component
          ref={ref as React.Ref<HTMLElement>}
          className={cn(pageShellVariants({ variant, spacing, className }))}
          {...props}
        >
          {children}
        </Component>
      </>
    );
  },
);
PageShell.displayName = 'PageShell';

export { pageShellVariants };
