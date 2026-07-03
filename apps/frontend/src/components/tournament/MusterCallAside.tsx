import { useTranslation } from 'react-i18next';
import { Picture } from '@/components/ui/picture';

const FORMAT_KEYS = [
  'single_elim',
  'double_elim',
  'swiss',
  'auto_swiss',
  'round_robin',
  'liechtenstein',
  'balanced_liechtenstein',
] as const;

const MODE_KEYS = ['bpt', 'sft', 'slt', 'matrix'] as const;

/** Informational aside next to the Create Tournament form — explains Format and Mode. */
export function MusterCallAside() {
  const { t } = useTranslation();

  return (
    <aside className="flex flex-col gap-6 rounded-md border border-rizzotto-iron-700/50 bg-rizzotto-iron-900/40 p-6 backdrop-blur-sm">
      <div className="relative overflow-hidden rounded-md ring-1 ring-rizzotto-iron-700/60">
        <Picture
          src="/img/host-aside-v2"
          alt=""
          width={720}
          height={907}
          className="h-auto w-full object-cover saturate-[0.9] contrast-105"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'linear-gradient(180deg, transparent 60%, rgba(17,15,14,0.7) 100%)',
          }}
        />
      </div>

      <div>
        <h2 className="font-display text-xl font-semibold text-rizzotto-gold-500">
          {t('tournament.create.aside.heading')}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-rizzotto-stone-300">
          {t('tournament.create.aside.intro')}
        </p>
      </div>

      <section>
        <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-rizzotto-gold-400/90">
          {t('tournament.create.aside.format_label')}
        </h3>
        <dl className="mt-2 flex flex-col gap-2.5 text-sm">
          {FORMAT_KEYS.map((key) => (
            <div key={key}>
              <dt className="font-semibold text-rizzotto-stone-100">
                {t(`tournament.create.aside.format.${key}.name`)}
              </dt>
              <dd className="leading-relaxed text-rizzotto-stone-400">
                {t(`tournament.create.aside.format.${key}.desc`)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-rizzotto-gold-400/90">
          {t('tournament.create.aside.mode_label')}
        </h3>
        <dl className="mt-2 flex flex-col gap-2.5 text-sm">
          {MODE_KEYS.map((key) => (
            <div key={key}>
              <dt className="font-semibold text-rizzotto-stone-100">
                {t(`tournament.create.aside.mode.${key}.name`)}
              </dt>
              <dd className="leading-relaxed text-rizzotto-stone-400">
                {t(`tournament.create.aside.mode.${key}.desc`)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="border-t border-rizzotto-iron-800/60 pt-4 text-xs italic text-rizzotto-stone-500">
        {t('tournament.create.aside.footnote')}
      </p>
    </aside>
  );
}
