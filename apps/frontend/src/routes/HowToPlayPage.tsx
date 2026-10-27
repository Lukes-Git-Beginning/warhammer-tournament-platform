import { useEffect, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PageShell } from '@/components/layout/PageShell';
import { getStandardRuleset } from '@/lib/api';
import { STANDARD_RULESET } from '@/components/tournament/StandardRulesetCard';
import { REPLACED_MODS, RIZZOTTOVERSE_INVITE, steamWorkshopUrl, useArenaMod } from '@/lib/arenaMod';

/**
 * How to Play: one page for new and existing players, from installing RizzOtto's Arena Mod to a reported
 * result. Rule cards, the required-mod notices and onboarding link here. The rules in section 3 come from
 * the live Standard Rulesets (Domination's conduct for every type, Land Battle's extra rules of play), so an
 * admin edit shows up here too.
 */

const SECTIONS = [
  { id: 'install', title: 'Install the mod' },
  { id: 'arena-modes', title: 'The arena modes' },
  { id: 'rules', title: 'Rules you follow yourself' },
  { id: 'matches', title: 'Playing a match on rizzotto.gg' },
  { id: 'faq', title: 'FAQ' },
] as const;

const linkClass =
  'text-rizzotto-gold-400 underline decoration-rizzotto-gold-600/60 underline-offset-2 hover:text-rizzotto-gold-300';

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

function Section({ id, number, title, children }: { id: string; number?: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-rizzotto-iron-700 pt-8">
      <h2 className="mb-4 font-display text-2xl text-rizzotto-gold-400">
        {number != null && `${number}. `}
        {title}
      </h2>
      <div className="space-y-3 leading-relaxed text-rizzotto-stone-300">{children}</div>
    </section>
  );
}

function Screenshot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="my-4">
      <img src={src} alt={alt} loading="lazy" className="w-full rounded-md border border-rizzotto-iron-700" />
      <figcaption className="mt-1.5 text-xs text-rizzotto-stone-500">{caption}</figcaption>
    </figure>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 font-semibold text-rizzotto-stone-100">{q}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

const ul = 'list-disc space-y-1.5 pl-5 marker:text-rizzotto-gold-600';
const ol = 'list-decimal space-y-2 pl-5 marker:text-rizzotto-gold-600';
const code = 'rounded bg-rizzotto-iron-800 px-1 py-0.5 font-mono text-[0.85em] text-rizzotto-stone-200 [overflow-wrap:anywhere]';

