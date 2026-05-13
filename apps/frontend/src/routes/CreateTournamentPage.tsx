import { useRequireAuth } from '@/lib/auth';
import { TournamentCreateForm } from '@/components/tournament/TournamentCreateForm';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';

export function CreateTournamentPage() {
  const { data: user, isLoading } = useRequireAuth();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <PageShell variant="tight" className="text-karaz-stone-400">
        {t('common.loading')}
      </PageShell>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <PageShell variant="tight">
      <h1 className="font-display text-3xl font-bold text-karaz-gold-500 mb-2">
        {t('tournament.create.title')}
      </h1>
      <p className="text-karaz-stone-400 mb-8 text-sm">
        {t('tournament.create.subtitle')}
      </p>

      {user.role === 'USER' && (
        <div className="mb-8 rounded-md border border-karaz-gold-500/30 bg-karaz-gold-500/10 p-4 text-sm text-karaz-gold-500">
          {t('tournament.create.role_warning')}
        </div>
      )}

      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 30%, rgba(216,99,42,0.10), transparent 70%)',
          }}
        />
        <Card variant="banner">
          <CardContent className="p-6 sm:p-8 lg:p-10">
            <TournamentCreateForm />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
