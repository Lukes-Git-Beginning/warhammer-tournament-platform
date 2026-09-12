import { Lock } from 'lucide-react';

/**
 * Subtle "Private" marker. A private tournament/series is only visible to those who can manage it
 * (host/co-host, moderators, admins); this quietly reminds them it is not public. Rendered only for
 * PRIVATE entities — public ones need no marker.
 */
export function PrivateBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Private — only hosts, moderators and admins can see this"
      className={`inline-flex items-center gap-1 rounded border border-stone-700 bg-stone-800/60 px-2 py-0.5 text-xs font-medium text-stone-400 ${className}`}
    >
      <Lock className="size-3" strokeWidth={2} aria-hidden="true" />
      Private
    </span>
  );
}