export function HowToPlayPage() {
  const mod = useArenaMod();
  const { data: domination } = useQuery({
    queryKey: ['standard-ruleset', 'DOMINATION', 'ONE_V_ONE'],
    queryFn: () => getStandardRuleset('DOMINATION', 'ONE_V_ONE'),
    staleTime: 5 * 60 * 1000,
  });
  const { data: landBattle } = useQuery({
    queryKey: ['standard-ruleset', 'LAND_BATTLE', 'ONE_V_ONE'],
    queryFn: () => getStandardRuleset('LAND_BATTLE', 'ONE_V_ONE'),
    staleTime: 5 * 60 * 1000,
  });
  const commonConduct = domination?.conduct ?? STANDARD_RULESET.conduct;
  const landBattleOnly = (landBattle?.conduct ?? []).filter((c) => !commonConduct.includes(c));

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "How to Play — RizzOtto's Arena";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <PageShell variant="narrow">
      <article className="space-y-8">
        <header className="space-y-3">
          <h1 className="font-display text-2xl font-bold leading-tight text-rizzotto-gold-500 sm:text-4xl">How to Play</h1>
          <p className="leading-relaxed text-rizzotto-stone-300">
            Every game on RizzOtto&apos;s Arena is played with{' '}
            <ExternalLink href={mod.url}>RizzOtto&apos;s Arena Mod</ExternalLink>. It adds the arena modes to the
            custom battle lobby and enforces their settings and rules, so it is the only mod you need. Here is
            everything from installing it to your first reported result.
          </p>
          <nav aria-label="Contents" className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
            <ol className="space-y-1 text-sm">
              {SECTIONS.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-rizzotto-stone-200 hover:text-rizzotto-gold-400">
                    {s.id === 'faq' ? s.title : `${i + 1}. ${s.title}`}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </header>

        <Section id="install" number={1} title="Install the mod">
          <ol className={ol}>
            <li>
              Subscribe to <ExternalLink href={mod.url}>RizzOtto&apos;s Arena Mod</ExternalLink> on the Steam Workshop
              {mod.version ? <> (current version: <strong className="text-rizzotto-stone-100">{mod.version}</strong>)</> : null}.
            </li>
            <li>
              In the game&apos;s launcher, enable <strong className="text-rizzotto-stone-100">only this mod</strong>.
              Disable{' '}
              {REPLACED_MODS.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && ' and '}
                  <ExternalLink href={steamWorkshopUrl(m.id)}>{m.name}</ExternalLink>
                </span>
              ))}
              : the arena mod already contains their maps and rules, and any other active mod changes the
              multiplayer checksum.
            </li>
            <li>
              If you ever copied a test version by hand, delete <code className={code}>rizzotto_arena.pack</code> and{' '}
              <code className={code}>domquest.pack</code> from the game&apos;s <code className={code}>data</code> folder. A
              local copy hides the Workshop version.
            </li>
            <li>
              Start the game and open the multiplayer lobby. The mod&apos;s version is shown under the lobby title
              {mod.version ? <> and should read {mod.version}</> : null}. Both players need the same version.
            </li>
          </ol>
        </Section>

        <Section id="arena-modes" number={2} title="The arena modes">
          <p>
            The first buttons in the lobby&apos;s battle type bar are the arena modes, with the aubergine behind the
            icon: Domquest, Land Battle, Conquest, Domination, Siege Battle and Free-For-All Battle. Host every arena
            game in one of these. The game&apos;s own modes follow as &quot;Vanilla …&quot; and have none of the
            arena&apos;s rules.
          </p>
          <Screenshot
            src="/img/how-to-play/arena-mode-buttons.jpg"
            alt="The battle type bar in the lobby: the six arena modes with the aubergine, then the Vanilla modes"
            caption="The arena modes come first, the Vanilla modes after them."
          />
          <p>
            In the arena modes the mod fixes the lobby settings and applies the bans of the Standard Ruleset. In Land
            Battle, Conquest, Siege Battle and Free-For-All Battle it also enforces the{' '}
            <Link to="/fruit-rules" className={linkClass}>
              Fruit Rules
            </Link>
            : a unit that would break a limit is greyed out, and Ready stays blocked until the army is legal.
          </p>
          <h3 className="pt-2 font-display text-lg text-rizzotto-stone-100">Domquest</h3>
          <p>
            Domquest brings Domination and Conquest players together: think Conquest on the Domination engine. Most of
            the battle is decided by a Conquest-sized starting army; the small reinforcing army works like a sideboard
            to answer the army your opponent brought.
          </p>
          <ul className={ul}>
            <li>Starting army 12,400 gold, reinforcing army up to 5,600 gold. Ultra unit size, unit caps on, character loading off, 600 tickets.</li>
            <li>One capture point, equally far from both armies, and one reinforcement point per side, at the back of your side.</li>
            <li>
              Reinforcements are paid from a budget that starts at 0 and grows by 10 per second, up to the value of your
              reinforcing army: a full 5,600 takes a bit over 9 minutes. Army abilities, unit abilities and buildings are
              paid from it too.
            </li>
            <li>Each reinforcing unit can be called in once. Units can&apos;t be withdrawn, and one that was on the field can&apos;t come back.</li>
            <li>The maps are the Domquest versions of the arena&apos;s Domination maps (&quot;Domquest - …&quot; in the map list).</li>
          </ul>
          <Screenshot
            src="/img/how-to-play/domquest-map-setup.jpg"
            alt="Map setup with Domquest selected: the Domquest maps and the fixed lobby settings"
            caption="Domquest selected: the Domquest maps and the settings the mod fixes."
          />
        </Section>

        <Section id="rules" number={3} title="Rules you follow yourself">
          <p>The mod can&apos;t check everything. These are on you, in every battle type:</p>
          <ul className={ul}>
            <li>Host the game in the arena mode (the aubergine button), with only RizzOtto&apos;s Arena Mod enabled.</li>
            {commonConduct.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {landBattleOnly.length > 0 && (
            <>
              <p>In Land Battle, also:</p>
              <ul className={ul}>
                {landBattleOnly.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
          <p>A tournament can add rules of its own; you&apos;ll find them on its page.</p>
        </Section>

        <Section id="matches" number={4} title="Playing a match on rizzotto.gg">
          <ol className={ol}>
            <li>
              Find a game: sign up for a{' '}
              <Link to="/tournaments" search={{ tab: 'upcoming', page: 1 }} className={linkClass}>
                tournament
              </Link>{' '}
              or join the{' '}
              <Link to="/open-play" className={linkClass}>
                Open Play
              </Link>{' '}
              queue. When you are paired, you get a Discord DM and the match appears on the site.
            </li>
            <li>Open the match page. It shows the map and both factions, or lets you pick and ban them, depending on the format.</li>
            <li>
              One of you hosts the lobby in the right arena mode and enters the lobby code and password on the match
              page; the other one joins.
            </li>
            <li>
              After the game, report the result (&quot;I Won&quot; or &quot;They Won&quot;) and attach the replay. TWW3
              saves replays to <code className={code}>%APPDATA%\The Creative Assembly\Warhammer3\replays</code>.
            </li>
            <li>Your opponent confirms or disputes the result. Without an answer it is confirmed after 30 minutes.</li>
          </ol>
        </Section>

        <Section id="faq" title="FAQ">
          <Faq q="The lobby says my version is incompatible.">
            <p>
              Both players need the same version of the mod. Compare the version under the lobby title. If yours is
              older, let Steam update the mod (restarting Steam helps). If you once copied the mod by hand, delete{' '}
              <code className={code}>rizzotto_arena.pack</code> and <code className={code}>domquest.pack</code> from the
              game&apos;s <code className={code}>data</code> folder: a local copy hides the Workshop version.
            </p>
          </Faq>
          <Faq q="There is a red warning in the lobby.">
            <p>
              Other mods are active, or the game was patched after this version of the mod. Disable every mod except
              RizzOtto&apos;s Arena Mod. After a game patch, wait for the mod&apos;s update.
            </p>
            <Screenshot
              src="/img/how-to-play/lobby-warning.jpg"
              alt="The red lobby warning that names the other active mod"
              caption="The warning names the other active mod (here the Total Tavern map pack)."
            />
          </Faq>
          <Faq q="Why is a unit greyed out?">
            <p>
              It would break a limit of the Fruit Rules (Land Battle, Conquest, Siege Battle, Free-For-All Battle). The{' '}
              <Link to="/fruit-rules" className={linkClass}>
                Fruit Rules page
              </Link>{' '}
              shows how we read the rules and every limit per faction.
            </p>
          </Faq>
          <Faq q="Do I still need the Total Tavern map pack or Loupi's mod?">
            <p>No. RizzOtto&apos;s Arena Mod contains the maps and the rules. Disable both, or the lobby warns you.</p>
          </Faq>
          <Faq q="What changed in the latest version?">
            <p>
              The <ExternalLink href={mod.changelogUrl}>change notes on the Steam Workshop</ExternalLink> list every
              update.
            </p>
          </Faq>
          <Faq q="Where do I get help?">
            <p>
              Join <ExternalLink href={RIZZOTTOVERSE_INVITE}>the RizzOttoverse on Discord</ExternalLink>: notifications,
              tournament talk and mod updates.
            </p>
          </Faq>
        </Section>
      </article>
    </PageShell>
  );
}
