import { useTranslation } from 'react-i18next';
import { DiscordLoginButton } from '@/components/auth/DiscordLoginButton';
import { PageShell } from '@/components/layout/PageShell';

export function LoginPage() {
  const { t } = useTranslation();
  return (
    <PageShell variant="tight" spacing="loose" className="text-center">
      <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500 mb-4">
        {t('login.title')}
      </h1>
      <p className="text-rizzotto-stone-400 mb-8 text-sm leading-relaxed">
        {t('login.subtitle')}
      </p>
      <div className="flex justify-center">
        <DiscordLoginButton />
      </div>
    </PageShell>
  );
}
