import { forwardRef, useState, type HTMLAttributes, type ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** When true, add the gold-rim treatment. */
  goldRim?: boolean;
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, goldRim = false, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-full',
        goldRim &&
          'ring-2 ring-rizzotto-gold-500/40 ring-offset-2 ring-offset-rizzotto-iron-950',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  ),
);
Avatar.displayName = 'Avatar';

export interface AvatarImageProps extends ImgHTMLAttributes<HTMLImageElement> {}

export const AvatarImage = forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, onError, alt = '', ...props }, ref) => {
    const [failed, setFailed] = useState(false);
    if (failed) return null;
    return (
      <img
        ref={ref}
        alt={alt}
        className={cn('h-full w-full object-cover', className)}
        onError={(e) => {
          setFailed(true);
          onError?.(e);
        }}
        {...props}
      />
    );
  },
);
AvatarImage.displayName = 'AvatarImage';

export interface AvatarFallbackProps extends HTMLAttributes<HTMLSpanElement> {}

export const AvatarFallback = forwardRef<HTMLSpanElement, AvatarFallbackProps>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'flex h-full w-full items-center justify-center bg-rizzotto-iron-800 font-display text-sm font-semibold text-rizzotto-gold-400 uppercase',
        className,
      )}
      {...props}
    />
  ),
);
AvatarFallback.displayName = 'AvatarFallback';
