import { useRequireAuth } from '@/lib/auth';
import { TournamentCreateForm } from '@/components/tournament/TournamentCreateForm';

export function CreateTournamentPage() {
  const { data: user, isLoading } = useRequireAuth();

  if (isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 text-stone-400">Wird geladen…</main>
    );
  }

  if (!user) {
    // useRequireAuth already navigates to /login — just render nothing
    return null;
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold text-warhammer-gold mb-2">
        Turnier erstellen
      </h1>
      <p className="text-stone-400 mb-8 text-sm">
        Erstelle ein neues Turnier für die TWW3-Community.
      </p>

      {user.role === 'USER' && (
        <div className="mb-8 rounded-md border border-warhammer-gold/30 bg-warhammer-gold/10 p-4 text-sm text-warhammer-gold">
          Du benötigst die Organizer-Rolle, um Turniere zu erstellen. Wende dich an einen
          Administrator, um deine Rolle zu upgraden.
        </div>
      )}

      <TournamentCreateForm />
    </main>
  );
}
