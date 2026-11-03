import { useTranslation } from 'react-i18next';
import { DiscordLoginButton } from '@/components/auth/DiscordLoginButton';
import { PageShell } from '@/components/layout/PageShell';

export function LoginPage() {
  const { t } = useTranslation();
  const banned = new URLSearchParams(window.location.search).has('banned');
  return (
    <PageShell variant="tight" spacing="loose" className="text-center">
      <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500 mb-4">
        {t('login.title')}
      </h1>
      <p className="text-rizzotto-stone-400 mb-8 text-sm leading-relaxed">
        {t('login.subtitle')}
      </p>
      {banned && (
        <p className="mb-8 rounded-md border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {t('login.banned')}
        </p>
      )}
      <div className="flex justify-center">
        <DiscordLoginButton />
      </div>
    </PageShell>
  );
}
