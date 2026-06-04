import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { registerForTournament } from '@/lib/api';
import type { Tournament, ParticipantStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';

export interface RegisterButtonProps {
  tournament: Tournament;
  participantStatus: ParticipantStatus | null;
  isLoggedIn: boolean;
}

/**
 * Tournament self-registration CTA.
 *
 * States (only rendered while status === OPEN_REGISTRATION):
 * - not logged in: link to /login
 * - registered / checked in: green confirmation banner
 * - tournament full: muted notice
 * - otherwise: "Register now" button → POST /api/tournaments/:slug/register
 */
export function RegisterButton({ tournament, participantStatus, isLoggedIn }: RegisterButtonProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const register = useMutation({
    mutationFn: () => registerForTournament(tournament.slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tournament', tournament.slug] });
      void queryClient.invalidateQueries({ queryKey: ['participant-me', tournament.slug] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants', tournament.slug] });
    },
  });

  if (tournament.status !== 'OPEN_REGISTRATION') return null;

  if (participantStatus === 'REGISTERED' || participantStatus === 'CHECKED_IN') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-rizzotto-success/40 bg-rizzotto-success/10 px-4 py-2.5">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-rizzotto-success shrink-0"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-sm font-semibold text-rizzotto-success">
          {t('tournament.register.confirmed')}
        </span>
      </div>
    );
  }

  // Withdrawn / disqualified players get no re-register CTA (organizer call).
  if (participantStatus === 'WITHDRAWN' || participantStatus === 'DISQUALIFIED') return null;

  if (!isLoggedIn) {
    return (
      <Link
        to="/login"
        className="inline-flex items-center rounded border border-rizzotto-gold-500 px-4 py-2 text-sm font-semibold text-rizzotto-gold-500 hover:bg-rizzotto-gold-500/10 transition-colors"
      >
        {t('tournament.register.login_required')}
      </Link>
    );
  }

  const isFull =
    tournament.max_participants != null &&
    (tournament.participantCount ?? 0) >= tournament.max_participants;

  if (isFull) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-4 py-2.5">
        <span className="text-sm text-rizzotto-stone-400">{t('tournament.register.full')}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="forge"
        size="md"
        disabled={register.isPending}
        onClick={() => register.mutate()}
      >
        {register.isPending ? t('tournament.register.pending') : t('tournament.register.cta')}
      </Button>
      {register.isError && (
        <span className="text-xs text-rizzotto-danger">{(register.error as Error).message}</span>
      )}
    </div>
  );
}
