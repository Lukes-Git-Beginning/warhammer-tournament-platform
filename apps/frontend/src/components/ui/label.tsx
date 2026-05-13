import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'mb-1.5 block text-sm font-medium text-karaz-stone-300',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      {required && <span className="ml-0.5 text-karaz-forge-500">*</span>}
    </label>
  ),
);
Label.displayName = 'Label';

interface FieldErrorProps {
  message?: string;
}

export function FieldError({ message }: FieldErrorProps) {
  if (!message) return null;
  return <p className="mt-1.5 text-xs text-karaz-forge-400">{message}</p>;
}

export function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs text-karaz-stone-400">{children}</p>;
}
