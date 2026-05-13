import { Trans, useTranslation } from 'react-i18next';
import { Picture } from '@/components/ui/picture';

export function MusterCallAside() {
  const { t } = useTranslation();

  return (
    <aside className="flex flex-col gap-6 rounded-md border border-karaz-iron-700/50 bg-karaz-iron-900/40 p-6 backdrop-blur-sm">
      <div className="relative overflow-hidden rounded-md ring-1 ring-karaz-iron-700/60">
        <Picture
          src="/img/faction-banner-template"
          alt=""
          width={360}
          height={480}
          className="h-auto w-full object-cover saturate-[0.85] contrast-105"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, transparent 55%, rgba(17,15,14,0.65) 95%)',
          }}
        />
      </div>

      <div>
        <h2 className="font-display text-xl font-semibold text-karaz-gold-500">
          {t('tournament.create.aside.heading')}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-karaz-stone-300">
          {t('tournament.create.aside.body')}
        </p>
      </div>

      <ul className="flex flex-col gap-3 text-sm text-karaz-stone-300">
        {(['bullet_format', 'bullet_mode', 'bullet_draft'] as const).map((key) => (
          <li key={key} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-karaz-gold-500/70"
            />
            <span className="leading-relaxed">
              <Trans
                i18nKey={`tournament.create.aside.${key}`}
                components={{ strong: <strong className="text-karaz-stone-100 font-semibold" /> }}
              />
            </span>
          </li>
        ))}
      </ul>

      <p className="border-t border-karaz-iron-800/60 pt-4 text-xs italic text-karaz-stone-500">
        {t('tournament.create.aside.footnote')}
      </p>
    </aside>
  );
}
