import { DiscordLoginButton } from '@/components/auth/DiscordLoginButton';

export function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="font-display text-3xl font-bold text-warhammer-gold mb-4">Anmelden</h1>
      <p className="text-stone-400 mb-8 text-sm leading-relaxed">
        Melde dich mit deinem Discord-Account an, um an Turnieren teilzunehmen oder eigene
        Veranstaltungen zu erstellen.
      </p>
      <div className="flex justify-center">
        <DiscordLoginButton />
      </div>
    </main>
  );
}
