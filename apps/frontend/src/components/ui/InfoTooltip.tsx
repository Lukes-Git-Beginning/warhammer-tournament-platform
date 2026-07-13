import type { ReactNode } from 'react';

/**
 * Lightweight hover tooltip (no dependency). Wraps a trigger; on hover/focus it
 * fades in a short explanatory text below it. Used for Format/Mode explanations on
 * the tournament page. `text` empty → renders the trigger without a tooltip.
 */
export function InfoTooltip({ text, children }: { text?: string | null; children: ReactNode }) {
  if (!text) return <>{children}</>;
  return (
    <span className="group/tip relative inline-flex cursor-help items-center" tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-64 max-w-[80vw] -translate-x-1/2 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-950 px-3 py-2 text-xs font-normal normal-case leading-snug tracking-normal text-rizzotto-stone-300 opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 group-focus/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
