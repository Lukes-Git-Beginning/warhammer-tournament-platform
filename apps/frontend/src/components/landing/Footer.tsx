import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { KarazWordmarkImage } from '@/components/icons/KarazWordmarkImage';
import { Separator } from '@/components/ui/separator';

/**
 * Section 7 — Footer.
 * Stone-textured base of the landing page. Mini-sigil, legal lines,
 * navigation links, Games Workshop disclaimer.
 */
export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="relative isolate overflow-hidden bg-karaz-obsidian py-12">
      {/* Stone-wall texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-stone-wall-texture bg-[length:1024px_1024px] opacity-[0.08] mix-blend-soft-light"
      />

      <div className="mx-auto max-w-[80rem] px-4 sm:px-6 lg:px-8 xl:px-12">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <Link to="/" aria-label="Karaz Lists — home" className="inline-flex items-center transition-opacity hover:opacity-90">
            <KarazWordmarkImage bronze className="h-12 w-auto" loading="lazy" />
          </Link>
          <p
            aria-hidden="true"
            lang="la"
            title="Everlasting Realm"
            className="text-xs font-display italic tracking-wider text-karaz-bronze/80"
          >
            Karaz Ankor · "Where Lists Are Forged"
          </p>
        </div>

        <Separator engraved className="my-8" />

        <div className="flex flex-col items-center gap-6 text-sm text-karaz-stone-400 sm:flex-row sm:justify-between">
          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              <li>
                <Link to="/" className="hover:text-karaz-gold-400 transition-colors">
                  {t('header.home')}
                </Link>
              </li>
              <li>
                <Link to="/leaderboard" className="hover:text-karaz-gold-400 transition-colors">
                  {t('header.leaderboard')}
                </Link>
              </li>
              <li>
                <Link to="/meta" className="hover:text-karaz-gold-400 transition-colors">
                  {t('header.meta')}
                </Link>
              </li>
              <li>
                <Link to="/factions" className="hover:text-karaz-gold-400 transition-colors">
                  {t('header.factions')}
                </Link>
              </li>
            </ul>
          </nav>
          <p className="font-mono text-xs">© 2026 Karaz Lists</p>
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-karaz-stone-400/80">
          Not affiliated with Games Workshop. Warhammer, The Old World, and
          all related faction names are trademarks of their respective
          owners. Used for tournament identification only.
        </p>
      </div>
    </footer>
  );
}
