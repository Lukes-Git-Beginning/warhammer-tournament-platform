import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useRequireAuth } from '@/lib/auth.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { Card, CardContent } from '@/components/ui/card.js';
import { TournamentCreateForm, type SeriesModeConfig } from '@/components/tournament/TournamentCreateForm.js';

export function CreateSeriesPage() {
  const navigate = useNavigate();
  useRequireAuth();

  const seriesMode: SeriesModeConfig = {
    onSuccess: useCallback(
      (slug: string) => {
        void navigate({ to: '/series/$slug', params: { slug } });
      },
      [navigate],
    ),
  };

  return (
    <PageShell variant="wide">
      <header className="mb-8 max-w-2xl">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          Create Tournament Series
        </h1>
        <p className="mt-2 text-sm text-rizzotto-stone-400">
          Set up a multi-event series tracking standings across qualifier tournaments, then configure
          the Grand Final that crowns the champion.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <Card variant="banner">
          <CardContent className="p-6 sm:p-8 lg:p-10">
            <TournamentCreateForm seriesMode={seriesMode} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
