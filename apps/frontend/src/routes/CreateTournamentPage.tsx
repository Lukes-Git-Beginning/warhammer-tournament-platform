import { useRequireAuth } from '@/lib/auth';
import { TournamentCreateForm } from '@/components/tournament/TournamentCreateForm';
import { MusterCallAside } from '@/components/tournament/MusterCallAside';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';

export function CreateTournamentPage() {
  const { data: user, isLoading } = useRequireAuth();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <PageShell variant="narrow" className="text-karaz-stone-400">
        {t('common.loading')}
      </PageShell>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <PageShell variant="wide">
      <header className="mb-8 max-w-2xl">
        <h1 className="font-display text-3xl font-bold text-karaz-gold-500">
          {t('tournament.create.title')}
        </h1>
        <p className="mt-2 text-sm text-karaz-stone-400">
          {t('tournament.create.subtitle')}
        </p>
      </header>

      {user.role === 'USER' && (
        <div className="mb-8 rounded-md border border-karaz-gold-500/30 bg-karaz-gold-500/10 p-4 text-sm text-karaz-gold-500">
          {t('tournament.create.role_warning')}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <Card variant="banner">
          <CardContent className="p-6 sm:p-8 lg:p-10">
            <TournamentCreateForm />
          </CardContent>
        </Card>

        <MusterCallAside />
      </div>
    </PageShell>
  );
}
