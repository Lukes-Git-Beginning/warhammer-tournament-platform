import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { dismissSiteNotice, getSiteNotices } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { RIZZOTTOVERSE_INVITE } from '@/lib/arenaMod';

const NOTICE = 'arena-mod-release';

/**
 * One-time notice that RizzOtto's Arena Mod is out, for existing players who aren't on the RizzOttoverse
 * Discord server (members hear about it there). The server decides who sees it; dismissing it hides it for
 * good. New players get the same hints in onboarding instead, so it waits until onboarding is done.
 */
export function ArenaModReleaseBanner() {
  const { data: user } = useAuthQuery();
  const queryClient = useQueryClient();
  const onboarded = !!user && user.onboarded_at !== null;
  const { data } = useQuery({
    queryKey: ['site-notices', user?.id],
    queryFn: getSiteNotices,
    enabled: onboarded,
    staleTime: 30 * 60 * 1000,
  });
  const dismiss = useMutation({
    mutationFn: () => dismissSiteNotice(NOTICE),
    onMutate: () => queryClient.setQueryData(['site-notices', user?.id], { notices: [] }),
  });

  if (!onboarded || !data?.notices.includes(NOTICE)) return null;

  const button =
    'rounded border border-rizzotto-gold-500/40 px-3 py-1.5 text-xs text-rizzotto-gold-400 transition-colors hover:border-rizzotto-gold-400 hover:text-rizzotto-gold-300';
  return (
    <div
      role="status"
      className="border-b border-rizzotto-gold-500/30 bg-rizzotto-gold-500/10 px-4 py-3 text-sm text-rizzotto-stone-200"
    >
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-4 gap-y-2 sm:px-2 lg:px-4">
        <p className="min-w-0 flex-1">
          <strong className="text-rizzotto-gold-400">RizzOtto&apos;s Arena Mod is out.</strong> Every game on the
          Arena now runs with it: install it and enable only this mod. Join our Discord for match notifications and
          mod updates.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/how-to-play" className={button}>
            How to Play
          </Link>
          <a href={RIZZOTTOVERSE_INVITE} target="_blank" rel="noopener noreferrer" className={button}>
            Join the Discord ↗
          </a>
          <button
            type="button"
            onClick={() => dismiss.mutate()}
            className="rounded border border-rizzotto-iron-600 px-3 py-1.5 text-xs text-rizzotto-stone-300 transition-colors hover:border-rizzotto-iron-400 hover:text-rizzotto-stone-100"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
