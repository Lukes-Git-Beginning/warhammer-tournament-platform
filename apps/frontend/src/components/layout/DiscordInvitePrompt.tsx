import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RizzottoSigil } from '@/components/icons/RizzottoSigil';
import { Button } from '@/components/ui/button';
import { dismissSiteNotice, getSiteNotices } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { RIZZOTTOVERSE_INVITE } from '@/lib/arenaMod';

const NOTICE = 'discord-invite';

/**
 * The weekly Discord prompt (backend lib/discord-invite.ts): full screen over the site for a player the
 * Monday check found off the RizzOttoverse server. "Join the server" opens the invite and closes it,
 * "Continue to the site" just closes it; it comes back after the next Monday's check while he is still
 * not on the server. No permanent opt-out (Alex, 2026-10-28): the bot is part of the site. It waits for
 * the welcome page of a new player to be done.
 */
export function DiscordInvitePrompt() {
  const { data: user } = useAuthQuery();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['site-notices', user?.id],
    queryFn: getSiteNotices,
    enabled: !!user,
    staleTime: 30 * 60 * 1000,
  });
  const dismiss = useMutation({
    mutationFn: () => dismissSiteNotice(NOTICE),
    onMutate: () =>
      queryClient.setQueryData<{ notices: string[] }>(['site-notices', user?.id], (prev) => ({
        notices: (prev?.notices ?? []).filter((n) => n !== NOTICE),
      })),
  });
  const open = !!user && user.onboarded_at !== null && !!data?.notices.includes(NOTICE);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      data-testid="discord-invite-prompt"
      className="fixed inset-0 z-50 overflow-y-auto bg-rizzotto-iron-950/97 backdrop-blur-sm"
    >
      <div className="flex min-h-screen w-full items-center justify-center px-4 py-16 sm:py-20">
        <div className="flex w-full max-w-xl flex-col items-center text-center">
          <div className="text-rizzotto-gold-400 drop-shadow-[0_0_36px_rgba(212,160,23,0.32)]">
            <RizzottoSigil className="size-20 sm:size-24" strokeWidth={1.5} />
          </div>
          <h1 className="mt-8 font-headline text-rizzotto-stone-100" style={{ fontSize: 'clamp(1.75rem, 4.5vw, 2.75rem)' }}>
            Join us on Discord
          </h1>
          <div className="mt-4 space-y-3 font-sans text-base leading-relaxed text-rizzotto-stone-300">
            <p>
              You&apos;re not on the RizzOttoverse, our Discord server, yet. That&apos;s how the site reaches you: match
              notifications come as DMs from our bot, and Discord only lets it message players who share a server
              with it.
            </p>
            <p>You also get tournament talk, announcements and mod updates there.</p>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href={RIZZOTTOVERSE_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => dismiss.mutate()}
              className="inline-flex items-center rounded-md border border-rizzotto-gold-500/60 bg-rizzotto-gold-500/15 px-6 py-2.5 font-medium text-rizzotto-gold-300 transition-colors hover:bg-rizzotto-gold-500/25"
            >
              Join the server ↗
            </a>
            <Button variant="etched" size="lg" onClick={() => dismiss.mutate()}>
              Continue to the site
            </Button>
          </div>
          <p className="mt-6 text-xs text-rizzotto-stone-500">
            We&apos;ll ask again once a week until you&apos;re on the server.
          </p>
        </div>
      </div>
    </div>
  );
}
